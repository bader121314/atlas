import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../redis.service';

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

// Defaults chosen to stop online guessing while tolerating typos and shared
// networks. Counted per fixed window; see ADR-012.
export const DEFAULT_RATE_LIMITS = {
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  loginPerAccount: { limit: 10, windowSeconds: 15 * 60 },
  signupPerIp: { limit: 10, windowSeconds: 60 * 60 },
  verifyPerIp: { limit: 30, windowSeconds: 15 * 60 },
  resendPerIp: { limit: 10, windowSeconds: 60 * 60 },
  resendPerAccount: { limit: 3, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;
export type RateLimitName = keyof typeof DEFAULT_RATE_LIMITS;

export abstract class RateLimitSettings {
  abstract readonly prefix: string;
  abstract readonly rules: Record<RateLimitName, RateLimitRule>;
}

export const defaultRateLimitSettings: RateLimitSettings = {
  prefix: 'rl:',
  rules: DEFAULT_RATE_LIMITS,
};

export interface RateLimitCheck {
  rule: RateLimitName;
  /** Caller identity (IP address or normalized email). Hashed before use. */
  subject: string;
}

// INCR and set the window expiry atomically; returns [count, ttlMs].
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;
const COMMAND_TIMEOUT_MS = 2000;

export class TooManyRequestsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class RateLimitService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RateLimitSettings) private readonly settings: RateLimitSettings,
  ) {}

  /**
   * Counts one attempt against every check and throws 429 if any limit is
   * exceeded. Fails closed with 503 when Redis is unavailable: brute-force
   * protection must not silently switch off during an outage.
   */
  async consume(checks: RateLimitCheck[]): Promise<void> {
    let retryAfter = 0;
    for (const check of checks) {
      const rule = this.settings.rules[check.rule];
      const [count, ttlMs] = await this.increment(
        this.key(check),
        rule.windowSeconds * 1000,
      );
      if (count > rule.limit) {
        retryAfter = Math.max(retryAfter, Math.ceil(ttlMs / 1000));
      }
    }
    if (retryAfter > 0) throw new TooManyRequestsException(retryAfter);
  }

  private key(check: RateLimitCheck): string {
    // Hash identities so Redis never holds raw emails or IP addresses.
    const subject = createHash('sha256').update(check.subject).digest('hex');
    return `${this.settings.prefix}${check.rule}:${subject}`;
  }

  private async increment(
    key: string,
    windowMs: number,
  ): Promise<[number, number]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        this.redis.client().then((client) =>
          client.eval(CONSUME_SCRIPT, {
            keys: [key],
            arguments: [String(windowMs)],
          }),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('rate limit timeout')),
            COMMAND_TIMEOUT_MS,
          );
        }),
      ]);
      if (
        !Array.isArray(reply) ||
        typeof reply[0] !== 'number' ||
        typeof reply[1] !== 'number'
      ) {
        throw new Error('unexpected rate limit reply');
      }
      return [reply[0], Math.max(reply[1], 1000)];
    } catch {
      throw new ServiceUnavailableException();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
