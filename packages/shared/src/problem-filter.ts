import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

// Minimal HTTP adapter boundary; never return internal exception messages.
interface ProblemResponse {
  status(code: number): ProblemResponse;
  type(contentType: string): ProblemResponse;
  setHeader(name: string, value: string): void;
  send(body: {
    type: string;
    title: string;
    status: number;
    requestId?: string;
  }): void;
}
const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  429: 'Too many requests',
  503: 'Service unavailable',
};
function retryAfterSeconds(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const value: unknown = Reflect.get(exception, 'retryAfterSeconds');
  return typeof value === 'number' && value > 0 ? value : undefined;
}
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const response = host.switchToHttp().getResponse<ProblemResponse>();
    const request = host
      .switchToHttp()
      .getRequest<{ requestId?: string } | undefined>();
    const retryAfter = retryAfterSeconds(exception);
    if (retryAfter !== undefined) {
      response.setHeader('Retry-After', String(retryAfter));
    }
    response
      .status(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: TITLES[status] ?? 'Request failed',
        status,
        // Lets support find the matching log line without exposing details.
        ...(request?.requestId ? { requestId: request.requestId } : {}),
      });
  }
}
