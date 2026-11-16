import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseService } from '../database.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OriginGuard, SessionGuard } from './guards';
import { DevelopmentConsoleMailer, Mailer } from './mailer';

@Module({
  controllers: [AuthController],
  providers: [
    DatabaseService,
    AuthService,
    SessionGuard,
    { provide: Mailer, useClass: DevelopmentConsoleMailer },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
