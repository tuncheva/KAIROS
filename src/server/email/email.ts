import "server-only";

import { Resend } from 'resend';
import { createLogger } from "~/server/logger";

const log = createLogger("email");

export interface WelcomeEmailParams {
  email: string;
  userName: string;
}

export interface PasswordResetCodeParams {
  email: string;
  userName: string;
  code: string;
}

export interface EmailVerificationCodeParams {
  email: string;
  userName: string;
  code: string;
}

export interface EmailVerificationParams {
  email: string;
  userName: string;
  verifyToken: string;
}

export interface BriefEmailParams {
  email: string;
  userName: string;
  /** Heading — "Your daily brief", "Your week in review". */
  heading: string;
  /** The agent's prose, already written in the user's language. */
  body: string;
}

type EmailVerificationTemplateInput = {
  userName: string;
  verifyUrl: string;
};

type WelcomeTemplateInput = {
  userName: string;
  appUrl: string;
};

type CodeTemplateInput = {
  userName: string;
  code: string;
};

// ---------------------------------------------------------------------------
// Shared email scaffolding
// ---------------------------------------------------------------------------

/**
 * The palette, kept in step with `globals.css`.
 *
 * Email cannot read CSS variables — every colour has to be inlined as a literal
 * — so these are the hex forms of the light-theme tokens the application itself
 * renders. They were drifting: the templates hardcoded `#9448F2` while the app's
 * `--accent-primary` had moved to `rgb(168 85 247)`, so a confirmation email sat
 * next to the product wearing a visibly different purple. Change a token in
 * `globals.css` and change its twin here.
 */
const BRAND = {
  /** `--accent-primary` — rgb(168 85 247). */
  accent: "#A855F7",
  /** `--accent-hover` — rgb(147 51 234). Used for the wordmark tile edge. */
  accentDeep: "#9333EA",
  /** A tint of the accent, for the code plate. */
  accentTint: "#F6F0FE",
  /** `--fg-primary` — rgb(15 23 42). */
  ink: "#0F172A",
  /** `--fg-secondary` — rgb(71 85 105). */
  inkMuted: "#475569",
  /** Page ground behind the card. */
  surface: "#F8FAFC",
  card: "#FFFFFF",
  border: "#E2E8F0",
  /** `--warning` and `--warning-light`, for the security notices. */
  warning: "#FB923C",
  warningTint: "#FFF7ED",
} as const;

/**
 * The product name, in the form the brand uses.
 *
 * Set out once rather than spelled inline thirty times, because the last rename
 * left "Kairos" in some subjects and sign-offs and not others.
 */
const BRAND_NAME = "KAIROS";

const FONT_STACK =
  "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/**
 * Escape text destined for an HTML email body.
 *
 * Applied to every interpolated value, not only the ones that look risky.
 * `userName` is user-authored, arrives in an HTML document, and was previously
 * interpolated raw into four templates — a display name of `<img onerror=...>`
 * wrote markup into the recipient's inbox. The brief's model output has the same
 * property. Cheap enough that the rule is simply "escape it", with no judgement
 * call at each call site about whether this particular string is trusted.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escape a URL the application built for use in an `href`.
 *
 * The URLs here are assembled from `NEXT_PUBLIC_APP_URL` and a token this
 * process generated, so nothing hostile is expected in them — but an unescaped
 * `&` between query parameters is invalid in an HTML attribute regardless, and
 * a mail client that reflows the markup can mangle it.
 */
function escapeUrl(value: string): string {
  return escapeHtml(value);
}

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${BRAND_NAME}</title>
</head>
<body style="margin:0;padding:0;font-family:${FONT_STACK};background-color:${BRAND.surface};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.surface};">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
${content}
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:32px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid ${BRAND.border};padding-top:24px;text-align:center;">
                  <p style="margin:0;color:${BRAND.inkMuted};font-size:14px;line-height:1.5;">Sent by <strong style="color:${BRAND.ink};letter-spacing:0.06em;">${BRAND_NAME}</strong></p>
                  <p style="margin:8px 0 0;color:${BRAND.inkMuted};font-size:12px;line-height:1.5;">This is an automated message about your account. Nobody replies to this address.</p>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * The wordmark tile and the message heading.
 *
 * The tile carries a `K` rather than an image: a remote logo is blocked by
 * default in most mail clients, and a transactional email whose first paint is a
 * broken-image icon reads as a phish.
 */
