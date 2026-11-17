import { describe, expect, it } from 'vitest';
import {
  checkWebhookUrl,
  isPublicAddress,
  openSecret,
  sealSecret,
  signWebhook,
  verifyWebhook,
  webhookSettings,
} from '../packages/shared/src';
import { retryDelayMs } from '../apps/worker/src/webhooks/sender';

describe('webhook address checks', () => {
  it.each([
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['2606:4700::1111', true],
    ['::ffff:8.8.8.8', true],
    ['10.0.0.1', false],
    ['172.20.1.1', false],
    ['192.168.1.1', false],
    ['127.0.0.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['::', false],
    ['fd12::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['64:ff9b::10.0.0.1', false],
    ['not-an-ip', false],
  ])('%s is public: %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it('refuses unsafe endpoint URLs', () => {
    expect(checkWebhookUrl('https://hooks.example.com/atlas')).toBeUndefined();
    expect(checkWebhookUrl('http://hooks.example.com/atlas')).toBe('protocol');
    expect(
      checkWebhookUrl('http://hooks.example.com/atlas', { allowHttp: true }),
    ).toBeUndefined();
    expect(checkWebhookUrl('https://10.1.2.3/x')).toBe('address');
    expect(checkWebhookUrl('https://[::1]/x')).toBe('address');
    expect(checkWebhookUrl('https://localhost/x')).toBe('address');
    expect(checkWebhookUrl('https://metadata.google.internal/x')).toBe(
      'address',
    );
    expect(checkWebhookUrl('https://user:pass@example.com/x')).toBe(
      'credentials',
    );
    expect(checkWebhookUrl('ftp://example.com')).toBe('protocol');
    expect(checkWebhookUrl('not a url')).toBe('invalid');
  });

  it('ignores development overrides in production', () => {
    const env = {
      WEBHOOK_SECRET_KEY: 'k'.repeat(32),
      WEBHOOK_ALLOW_HTTP: 'true',
      WEBHOOK_ALLOWED_HOSTS: '127.0.0.1',
    };
    expect(webhookSettings(env)).toMatchObject({
      allowHttp: true,
      allowedHosts: ['127.0.0.1'],
    });
    expect(webhookSettings({ ...env, NODE_ENV: 'production' })).toMatchObject({
      allowHttp: false,
      allowedHosts: [],
    });
    expect(webhookSettings({ WEBHOOK_SECRET_KEY: 'short' })).toBeUndefined();
  });
});

describe('webhook signatures and secrets', () => {
  it('verifies a genuine signature and rejects tampering or old timestamps', () => {
    const now = 1_800_000_000_000;
    const timestamp = now / 1000;
    const body = '{"id":"e1"}';
    const header = signWebhook('whsec_test', timestamp, body);
    expect(header).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyWebhook('whsec_test', timestamp, body, header, now)).toBe(
      true,
    );
    expect(
      verifyWebhook('whsec_test', timestamp, '{"id":"e2"}', header, now),
    ).toBe(false);
    expect(verifyWebhook('whsec_other', timestamp, body, header, now)).toBe(
      false,
    );
    expect(
      verifyWebhook('whsec_test', timestamp, body, header, now + 301_000),
    ).toBe(false);
  });

  it('seals secrets so only the same key opens them', () => {
    const sealed = sealSecret('whsec_abc', 'material-one');
    expect(sealed).not.toContain('whsec_abc');
    expect(openSecret(sealed, 'material-one')).toBe('whsec_abc');
    expect(() => openSecret(sealed, 'material-two')).toThrow();
  });

  it('backs off from ten seconds to an hour', () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([10_000, 20_000, 40_000]);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});
