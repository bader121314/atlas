import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

// Minimal HTTP adapter boundary; never return internal exception messages.
interface ProblemResponse {
  status(code: number): ProblemResponse;
  type(contentType: string): ProblemResponse;
  send(body: { type: string; title: string; status: number }): void;
}
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
        title:
          status === 503
            ? 'Service unavailable'
            : status === 404
              ? 'Not found'
              : 'Request failed',
        status,
      });
  }
}
