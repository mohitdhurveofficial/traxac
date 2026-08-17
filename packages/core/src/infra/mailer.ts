import type { Logger } from "./logger.js";

/**
 * Email delivery.
 *
 * Everything that needs to send mail depends on this interface, not on a
 * provider. Until credentials are configured the log transport records what
 * *would* have been sent, so a password reset is testable end to end and
 * switching to a real provider later is one line in the container.
 *
 * Deliberately no HTML templating engine: these are short transactional
 * messages, and a template system is a dependency we do not need yet.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text is the source of truth; HTML is optional decoration. */
  text: string;
  html?: string;
  replyTo?: string;
}

export interface Mailer {
  readonly transport: "log" | "smtp" | "api";
  /** True when mail will actually leave the building. */
  readonly deliverable: boolean;
  send(message: EmailMessage): Promise<{ delivered: boolean; reason?: string }>;
}

/**
 * The default. Records the message and reports that it was not delivered, so
 * callers can tell the user "we could not email this" rather than pretending.
 */
export class LogMailer implements Mailer {
  readonly transport = "log" as const;
  readonly deliverable = false;

  constructor(private readonly logger?: Logger) {}

  async send(message: EmailMessage): Promise<{ delivered: boolean; reason?: string }> {
    this.logger?.info(
      { to: message.to, subject: message.subject },
      "email not sent: no delivery transport is configured",
    );
    return { delivered: false, reason: "No email transport is configured" };
  }
}

/** Compose the messages the application sends. */
export const EMAIL_TEMPLATES = {
  passwordReset(input: { name: string; resetUrl: string; expiresInMinutes: number }): EmailMessage {
    return {
      to: "",
      subject: "Reset your Traxac password",
      text: [
        `Hello ${input.name},`,
        "",
        "Use the link below to set a new password. It expires in " +
          `${input.expiresInMinutes} minutes and can be used once.`,
        "",
        input.resetUrl,
        "",
        "If you did not ask for this, you can ignore this email — your password has not changed.",
      ].join("\n"),
    };
  },

  teamInvitation(input: { name: string; businessName: string; inviteUrl: string }): EmailMessage {
    return {
      to: "",
      subject: `You have been added to ${input.businessName} on Traxac`,
      text: [
        `Hello ${input.name},`,
        "",
        `You now have access to ${input.businessName} on Traxac.`,
        "",
        `Set your password here: ${input.inviteUrl}`,
      ].join("\n"),
    };
  },

  ewbExpiring(input: {
    ewbNumber: string;
    invoiceNumber: string;
    hoursLeft: number;
  }): EmailMessage {
    return {
      to: "",
      subject: `e-Way Bill ${input.ewbNumber} expires in ${input.hoursLeft} hours`,
      text: [
        `The e-Way Bill for invoice ${input.invoiceNumber} expires in about ${input.hoursLeft} hours.`,
        "",
        "If the consignment is still in transit, extend it before it lapses.",
      ].join("\n"),
    };
  },
} as const;
