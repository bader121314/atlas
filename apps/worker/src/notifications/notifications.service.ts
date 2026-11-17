import { Injectable, Logger } from '@nestjs/common';
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { parseEnvironment } from '@atlas/config';
import { digestBatch, emailBatch } from './email';
import type { MailMessage } from './email';
import { notifyBatch } from './notifier';
import { tracked } from '../metrics';

const NOTIFY_MS = 1000;
const EMAIL_MS = 15_000;

/** Worker-only settings; invalid values fall back to the defaults. */
export function notificationSettings(env: Record<string, string | undefined>) {
  let webOrigin = 'http://localhost:3000';
  try {
    if (env.WEB_ORIGIN) webOrigin = new URL(env.WEB_ORIGIN).origin;
  } catch {
    // Keep the default.
  }
  const delay = Number(env.NOTIFICATION_EMAIL_DELAY_MS ?? 120_000);
  return {
    webOrigin,
    delayMs: Number.isInteger(delay) && delay >= 0 ? delay : 120_000,
  };
}

/**
 * Development transport, as in the API: prints messages to the worker log.
 * Production refuses to send until a real transport is configured.
 */
export class ConsoleMailer {
  private readonly logger = new Logger('Mailer');

  async send(message: MailMessage): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('No production mail transport is configured');
    }
    this.logger.log(
      `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
  }
}

/** Runs the notifier and the email sender inside the worker (ADR-031). */
@Injectable()
export class NotificationsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger('Notifications');
  private readonly mailer = new ConsoleMailer();
  private pool: Pool | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private busy = { notify: false, email: false, digest: false };

  onApplicationBootstrap(): void {
    const config = parseEnvironment(process.env);
    const settings = notificationSettings(process.env);
    const pool = new Pool({ connectionString: config.DATABASE_URL, max: 2 });
    this.pool = pool;
    this.timers.push(
      setInterval(() => {
        void this.once('notify', () => notifyBatch(pool));
      }, NOTIFY_MS),
      setInterval(
        () => {
          void this.once('email', () =>
            emailBatch(pool, (m) => this.mailer.send(m), {
              delayMs: settings.delayMs,
              webOrigin: settings.webOrigin,
            }),
          );
        },
        Math.min(EMAIL_MS, Math.max(settings.delayMs, 1000)),
      ),
      setInterval(() => {
        void this.once('digest', () =>
          digestBatch(pool, (m) => this.mailer.send(m), {
            webOrigin: settings.webOrigin,
          }),
        );
      }, 60_000),
    );
  }

  private async once(
    name: 'notify' | 'email' | 'digest',
    run: () => Promise<unknown>,
  ): Promise<void> {
    if (this.busy[name]) return;
    this.busy[name] = true;
    try {
      await tracked(name, run);
    } catch {
      this.logger.error(`${name} batch failed; retrying`);
    } finally {
      this.busy[name] = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    this.timers = [];
    await this.pool?.end();
  }
}
