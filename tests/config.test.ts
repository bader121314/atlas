import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../packages/config/src';
const valid = {
  DATABASE_URL: 'postgresql://user:private@localhost:5432/atlas',
  REDIS_URL: 'redis://localhost:6379',
};
describe('environment boundary', () => {
  it('coerces valid ports and provides defaults', () => {
    expect(parseEnvironment({ ...valid, API_PORT: '4001' }).API_PORT).toBe(
      4001,
    );
    expect(parseEnvironment(valid).WORKER_PORT).toBe(3002);
  });
  it.each(['0', '65536', 'oops', '1.5'])(
    'rejects invalid port %s',
    (API_PORT) => {
      expect(() => parseEnvironment({ ...valid, API_PORT })).toThrow(
        'API_PORT',
      );
    },
  );
  it('rejects missing dependencies and wrong protocols', () => {
    expect(() => parseEnvironment({})).toThrow('DATABASE_URL');
    expect(() =>
      parseEnvironment({ ...valid, REDIS_URL: 'https://localhost' }),
    ).toThrow('REDIS_URL');
  });
  it('does not echo credentials in errors', () => {
    expect(() =>
      parseEnvironment({ ...valid, DATABASE_URL: 'private-secret' }),
    ).toThrow(/^Invalid environment: DATABASE_URL$/);
  });
});
