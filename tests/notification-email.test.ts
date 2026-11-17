import { describe, expect, it } from 'vitest';
import { composeEmail } from '../apps/worker/src/notifications/email';
import { notificationSettings } from '../apps/worker/src/notifications/notifications.service';

const row = {
  id: 'n1',
  kind: 'comment.created' as const,
  email: 'bob@example.test',
  recipient_name: 'Bob',
  actor_name: 'Alice',
  slug: 'northwind',
  project_key: 'NW',
  number: 12,
  title: 'Chart the harbour',
  email_enabled: null,
};

describe('notification email', () => {
  it('says who did what and links to the task', () => {
    const mail = composeEmail(row, 'https://atlas.test');
    expect(mail.subject).toBe('New comment on NW-12: Chart the harbour');
    expect(mail.text).toContain('Alice commented on NW-12.');
    expect(mail.text).toContain(
      'https://atlas.test/organizations/northwind/projects/NW/tasks/12',
    );
    expect(
      composeEmail({ ...row, kind: 'task.assigned', actor_name: null }, 'x')
        .text,
    ).toContain('Someone assigned NW-12 to you.');
  });

  it('reads worker settings with safe defaults', () => {
    expect(notificationSettings({})).toEqual({
      webOrigin: 'http://localhost:3000',
      delayMs: 120_000,
    });
    expect(
      notificationSettings({
        WEB_ORIGIN: 'https://atlas.test/path',
        NOTIFICATION_EMAIL_DELAY_MS: '0',
      }),
    ).toEqual({ webOrigin: 'https://atlas.test', delayMs: 0 });
    expect(
      notificationSettings({ NOTIFICATION_EMAIL_DELAY_MS: '-5' }).delayMs,
    ).toBe(120_000);
  });
});
