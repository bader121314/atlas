import { describe, expect, it } from 'vitest';
import {
  MESSAGE_TEXT,
  localeFromCookies,
  message,
  messageLocale,
} from '../packages/shared/src/messages';
import {
  composeDigest,
  composeEmail,
} from '../apps/worker/src/notifications/email';
import { composePush } from '../apps/worker/src/notifications/push';

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('server messages (ADR-066)', () => {
  it('has the same placeholders in both languages', () => {
    for (const [key, text] of Object.entries(MESSAGE_TEXT)) {
      expect([key, placeholders(text.ar)]).toEqual([
        key,
        placeholders(text.en),
      ]);
      expect(text.ar).not.toBe(text.en);
    }
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(message('en', 'reset.text', { link: 'L' })).toContain('\n\nL\n\n');
    expect(message('ar', 'invite.subject')).toContain('{organization}');
  });

  it('reads the language cookie and defaults to English', () => {
    expect(localeFromCookies('a=1; atlas_locale=ar; b=2')).toBe('ar');
    expect(localeFromCookies('atlas_locale=en')).toBe('en');
    expect(localeFromCookies('atlas_locale=fr')).toBeUndefined();
    expect(localeFromCookies('xatlas_locale=ar')).toBeUndefined();
    expect(localeFromCookies(undefined)).toBeUndefined();
    expect(messageLocale('ar')).toBe('ar');
    expect(messageLocale('en-GB')).toBe('en');
    expect(messageLocale(null)).toBe('en');
  });

  const row = {
    id: 'n1',
    kind: 'mention' as const,
    email: 'huda@example.test',
    recipient_name: 'Huda',
    actor_name: null,
    slug: 'acme',
    project_key: 'WEB',
    number: 7,
    title: 'Launch page',
    email_mode: null,
    recipient_user_id: 'u1',
  };

  it('writes notification emails and push in the recipient language', () => {
    const arabic = composeEmail({ ...row, locale: 'ar' }, 'https://atlas.test');
    expect(arabic.subject).toBe('أشار إليك شخص ما في WEB-7: Launch page');
    expect(arabic.text).toContain('مرحبًا Huda،');
    expect(arabic.text).toContain(
      'https://atlas.test/organizations/acme/projects/WEB/tasks/7',
    );
    expect(composeEmail(row, 'https://atlas.test').subject).toBe(
      'Someone mentioned you on WEB-7: Launch page',
    );
    expect(
      composePush({ ...row, locale: 'ar' }, 'https://atlas.test').title,
    ).toBe('أشار إليك شخص ما في WEB-7');
  });

  it('writes digests in the recipient language', () => {
    const digest = composeDigest(
      { email: 'h@example.test', name: 'Huda', slug: 'acme', locale: 'ar' },
      [
        {
          kind: 'task.assigned',
          actor_name: 'Sam',
          project_key: 'WEB',
          number: 1,
          title: 'A',
        },
        {
          kind: 'comment.created',
          actor_name: 'Sam',
          project_key: 'WEB',
          number: 2,
          title: 'B',
        },
      ],
      'https://atlas.test',
    );
    expect(digest.subject).toBe('ملخصك في أطلس: 2 من الإشعارات غير المقروءة');
    expect(digest.text).toContain('- WEB-1 A: أسندها Sam إليك');
    expect(digest.text).toContain('- WEB-2 B: علّق Sam');
  });
});
