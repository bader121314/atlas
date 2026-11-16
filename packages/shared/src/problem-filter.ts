import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

// Minimal HTTP adapter boundary; never return internal exception messages.
interface ProblemResponse {
  status(code: number): ProblemResponse;
  type(contentType: string): ProblemResponse;
  send(body: { type: string; title: string; status: number }): void;
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
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    host
      .switchToHttp()
      .getResponse<ProblemResponse>()
      .status(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: TITLES[status] ?? 'Request failed',
        status,
      });
  }
}
