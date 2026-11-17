import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { searchQuerySchema } from '@atlas/contracts';
import type { SearchResult } from '@atlas/contracts';
import { caller, parse } from '../auth/auth.controller';
import { SessionGuard } from '../auth/guards';
import type { HttpRequest } from '../auth/http';
import { RequirePermission, TenantGuard } from '../organizations/tenant.guard';
import { tenantOf } from '../projects/projects.controller';
import { SearchService } from './search.service';

@Controller('organizations/:slug/search')
@UseGuards(SessionGuard, TenantGuard)
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly searcher: SearchService,
  ) {}

  @Get()
  @RequirePermission('organization.read')
  search(
    @Query() query: unknown,
    @Req() request: HttpRequest,
  ): Promise<SearchResult[]> {
    return this.searcher.search(
      tenantOf(request),
      caller(request).user.id,
      parse(searchQuerySchema, query).q,
    );
  }
}
