import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, startAuthApp } from './support/auth-app';

// Emails follow the language each person chose in the app (ADR-066).
let app: Awaited<ReturnType<typeof startAuthApp>>;
beforeAll(async () => {
  app = await startAuthApp();
});
afterAll(async () => {
  await app.close();
});

const last = (to: string) => app.mailer.sent.filter((m) => m.to === to).at(-1);

describe('email language', () => {
  it('sends the verification email in the language chosen at sign-up', async () => {
    const arabic = app.email('arabic-signup');
    await app.request('POST', '/signup', {
      body: { email: arabic, password: PASSWORD, displayName: 'Huda' },
      headers: { cookie: 'theme=dark; atlas_locale=ar' },
    });
    expect(last(arabic)?.subject).toBe('تأكيد بريدك الإلكتروني في أطلس');
    expect(last(arabic)?.text).toContain('/verify-email?token=');

    const english = app.email('english-signup');
    await app.request('POST', '/signup', {
      body: { email: english, password: PASSWORD, displayName: 'Sam' },
    });
    expect(last(english)?.subject).toBe('Verify your Atlas email address');
  });

  it('stores a language chosen in the app or on the sign-in page', async () => {
    const address = await app.verifiedAccount('switcher');
    const cookie = await app.login(address);
    expect(
      (await app.request('PUT', '/locale', { cookie, body: { locale: 'ar' } }))
        .status,
    ).toBe(204);
    await app.request('POST', '/password-reset/request', {
      body: { email: address },
    });
    expect(last(address)?.subject).toBe('إعادة تعيين كلمة مرورك في أطلس');

    // Signing in with the English cookie switches emails back.
    const response = await app.request('POST', '/login', {
      body: { email: address, password: PASSWORD },
      headers: { cookie: 'atlas_locale=en' },
    });
    expect(response.status).toBe(204);
    await app.request('POST', '/password-reset/request', {
      body: { email: address },
    });
    expect(last(address)?.subject).toBe('Reset your Atlas password');
  });

  it('rejects unknown languages and anonymous changes', async () => {
    const address = await app.verifiedAccount('strict');
    const cookie = await app.login(address);
    expect(
      (
        await app.request('PUT', '/locale', {
          cookie,
          body: { locale: 'fr' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await app.request('PUT', '/locale', { body: { locale: 'ar' } })).status,
    ).toBe(401);
  });
});
