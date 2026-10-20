import nodemailer from 'nodemailer';
import type { AppConfig } from './config';

export interface Mailer {
  configured: boolean;
  send(to: string, subject: string, text: string): Promise<void>;
  /** Messages captured when SMTP is not configured (dev / tests). */
  outbox: { to: string; subject: string; text: string }[];
}

export function createMailer(config: AppConfig): Mailer {
  const outbox: Mailer['outbox'] = [];
  if (!config.smtp) {
    return {
      configured: false,
      outbox,
      async send(to, subject, text) {
        outbox.push({ to, subject, text });
        if (outbox.length > 50) outbox.shift();
        if (!config.isTest) console.log(`[mail:not-configured] to=${to} subject="${subject}"\n${text}\n`);
      },
    };
  }
  const t = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return {
    configured: true,
    outbox,
    async send(to, subject, text) {
      await t.sendMail({ from: config.smtp!.from, to, subject, text });
    },
  };
}
