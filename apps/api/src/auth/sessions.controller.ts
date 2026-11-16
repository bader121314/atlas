import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { parseRequest, resourceIdSchema } from '@atlas/contracts';
import type { SessionListResponse } from '@atlas/contracts';
import { AuthService } from './auth.service';
import { caller, requestMeta } from './auth.controller';
import { SessionGuard } from './guards';
import type { HttpRequest } from './http';

/** Lets a signed-in user see and end their own sessions. */
@Controller('auth/sessions')
@UseGuards(SessionGuard)
export class SessionsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  list(@Req() request: HttpRequest): Promise<SessionListResponse> {
    const { user, sessionId } = caller(request);
    return this.auth.listSessions(user.id, sessionId);
  }

  @Post('revoke-others')
  @HttpCode(204)
  async revokeOthers(@Req() request: HttpRequest): Promise<void> {
    const { user, sessionId } = caller(request);
    await this.auth.revokeOtherSessions(
      user.id,
      sessionId,
      requestMeta(request),
    );
  }

  /**
   * Another user's session id answers exactly like an unknown id (404), so
   * ids cannot be probed.
   */
  @Delete(':id')
  @HttpCode(204)
  async revoke(
    @Param('id') id: string,
    @Req() request: HttpRequest,
  ): Promise<void> {
    const sessionId = parseRequest(resourceIdSchema, id);
    const { user } = caller(request);
    if (
      !sessionId ||
      !(await this.auth.revokeOwnSession(
        user.id,
        sessionId,
        requestMeta(request),
      ))
    ) {
      throw new NotFoundException();
    }
  }
}
