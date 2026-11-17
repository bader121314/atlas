import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

export const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** An error with the SCIM `scimType` detail (RFC 7644, section 3.12). */
export class ScimError extends HttpException {
  constructor(
    status: number,
    readonly detail: string,
    readonly scimType?: string,
  ) {
    super(detail, status);
  }
}

interface ScimResponse {
  status(code: number): ScimResponse;
  type(contentType: string): ScimResponse;
  setHeader(name: string, value: string): void;
  send(body: unknown): void;
}

const DETAILS: Record<number, string> = {
  400: 'The request is not valid.',
  401: 'A valid SCIM token is required.',
  403: 'This change is not allowed.',
  404: 'Resource not found.',
  409: 'The resource already exists.',
  429: 'Too many requests.',
};

/** Errors in the SCIM format, never internal messages. */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const response = host.switchToHttp().getResponse<ScimResponse>();
    const retry: unknown =
      typeof exception === 'object' && exception !== null
        ? Reflect.get(exception, 'retryAfterSeconds')
        : undefined;
    if (typeof retry === 'number')
      response.setHeader('Retry-After', String(retry));
    response
      .status(status)
      .type('application/scim+json')
      .send({
        schemas: [SCIM_ERROR],
        status: String(status),
        detail:
          exception instanceof ScimError
            ? exception.detail
            : (DETAILS[status] ?? 'The request failed.'),
        ...(exception instanceof ScimError && exception.scimType
          ? { scimType: exception.scimType }
          : {}),
      });
  }
}
