import type { Queue } from 'bullmq';
import type { Config } from './config.js';
export interface MagicLinkEmail {
  email: string;
  url: string;
}
export interface EmailSender {
  sendMagicLink(message: MagicLinkEmail): Promise<void>;
}
export class ResendEmailSender implements EmailSender {
  constructor(private config: Config) {}
  async sendMagicLink(message: MagicLinkEmail) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.EMAIL_FROM,
        to: message.email,
        subject: 'Sign in to Prompt Lab',
        text: `Your sign-in link expires in 15 minutes: ${message.url}`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Email delivery failed with status ${response.status}`);
  }
}
export class QueuedEmailSender implements EmailSender {
  constructor(private queue: Queue) {}
  async sendMagicLink(message: MagicLinkEmail) {
    await this.queue.add('email.send', message, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: { age: 900 },
    });
  }
}
export class ConsoleEmailSender implements EmailSender {
  async sendMagicLink(message: MagicLinkEmail) {
    console.log(`[TEST EMAIL] ${message.url}`);
  }
}
