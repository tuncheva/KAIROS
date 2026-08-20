import "server-only";

import { Resend } from 'resend';
import { createLogger } from "~/server/logger";

const log = createLogger("email");

export interface PasswordResetEmailParams {
  email: string;
  userName: string;
  noteId: number;
  resetToken: string;
}

export interface WelcomeEmailParams {
  email: string;
  userName: string;
}

export interface PasswordResetCodeParams {
  email: string;
  userName: string;
  code: string;
}

export interface EmailVerificationParams {
  email: string;
  userName: string;
  verifyToken: string;
}

type PasswordResetTemplateInput = {
  userName: string;
  resetUrl: string;
};

type EmailVerificationTemplateInput = {
  userName: string;
  verifyUrl: string;
};

type WelcomeTemplateInput = {
  userName: string;
  appUrl: string;
};

type ResetCodeTemplateInput = {
  userName: string;
  code: string;
};

// ---------------------------------------------------------------------------
// Shared email scaffolding
// ---------------------------------------------------------------------------

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Kairos</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#FCFBF9;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FCFBF9;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
${content}
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:32px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #DDE3E9;padding-top:24px;text-align:center;">
                  <p style="margin:0;color:#59677C;font-size:14px;line-height:1.5;">Best regards,<br><strong style="color:#222B32;">The Kairos Team</strong></p>
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

function logoBlock(title: string): string {
  return `          <!-- Logo & Title -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="width:60px;height:60px;background-color:#9448F2;border-radius:16px;text-align:center;vertical-align:middle;line-height:60px;">
                    <span style="color:#ffffff;font-size:28px;font-weight:bold;">K</span>
                  </td>
                </tr>
              </table>
              <h1 style="margin:16px 0 0;color:#222B32;font-size:26px;font-weight:bold;line-height:1.3;">${title}</h1>
            </td>
          </tr>`;
}

// ---------------------------------------------------------------------------
// Welcome Email
// ---------------------------------------------------------------------------

const WelcomeEmailTemplate = {
  subject: 'Welcome to Kairos',
  renderHtml: ({ userName, appUrl }: WelcomeTemplateInput) =>
    emailWrapper(`
${logoBlock('Welcome to Kairos')}
          <!-- Content Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #DDE3E9;">
              <p style="margin:0 0 20px;color:#222B32;font-size:16px;line-height:1.6;">Hi <strong>${userName}</strong>,</p>
              <p style="margin:0 0 24px;color:#59677C;font-size:16px;line-height:1.6;">Your account has been created successfully. You can now start managing your projects, tasks, and notes.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0 0;">
                    <a href="${appUrl}" style="display:inline-block;padding:14px 32px;background-color:#9448F2;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px;line-height:1;">Open Kairos</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`),
  renderText: ({ userName, appUrl }: WelcomeTemplateInput) =>
    `Hi ${userName},\n\nWelcome to Kairos! Your account has been created successfully.\n\nOpen Kairos: ${appUrl}\n\nBest regards,\nThe Kairos Team`,
} as const;

// ---------------------------------------------------------------------------
// Password Reset Code Email
// ---------------------------------------------------------------------------

const PasswordResetCodeTemplate = {
  subject: 'Your Password Reset Code - Kairos',
  renderHtml: ({ userName, code }: ResetCodeTemplateInput) =>
    emailWrapper(`
${logoBlock('Password Reset Code')}
          <!-- Content Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #DDE3E9;">
              <p style="margin:0 0 20px;color:#222B32;font-size:16px;line-height:1.6;">Hi <strong>${userName}</strong>,</p>
              <p style="margin:0 0 24px;color:#59677C;font-size:16px;line-height:1.6;">We received a request to reset your password. Use the code below to proceed:</p>
              <!-- Code Display -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:18px 36px;background-color:#F4F0FF;border:2px solid #9448F2;border-radius:12px;letter-spacing:8px;font-size:32px;font-weight:bold;color:#222B32;font-family:'Courier New',Courier,monospace;text-align:center;">${code}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Security Notice -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background-color:#FFF8E6;border-left:4px solid #FFC53D;padding:16px;border-radius:0 8px 8px 0;">
                    <p style="margin:0;color:#59677C;font-size:14px;line-height:1.6;"><strong style="color:#222B32;">Security Notice:</strong><br>This code will expire in <strong>15 minutes</strong>. If you didn't request this reset, you can safely ignore this email.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`),
  renderText: ({ userName, code }: ResetCodeTemplateInput) =>
    `Hi ${userName},\n\nYour password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\nBest regards,\nThe Kairos Team`,
} as const;

// ---------------------------------------------------------------------------
// Email Verification
// ---------------------------------------------------------------------------

