import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  parseScimFilter,
  scimListQuerySchema,
  scimPatchSchema,
  scimUserSchema,
} from '@atlas/contracts';
import { parse, requestMeta } from '../auth/auth.controller';
import { idParam } from '../projects/projects.controller';
import { ScimError, ScimExceptionFilter } from './scim.errors';
import { ScimGuard, scimTenantOf } from './scim.guard';
import type { ScimRequest } from './scim.guard';
import { SCIM_LIST, SCIM_USER, ScimService } from './scim.service';
import type { ScimUser } from './scim.service';

const CONTENT_TYPE = 'application/scim+json';

/** SCIM 2.0 (RFC 7643/7644) for users of one organization (ADR-055). */
@Controller('scim/v2')
@UseGuards(ScimGuard)
@UseFilters(ScimExceptionFilter)
export class ScimController {
  constructor(@Inject(ScimService) private readonly scim: ScimService) {}

  @Get('ServiceProviderConfig')
  @Header('Content-Type', CONTENT_TYPE)
  config() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Bearer token',
          description: 'An organization SCIM token created by an owner.',
        },
      ],
    };
  }

  @Get('ResourceTypes')
  @Header('Content-Type', CONTENT_TYPE)
  resourceTypes() {
    return {
      schemas: [SCIM_LIST],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: SCIM_USER,
        },
      ],
    };
  }

  @Get('Users')
  @Header('Content-Type', CONTENT_TYPE)
  list(@Query() query: unknown, @Req() request: ScimRequest) {
    const parsed = parse(scimListQuerySchema, query);
    const filter = parseScimFilter(parsed.filter);
    if (filter === undefined)
      throw new ScimError(
        400,
        'Only userName eq and externalId eq filters are supported.',
        'invalidFilter',
      );
    return this.scim.list(
      scimTenantOf(request),
      filter,
      parsed.startIndex,
      parsed.count,
    );
  }

  @Get('Users/:id')
  @Header('Content-Type', CONTENT_TYPE)
  get(@Param('id') id: string, @Req() request: ScimRequest): Promise<ScimUser> {
    return this.scim.get(scimTenantOf(request), idParam(id));
  }

  @Post('Users')
  @Header('Content-Type', CONTENT_TYPE)
  create(
    @Body() body: unknown,
    @Req() request: ScimRequest,
  ): Promise<ScimUser> {
    return this.scim.create(
      scimTenantOf(request),
      parse(scimUserSchema, body),
      requestMeta(request),
    );
  }

  @Put('Users/:id')
  @Header('Content-Type', CONTENT_TYPE)
  replace(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: ScimRequest,
  ): Promise<ScimUser> {
    return this.scim.replace(
      scimTenantOf(request),
      idParam(id),
      parse(scimUserSchema, body),
      requestMeta(request),
    );
  }

  @Patch('Users/:id')
  @Header('Content-Type', CONTENT_TYPE)
  patch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: ScimRequest,
  ): Promise<ScimUser> {
    return this.scim.patch(
      scimTenantOf(request),
      idParam(id),
      parse(scimPatchSchema, body).Operations,
      requestMeta(request),
    );
  }

  @Delete('Users/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Req() request: ScimRequest): Promise<void> {
    return this.scim.remove(
      scimTenantOf(request),
      idParam(id),
      requestMeta(request),
    );
  }
}