function logoBlock(title: string): string {
  return `          <!-- Wordmark & Title -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="width:56px;height:56px;background-color:${BRAND.accent};border-bottom:3px solid ${BRAND.accentDeep};border-radius:16px;text-align:center;vertical-align:middle;line-height:56px;">
                    <span style="color:#ffffff;font-size:26px;font-weight:bold;">K</span>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;color:${BRAND.inkMuted};font-size:12px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;">${BRAND_NAME}</p>
              <h1 style="margin:8px 0 0;color:${BRAND.ink};font-size:26px;font-weight:bold;line-height:1.3;">${escapeHtml(title)}</h1>
            </td>
          </tr>`;
}

/** The white card every message body sits in. */
function card(inner: string): string {
  return `          <!-- Content Card -->
          <tr>
            <td style="background:${BRAND.card};border-radius:16px;padding:32px;border:1px solid ${BRAND.border};">
${inner}
            </td>
          </tr>`;
}

function greeting(userName: string): string {
  return `              <p style="margin:0 0 20px;color:${BRAND.ink};font-size:16px;line-height:1.6;">Hi <strong>${escapeHtml(userName)}</strong>,</p>`;
}

function paragraph(text: string): string {
  return `              <p style="margin:0 0 24px;color:${BRAND.inkMuted};font-size:16px;line-height:1.6;">${text}</p>`;
}

function button(href: string, label: string): string {
  return `              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${escapeUrl(href)}" style="display:inline-block;padding:14px 32px;background-color:${BRAND.accent};color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px;line-height:1;">${escapeHtml(label)}</a>
                  </td>
                </tr>
              </table>`;
}

/**
 * The plate a one-time code is shown on.
 *
 * One renderer for both codes, so the reset code and the address-confirmation
 * code are visually identical — they are the same object to the person reading
 * them, and rendering them differently would only invite the guess that one of
 * them is not really from here.
 */
function codePlate(code: string): string {
  return `              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:18px 36px;background-color:${BRAND.accentTint};border:2px solid ${BRAND.accent};border-radius:12px;letter-spacing:8px;font-size:32px;font-weight:bold;color:${BRAND.ink};font-family:'Courier New',Courier,monospace;text-align:center;">${escapeHtml(code)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>`;
}

function notice(heading: string, body: string): string {
  return `              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background-color:${BRAND.warningTint};border-left:4px solid ${BRAND.warning};padding:16px;border-radius:0 8px 8px 0;">
                    <p style="margin:0;color:${BRAND.inkMuted};font-size:14px;line-height:1.6;"><strong style="color:${BRAND.ink};">${escapeHtml(heading)}</strong><br>${body}</p>
                  </td>
                </tr>
              </table>`;
}

const SIGN_OFF = `Sent by ${BRAND_NAME}. This is an automated message about your account.`;

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

const WelcomeEmailTemplate = {
  subject: `Welcome to ${BRAND_NAME}`,
  renderHtml: ({ userName, appUrl }: WelcomeTemplateInput) =>
    emailWrapper(`
${logoBlock(`Welcome to ${BRAND_NAME}`)}
${card(`${greeting(userName)}
${paragraph("Your account is ready. Projects, tasks, notes and your calendar all live in one place — start wherever you like.")}
${button(appUrl, `Open ${BRAND_NAME}`)}`)}`),
  renderText: ({ userName, appUrl }: WelcomeTemplateInput) =>
    `Hi ${userName},

Your ${BRAND_NAME} account is ready.

Open ${BRAND_NAME}: ${appUrl}

${SIGN_OFF}`,
} as const;

// ---------------------------------------------------------------------------
// Password reset code
// ---------------------------------------------------------------------------