const EmailVerificationTemplate = {
  subject: 'Confirm your email - Kairos',
  renderHtml: ({ userName, verifyUrl }: EmailVerificationTemplateInput) =>
    emailWrapper(`
${logoBlock('Confirm your email')}
          <!-- Content Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #DDE3E9;">
              <p style="margin:0 0 20px;color:#222B32;font-size:16px;line-height:1.6;">Hi <strong>${userName}</strong>,</p>
              <p style="margin:0 0 24px;color:#59677C;font-size:16px;line-height:1.6;">Confirm this address to finish setting up your Kairos account. You will not be able to sign in until you do.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;background-color:#9448F2;color:#ffffff;text-decoration:none;border-radius:12px;font-size:16px;font-weight:bold;">Confirm email</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background-color:#FFF8E6;border-left:4px solid #FFC53D;padding:16px;border-radius:0 8px 8px 0;">
                    <p style="margin:0;color:#59677C;font-size:14px;line-height:1.6;"><strong style="color:#222B32;">Didn't sign up?</strong><br>Someone may have entered your address by mistake. Ignore this email and no account will be usable with it. The link expires in <strong>24 hours</strong>.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`),
  renderText: ({ userName, verifyUrl }: EmailVerificationTemplateInput) =>
    `Hi ${userName},

Confirm your email address to finish setting up your Kairos account:

${verifyUrl}

This link expires in 24 hours. You will not be able to sign in until the address is confirmed.

If you didn't sign up, ignore this email.

Best regards,
The Kairos Team`,
} as const;

// ---------------------------------------------------------------------------
// Note Password Reset Email (link-based)
// ---------------------------------------------------------------------------

const PasswordResetEmailTemplate = {
  subject: 'Reset Your Note Password - Kairos',
  renderHtml: ({ userName, resetUrl }: PasswordResetTemplateInput) =>
    emailWrapper(`
${logoBlock('Reset Your Note Password')}
          <!-- Content Card -->
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #DDE3E9;">
              <p style="margin:0 0 20px;color:#222B32;font-size:16px;line-height:1.6;">Hi <strong>${userName}</strong>,</p>
              <p style="margin:0 0 24px;color:#59677C;font-size:16px;line-height:1.6;">We received a request to reset the password for one of your encrypted notes. Click the button below to create a new password:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background-color:#9448F2;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px;line-height:1;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <!-- Security Notice -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background-color:#FFF8E6;border-left:4px solid #FFC53D;padding:16px;border-radius:0 8px 8px 0;">
                    <p style="margin:0;color:#59677C;font-size:14px;line-height:1.6;"><strong style="color:#222B32;">Security Notice:</strong><br>This link will expire in <strong>1 hour</strong>. If you didn't request this reset, you can safely ignore this email.</p>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;color:#59677C;font-size:14px;line-height:1.6;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="margin:8px 0 0;color:#9448F2;font-size:13px;word-break:break-all;">${resetUrl}</p>
            </td>
          </tr>`),
  renderText: ({ userName, resetUrl }: PasswordResetTemplateInput) =>
    `Hi ${userName},\n\nWe received a request to reset the password for one of your encrypted notes.\n\nClick this link to reset your password:\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request this reset, you can safely ignore this email.\n\nBest regards,\nThe Kairos Team`,
} as const;

// ---------------------------------------------------------------------------
// Email Service
// ---------------------------------------------------------------------------

type EmailServiceOptions = {
  appUrl: string;
  fromEmail: string;
};

export class EmailService {
  constructor(
    private readonly resend: Resend,
    private readonly options: EmailServiceOptions
  ) {}

  async sendPasswordResetEmail({
    email,
    userName,
    noteId,
    resetToken,
  }: PasswordResetEmailParams): Promise<{ id: string } | null> {
    const resetUrl = `${this.options.appUrl}/reset-password?noteId=${noteId}&token=${resetToken}`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.options.fromEmail,
        to: [email],
        subject: PasswordResetEmailTemplate.subject,
        html: PasswordResetEmailTemplate.renderHtml({ userName, resetUrl }),
        text: PasswordResetEmailTemplate.renderText({ userName, resetUrl }),
      });

      if (error) {
        log.error('note password reset send failed', { err: error });
        throw new Error(`Failed to send email: ${error.message}`);
      }

      return data;
    } catch (error) {
      log.error('note password reset send threw', { err: error });
      throw error;
    }
  }

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

  const rawFromEmail = process.env.RESEND_FROM_EMAIL?.trim() ?? 'Kairos <onboarding@resend.dev>';
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

export async function sendPasswordResetEmail(
  params: PasswordResetEmailParams
): Promise<{ id: string } | null> {
  return getEmailService().sendPasswordResetEmail(params);
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

export async function sendEmailVerification(
  params: EmailVerificationParams
): Promise<{ id: string } | null> {
  return getEmailService().sendEmailVerification(params);
}
