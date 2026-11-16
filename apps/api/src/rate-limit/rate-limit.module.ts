import { Module } from '@nestjs/common';
import { RedisService } from '../redis.service';
import {
  RateLimitService,
  RateLimitSettings,
  defaultRateLimitSettings,
} from './rate-limit.service';

@Module({
  providers: [
    RedisService,
    RateLimitService,
    { provide: RateLimitSettings, useValue: defaultRateLimitSettings },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}
