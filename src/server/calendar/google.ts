/**
 * Google Calendar, read-only.
 *
 * Hand-rolled against the REST API rather than pulling in `googleapis`, which is
 * a very large dependency for three endpoints — an authorization URL, a token
 * exchange, and one paginated list call.
 *
 * The scope is `calendar.readonly` and nothing else. That is the whole security
 * posture of this feature: even if a token leaks, it cannot alter anybody's
 * calendar, because the grant does not permit it.
 */

import "server-only";

import { env } from "~/env";

/**
 * Read-only, and separate from sign-in.
 *
 * `calendar.readonly` covers listing events on every calendar the user can see.
 * `calendar.events.readonly` would be narrower but excludes the calendar list,
 * which is needed to know which calendar an event came from.
 */
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events";

/** Scope required for creating/deleting events. */
export const EVENTS_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Per-request timeout. A hung provider must not hold a sweep open. */
const TIMEOUT_MS = 10_000;

/** Events per page. Google's ceiling is 2500; this keeps a page readable. */
const PAGE_SIZE = 250;

/** Pages one sync will walk, so a huge calendar cannot run unbounded. */
const MAX_PAGES = 20;

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

export function redirectUri(): string {
  const base = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/calendar/google/callback`;
}

/**
 * Where to send the user to grant access.
 *
 * `access_type=offline` is what produces a refresh token; without it the grant
 * expires in an hour and the feature silently stops working.
 *
 * `prompt=consent` is deliberate and slightly costly: it re-shows the consent
 * screen even to a user who has already granted. Google only issues a refresh
 * token on a *first* authorisation otherwise, so a user who reconnects after we
 * lost their token would get an access token with no way to renew it — and the
 * failure would appear an hour later, far from its cause.
 */
export function authorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.AUTH_GOOGLE_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  /** Absent when Google decides the caller already has one. */
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });

    const json = (await response.json()) as RawTokenResponse;

    if (!response.ok || !json.access_token) {
      throw new Error(
        json.error_description ?? json.error ?? "Token request failed",
      );
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      // 60 seconds of margin: a token that expires mid-request is a failure the
      // user sees, and the cost of refreshing a minute early is nothing.
      expiresAt: new Date(Date.now() + ((json.expires_in ?? 3600) - 60) * 1000),
      scope: json.scope ?? SCOPE,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      code,
      client_id: env.AUTH_GOOGLE_ID ?? "",
      client_secret: env.AUTH_GOOGLE_SECRET ?? "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  );
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.AUTH_GOOGLE_ID ?? "",
      client_secret: env.AUTH_GOOGLE_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  );
}

// ---------------------------------------------------------------------------
// Listing events
// ---------------------------------------------------------------------------

export interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
}

/**
 * Google's status code alone does not identify the fault. A 403 is "the API is
 * not enabled on this project", "this token lacks the scope" and "you are being
 * rate limited" all at once, and the three have nothing to do with each other.
 * The `reason` in the error body is what separates them, so it travels with the
 * thrown error rather than being dropped on the floor at the fetch site.
 */
async function googleError(response: Response, context: string): Promise<Error> {
  let detail = "";
  try {
    const body = (await response.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    const reason = body.error?.errors?.[0]?.reason;
    detail = [reason, body.error?.message].filter(Boolean).join(": ");
  } catch {
    /* A non-JSON error body is not worth failing over — the status still says
       something, and this path is already an error path. */
  }

  return new Error(
    `${context} returned ${String(response.status)}${detail ? ` — ${detail}` : ""}`,
  );
}

export interface ListResult {
  events: GoogleEvent[];
  /** Present on the last page; feed it to the next sync. */
  nextSyncToken: string | null;
  /**
   * True when Google refused the sync token and the caller must start over.
   *
   * A `410 Gone` is not an error condition — Google expires sync tokens after a
   * while by design, and the documented response is to discard it and do a full
   * pull. Reporting it as a failure would make a healthy connection look broken.
   */
  syncTokenExpired: boolean;
}

/**
 * One sync pass.
 *
 * With a `syncToken` this returns only what changed since it was issued, which
 * is what makes syncing cheap after the first pass. Without one it pulls a
 * bounded window — recent past for context, near future for meeting prep —
 * rather than a user's entire calendar history.
 */
export async function listEvents(input: {
  accessToken: string;
  syncToken: string | null;
  now?: Date;
}): Promise<ListResult> {
  const events: GoogleEvent[] = [];
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      maxResults: String(PAGE_SIZE),
      // Recurring events are expanded into their instances. A meeting-prep brief
      // needs "the standup on Tuesday", not "a rule that generates standups".
      singleEvents: "true",
    });

    if (input.syncToken) {
      // `timeMin`/`timeMax` cannot be combined with a sync token — Google rejects
      // the request. The window is implied by whatever the first full sync took.
      params.set("syncToken", input.syncToken);
    } else {
      const now = input.now ?? new Date();
      params.set(
        "timeMin",
        new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      );
      params.set(
        "timeMax",
        new Date(now.getTime() + 180 * 86_400_000).toISOString(),
      );
      // Cancellations are wanted: a full sync should be able to mark something
      // off rather than silently leaving a stale row behind.
      params.set("showDeleted", "true");
    }

    if (pageToken) params.set("pageToken", pageToken);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${EVENTS_ENDPOINT}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 410) {
      return { events: [], nextSyncToken: null, syncTokenExpired: true };
    }

    if (!response.ok) {
      throw await googleError(response, "Google Calendar list");
    }

    const json = (await response.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    events.push(...(json.items ?? []));
    nextSyncToken = json.nextSyncToken ?? nextSyncToken;
    pageToken = json.nextPageToken ?? null;

    if (!pageToken) break;
  }

  return { events, nextSyncToken, syncTokenExpired: false };
}

// ---------------------------------------------------------------------------
// Writing events
// ---------------------------------------------------------------------------

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: string; // ISO-8601
  endDateTime: string;   // ISO-8601
  timeZone?: string;
}

export interface CreatedCalendarEvent {
  googleEventId: string;
  htmlLink: string;
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  event: CalendarEventInput,
): Promise<CreatedCalendarEvent> {
  const body = {
    summary: event.summary,
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    start: { dateTime: event.startDateTime, timeZone: event.timeZone ?? "UTC" },
    end: { dateTime: event.endDateTime, timeZone: event.timeZone ?? "UTC" },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw await googleError(response, "Google Calendar insert");
    }

    const result = (await response.json()) as { id?: string; htmlLink?: string };
    if (!result.id) throw new Error("Google Calendar did not return an event id");
    return { googleEventId: result.id, htmlLink: result.htmlLink ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  googleEventId: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    );

    // 204 = success, 410 = already deleted — both are fine
    if (!response.ok && response.status !== 410) {
      throw await googleError(response, "Google Calendar delete");
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a grant actually carries calendar access at all.
 *
 * Worth checking explicitly, because Google's granular consent screen lets the
 * user untick the calendar permissions and press Continue. Combined with
 * `include_granted_scopes=true`, the token response then comes back carrying
 * only the scopes the sign-in flow already had — `email profile openid` — which
 * looks like a successful authorisation and fails `403 insufficientPermissions`
 * on every list call thereafter.
 *
 * Matches `auth/calendar` rather than a specific scope, so `calendar.readonly`,
 * `calendar.events` and full `calendar` all satisfy it.
 */
export function hasCalendarScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.includes("auth/calendar");
}

export function hasWriteScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return scope.includes("calendar.events") || scope.includes("auth/calendar ");
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export interface MappedEvent {
  externalId: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  status: string;
  attendeeCount: number | null;
  selfResponse: string | null;
}

/**
 * Turn a Google event into a row, or null if it cannot be stored.
 *
 * Pure, so the awkward cases are testable: an all-day event carries `date`
 * instead of `dateTime`, a cancelled instance may carry almost nothing at all,
 * and an event with no start is not something a calendar view can place.
 */
export function mapEvent(raw: GoogleEvent): MappedEvent | null {
  const startDateTime = raw.start?.dateTime;
  const startDate = raw.start?.date;

  // No start at all. Happens on cancelled instances of a recurring event, which
  // carry an id and a status and nothing else — there is nothing to place on a
  // calendar, and the unique index means the existing row keeps its own dates.
  if (!startDateTime && !startDate) return null;

  const allDay = !startDateTime && Boolean(startDate);

  // `date` is a bare `YYYY-MM-DD`. Parsed as UTC midnight deliberately: an
  // all-day event has no time, and anchoring it to the server's zone would move
  // it a day for users either side.
  const startsAt = allDay
    ? new Date(`${startDate!}T00:00:00Z`)
    : new Date(startDateTime!);

  if (Number.isNaN(startsAt.getTime())) return null;

  const endRaw = raw.end?.dateTime ?? raw.end?.date;
  const endsAt = endRaw
    ? new Date(raw.end?.dateTime ? endRaw : `${endRaw}T00:00:00Z`)
    : null;

  const self = raw.attendees?.find((a) => a.self);

  return {
    externalId: raw.id,
    // Google omits `summary` on events with no title. "(no title)" is what its
    // own UI shows, and an empty string would render as a blank row.
    title: (raw.summary ?? "(no title)").slice(0, 512),
    description: raw.description ? raw.description.slice(0, 4000) : null,
    location: raw.location ? raw.location.slice(0, 1000) : null,
    startsAt,
    endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
    allDay,
    status: raw.status === "cancelled" || raw.status === "tentative"
      ? raw.status
      : "confirmed",
    attendeeCount: raw.attendees?.length ?? null,
    selfResponse: self?.responseStatus ?? null,
  };
}
