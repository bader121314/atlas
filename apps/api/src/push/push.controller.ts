import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  pushSubscriptionRequestSchema,
  pushUnsubscribeRequestSchema,
} from '@atlas/contracts';
import { isPushServiceUrl, pushAllowedHosts, vapidKeys } from '@atlas/shared';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { DatabaseService } from '../database.service';

const MAX_SUBSCRIPTIONS = 10;

/** Browser push subscriptions for the signed-in person (ADR-060). */
@Controller('push')
@UseGuards(SessionGuard)
export class PushController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  @Get('config')
  config(): { publicKey: string | null } {
    return { publicKey: vapidKeys(process.env)?.publicKey ?? null };
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    if (!vapidKeys(process.env)) throw new ServiceUnavailableException();
    const input = parse(pushSubscriptionRequestSchema, body);
    // The worker will send requests here, so only real push services.
    if (!isPushServiceUrl(input.endpoint, pushAllowedHosts(process.env)))
      throw new BadRequestException();
    const userId = caller(request).user.id;
    await this.database.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        userId,
      ]);
      // An endpoint belongs to one browser; re-subscribing moves it.
      await client.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0`,
        [
          userId,
          input.endpoint,
          input.keys.p256dh.replace(/=+$/, ''),
          input.keys.auth.replace(/=+$/, ''),
        ],
      );
      // Keep the newest few per person.
      await client.query(
        `DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN (
           SELECT id FROM push_subscriptions WHERE user_id = $1
           ORDER BY created_at DESC LIMIT $2)`,
        [userId, MAX_SUBSCRIPTIONS],
      );
    });
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @Body() body: unknown,
    @Req() request: HttpRequest,
  ): Promise<void> {
    const input = parse(pushUnsubscribeRequestSchema, body);
    await this.database.pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [caller(request).user.id, input.endpoint],
    );
  }
}
