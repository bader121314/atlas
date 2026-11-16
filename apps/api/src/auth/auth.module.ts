import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsController } from './sessions.controller';
import { OriginGuard, SessionGuard } from './guards';
import { DevelopmentConsoleMailer, Mailer } from './mailer';

@Module({
  imports: [DatabaseModule, AuditModule, RateLimitModule],
  controllers: [AuthController, SessionsController],
  providers: [
    AuthService,
    SessionGuard,
    { provide: Mailer, useClass: DevelopmentConsoleMailer },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
