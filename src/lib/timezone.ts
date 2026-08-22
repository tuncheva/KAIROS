/**
 * Reading wall-clock time in somebody else's zone.
 *
 * The scheduled agents are the reason this exists. A daily brief is a promise
 * about the user's morning, and the only way to keep it is to ask what hour it
 * currently is *where they are* — which is not a question a UTC timestamp can
 * answer, and not one Postgres was being asked.
 *
 * Everything here goes through `Intl.DateTimeFormat`, which carries the IANA
 * database and therefore knows about DST transitions, historical offset changes
 * and the zones that are not whole hours off UTC. The alternative — storing a
 * numeric offset — is wrong twice a year in every zone that observes summer
 * time, which is precisely the bug this replaces.
 *
 * Pure and free of server bindings so the settings UI can validate a zone with
 * the same function the scheduler trusts.
 */

/** Fallback when a stored zone turns out not to be a zone. */
export const DEFAULT_TIME_ZONE = "UTC";

/**
 * Formatter construction is not free and the scheduler asks per user per sweep,
 * so instances are kept. The set of zones is bounded (~420) and each formatter
 * is small, so this cannot grow without bound.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });

  formatterCache.set(timeZone, created);
  return created;
}

/**
 * A fixed UTC offset, which `Intl` accepts as a zone but which is not one.
 *
 * `+02:00` describes Bulgaria today and is wrong there from late March to late
 * October. Storing one silently reinstates exactly the seasonal drift this
 * module exists to remove, so it is rejected at the boundary rather than
 * quietly honoured.
 */
const BARE_OFFSET = /^[+-]\d{2}(:?\d{2})?$/;

/**
 * Is this a zone the runtime actually knows?
 *
 * Worth checking at every boundary where a zone enters the system. The column
 * is a free-text `varchar` and the tRPC input is `z.string()`, so nothing but
 * validation stops `"Europe/Sofa"` being stored — and an unknown zone makes
 * `Intl.DateTimeFormat` throw, which in the scheduler would turn one user's
 * typo into a failed sweep for everyone processed after them.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || BARE_OFFSET.test(timeZone)) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

/**
 * Wall-clock parts at an instant, in a zone.
 *
 * Falls back to UTC rather than throwing. A caller in the middle of a batch
 * cannot do anything useful with an exception here, and the honest degradation
 * for an unrecognised zone is the behaviour that existed before zones were
 * consulted at all.
 */
function partsIn(timeZone: string, at: Date): LocalParts {
  let formatted;
  try {
    formatted = formatterFor(timeZone).formatToParts(at);
  } catch {
    formatted = formatterFor(DEFAULT_TIME_ZONE).formatToParts(at);
  }

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = formatted.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // `hourCycle: "h23"` is what keeps midnight at 0. The h24 cycle renders it
    // as 24, which would compare as "later than every scheduled hour" and fire
    // every schedule at once, once a day.
    hour: read("hour"),
  };
}

/** The hour of the day (0–23) at this instant, in this zone. */
export function localHourIn(timeZone: string, at: Date): number {
  return partsIn(timeZone, at).hour;
}

/**
 * A stable identifier for "which day it is" in a zone, as `YYYY-MM-DD`.
 *
 * Used instead of a midnight `Date` to decide whether something already ran
 * today. Comparing day keys is exact across DST boundaries, where comparing an
 * instant against a computed local midnight is off by an hour on the two days a
 * year when it matters most — and being off by an hour on those days means
 * either a duplicate brief or a missing one.
 */
export function localDayKeyIn(timeZone: string, at: Date): string {
  const { year, month, day } = partsIn(timeZone, at);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Every zone this runtime recognises, for offering a choice.
 *
 * `Intl.supportedValuesOf` omits plain `UTC` — it canonicalises to `Etc/UTC` —
 * so it is prepended. UTC is this system's default and its absence from the
 * picker would make the stored default unselectable, which reads as the setting
 * having been corrupted.
 */
export function supportedTimeZones(): readonly string[] {
  return [DEFAULT_TIME_ZONE, ...Intl.supportedValuesOf("timeZone")];
}

/**
 * The viewer's own zone, for defaulting a picker.
 *
 * Browser-side only in practice; on the server this reports whatever the host
 * is set to, which is why it is never used to interpret a stored preference.
 */
export function guessTimeZone(): string {
  try {
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return guess && isValidTimeZone(guess) ? guess : DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