const PasswordResetCodeTemplate = {
  subject: `Your password reset code — ${BRAND_NAME}`,
  renderHtml: ({ userName, code }: CodeTemplateInput) =>
    emailWrapper(`
${logoBlock("Password reset code")}
${card(`${greeting(userName)}
${paragraph("Someone asked to reset the password on your account. Enter this code to continue:")}
${codePlate(code)}
${notice(
  "If this wasn't you",
  `Ignore this email and your password stays as it is — a code on its own changes nothing. The code expires in <strong>15 minutes</strong> and stops working after five wrong attempts. ${BRAND_NAME} will never ask you for it.`,
)}`)}`),
  renderText: ({ userName, code }: CodeTemplateInput) =>
    `Hi ${userName},

Your password reset code is: ${code}

It expires in 15 minutes and stops working after five wrong attempts.

If you didn't ask for this, ignore this email — your password stays as it is. ${BRAND_NAME} will never ask you for this code.

${SIGN_OFF}`,
} as const;

// ---------------------------------------------------------------------------
// Address confirmation — code
// ---------------------------------------------------------------------------

/**
 * Confirming your address from inside the app.
 *
 * The link variant below is what signup sends; this is what the settings screen
 * sends. The difference is where the person is standing. Someone who just typed
 * their address into Settings is looking at a form that can take a code, and
 * sending them out to a mail client and back would throw away the screen they
 * are already on.
 */
const EmailVerificationCodeTemplate = {
  subject: `Your confirmation code — ${BRAND_NAME}`,
  renderHtml: ({ userName, code }: CodeTemplateInput) =>
    emailWrapper(`
${logoBlock("Confirm your email")}
${card(`${greeting(userName)}
${paragraph(`Enter this code in ${BRAND_NAME} to confirm this address belongs to you:`)}
${codePlate(code)}
${notice(
  "If this wasn't you",
  `Somebody may have typed your address by mistake. Ignore this email — nothing is confirmed without the code. It expires in <strong>15 minutes</strong>.`,
)}`)}`),
  renderText: ({ userName, code }: CodeTemplateInput) =>
    `Hi ${userName},

Your ${BRAND_NAME} confirmation code is: ${code}

Enter it in Settings to confirm this address. It expires in 15 minutes.

If you didn't ask for this, ignore this email — nothing is confirmed without the code.

${SIGN_OFF}`,
} as const;

// ---------------------------------------------------------------------------
// Address confirmation — link
// ---------------------------------------------------------------------------

const EmailVerificationTemplate = {
  subject: `Confirm your email — ${BRAND_NAME}`,
  renderHtml: ({ userName, verifyUrl }: EmailVerificationTemplateInput) =>
    emailWrapper(`
${logoBlock("Confirm your email")}
${card(`${greeting(userName)}
${paragraph(`Confirm this address to finish setting up your ${BRAND_NAME} account. You won't be able to sign in until you do.`)}
${button(verifyUrl, "Confirm email")}
${notice(
  "Didn't sign up?",
  "Someone may have entered your address by mistake. Ignore this email and no account will be usable with it. The link expires in <strong>24 hours</strong>.",
)}`)}`),
  renderText: ({ userName, verifyUrl }: EmailVerificationTemplateInput) =>
    `Hi ${userName},

Confirm your email address to finish setting up your ${BRAND_NAME} account:

${verifyUrl}

This link expires in 24 hours. You won't be able to sign in until the address is confirmed.

If you didn't sign up, ignore this email.

${SIGN_OFF}`,
} as const;

// ---------------------------------------------------------------------------
// Email Service
// ---------------------------------------------------------------------------

/**
 * There used to be a "reset your note password" template and sender here,
 * building `/reset-password?noteId=…&token=…`.
 *
 * It had no callers — not one, anywhere — so no token was ever minted, stored
 * or checked, and the URL it composed pointed at a page that read `noteId` and
 * ignored `token`. The recovery flow that does exist is PIN-based and lives at
 * `/notes/[noteId]/recover`. Reviving the emailed link means designing the
 * token first (a table, an expiry, a single-use check), which is a feature
 * rather than a fix, so the unreachable half was removed instead of left
 * looking like it worked.
 */
type EmailServiceOptions = {
  appUrl: string;
  fromEmail: string;
};

export class EmailService {
  constructor(
    private readonly resend: Resend,
    private readonly options: EmailServiceOptions
  ) {}



  async sendWelcomeEmail({
    email,
    userName,
  }: WelcomeEmailParams): Promise<{ id: string } | null> {
    log.debug('sending welcome email', { email });
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.options.fromEmail,
        to: [email],
        subject: WelcomeEmailTemplate.subject,
        html: WelcomeEmailTemplate.renderHtml({ userName, appUrl: this.options.appUrl }),
        text: WelcomeEmailTemplate.renderText({ userName, appUrl: this.options.appUrl }),
      });

      if (error) {
        log.error('welcome send failed', { err: error });
        throw new Error(`Failed to send welcome email: ${error.message}`);
      }

      log.debug('welcome email sent', { id: data?.id });
      return data;
    } catch (error) {
      log.error('welcome send threw', { err: error });
      throw error;
    }
  }

  async sendEmailVerification({
    email,
    userName,
    verifyToken,
  }: EmailVerificationParams): Promise<{ id: string } | null> {
    const verifyUrl = `${this.options.appUrl}/verify-email?token=${encodeURIComponent(verifyToken)}`;

    const { data, error } = await this.resend.emails.send({
      from: this.options.fromEmail,
      to: [email],
      subject: EmailVerificationTemplate.subject,
      html: EmailVerificationTemplate.renderHtml({ userName, verifyUrl }),
      text: EmailVerificationTemplate.renderText({ userName, verifyUrl }),
    });

    if (error) {
      throw new Error(`Failed to send verification email: ${error.message}`);
    }

    return data;
  }

  /**
   * Send a confirmation code for an address the user is confirming in-app.
   *
   * Throws on failure, like its transactional siblings: somebody is watching a
   * spinner in Settings and needs to be told it didn't send.
   */
  async sendEmailVerificationCode({
    email,
    userName,
    code,
  }: EmailVerificationCodeParams): Promise<{ id: string } | null> {
    const { data, error } = await this.resend.emails.send({
      from: this.options.fromEmail,
      to: [email],
      subject: EmailVerificationCodeTemplate.subject,
      html: EmailVerificationCodeTemplate.renderHtml({ userName, code }),
      text: EmailVerificationCodeTemplate.renderText({ userName, code }),
    });

    if (error) {
      log.error('verification code send failed', { err: error });
      throw new Error(`Failed to send confirmation code: ${error.message}`);
    }

    return data;
  }

  async sendPasswordResetCode({
    email,
    userName,
    code,
  }: PasswordResetCodeParams): Promise<{ id: string } | null> {
    log.debug('sending password reset code', { email });
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.options.fromEmail,
        to: [email],
        subject: PasswordResetCodeTemplate.subject,
        html: PasswordResetCodeTemplate.renderHtml({ userName, code }),
        text: PasswordResetCodeTemplate.renderText({ userName, code }),
      });

      if (error) {
        log.error('reset code send failed', { err: error });
        throw new Error(`Failed to send reset code: ${error.message}`);
      }

      log.debug('reset code email sent', { id: data?.id });
      return data;
    } catch (error) {
      log.error('reset code send threw', { err: error });
      throw error;
    }
  }

  /**
   * Send a proactive brief.
   *
   * Returns `null` on failure instead of throwing, unlike its siblings here. The
   * callers differ: a welcome email that fails should surface loudly during a
   * signup a person is watching, while this one is sent by a background sweep
   * processing many users, where an exception is a worse outcome than a recorded
   * failure. The scheduler needs to know it did not send so it can count toward
   * disabling the channel — see `runner.ts`.
   */
  async sendBriefEmail({
    email,
    userName,
    heading,
    body,
  }: BriefEmailParams): Promise<{ id: string } | null> {
    const input = { userName, heading, body, appUrl: this.options.appUrl };

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.options.fromEmail,
        to: [email],
        subject: BriefEmailTemplate.renderSubject({ heading }),
        html: BriefEmailTemplate.renderHtml(input),
        text: BriefEmailTemplate.renderText(input),
      });

      if (error) {
        log.error('brief email send failed', { err: error });
        return null;
      }

      return data;
    } catch (error) {
      log.error('brief email send threw', { err: error });
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Proactive brief
// ---------------------------------------------------------------------------

/**
 * The one email in this file that is not transactional.
 *
 * Every other template here is sent because the user just did something — signed
 * up, asked for a reset. This one arrives unprompted, which changes two things.
 *
 * The subject line carries the heading rather than a fixed string, because the
 * same sender now speaks in two voices (a morning brief and a weekly review) and
 * a mailbox sorted by subject should keep them apart.
 *
 * It has no call-to-action button. The brief *is* the content: a message whose
 * substance is three sentences does not need a link to go and read three
 * sentences somewhere else. The footer link exists for acting on it.
 */
const BriefEmailTemplate = {
  renderSubject: ({ heading }: { heading: string }) => heading,
  renderHtml: ({
    userName,
    heading,
    body,
    appUrl,
  }: {
    userName: string;
    heading: string;
    body: string;
    appUrl: string;
  }) =>
    emailWrapper(`
${logoBlock(heading)}
${card(`${greeting(userName)}
              <p style="margin:0 0 24px;color:${BRAND.inkMuted};font-size:16px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(body)}</p>
${button(`${appUrl}/chat/ai`, "Open the assistant")}`)}`),
  renderText: ({
    userName,
    heading,
    body,
    appUrl,
  }: {
    userName: string;
    heading: string;
    body: string;
    appUrl: string;
  }) =>
    `Hi ${userName},

${heading}

${body}

Open the assistant: ${appUrl}/chat/ai

${SIGN_OFF}`,
} as const;

/**
 * Render the brief email body, for tests.
 *
 * Exported because the escaping is the part worth pinning and the template is
 * otherwise only reachable through `Resend`. Named for what it is rather than
 * dressed up as a general-purpose renderer: nothing in the application should
 * call this.
 */
export function renderBriefEmailForTest(input: {
  userName: string;
  heading: string;
  body: string;
  appUrl: string;
}): string {
  return BriefEmailTemplate.renderHtml(input);
}

let cachedEmailService: EmailService | null = null;

export function getEmailService(): EmailService {
  // Always re-read env to pick up changes (no stale cached fromEmail)
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    log.error('RESEND_API_KEY is not set; email is disabled');
    throw new Error('RESEND_API_KEY is not set in environment variables');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    log.error('NEXT_PUBLIC_APP_URL is not set; email links would be broken');
    throw new Error('NEXT_PUBLIC_APP_URL is not set in environment variables');
  }

  const rawFromEmail = process.env.RESEND_FROM_EMAIL?.trim() ?? `${BRAND_NAME} <onboarding@resend.dev>`;
  const fromEmail = rawFromEmail.replace(/^['"]|['"]$/g, '');

  if (cachedEmailService) {
    // Check if fromEmail changed (e.g. env reload) — if so, recreate
    if ((cachedEmailService as unknown as { options: EmailServiceOptions }).options.fromEmail === fromEmail) {
      return cachedEmailService;
    }
  }

  log.info('email service initialised', { appUrl });

  cachedEmailService = new EmailService(new Resend(apiKey), {
    appUrl,
    fromEmail,
  });
  return cachedEmailService;
}

export async function sendWelcomeEmail(
  params: WelcomeEmailParams
): Promise<{ id: string } | null> {
  return getEmailService().sendWelcomeEmail(params);
}

export async function sendPasswordResetCode(
  params: PasswordResetCodeParams
): Promise<{ id: string } | null> {
  return getEmailService().sendPasswordResetCode(params);
}

export async function sendEmailVerificationCode(
  params: EmailVerificationCodeParams
): Promise<{ id: string } | null> {
  return getEmailService().sendEmailVerificationCode(params);
}

export async function sendEmailVerification(
  params: EmailVerificationParams
): Promise<{ id: string } | null> {
  return getEmailService().sendEmailVerification(params);
}

/**
 * Send a brief, tolerating a mail service that is not configured at all.
 *
 * `getEmailService()` throws when `RESEND_API_KEY` is missing. For a signup that
 * is correct — the deployment is broken and someone should hear about it. For the
 * nightly sweep it would abort the delivery of every user processed after the
 * first, so a missing key degrades to "no email sent" here rather than taking the
 * batch down.
 */
export async function sendBriefEmail(
  params: BriefEmailParams
): Promise<{ id: string } | null> {
  try {
    return await getEmailService().sendBriefEmail(params);
  } catch (error) {
    log.error('brief email unavailable', { err: error });
    return null;
  }
}
