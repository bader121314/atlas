import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseAuthEnvironment, parseEnvironment } from '@atlas/config';
import {
  API_PREFIX,
  ProblemFilter,
  requestLogging,
  trustProxySetting,
} from '@atlas/shared';
import { AppModule } from './app.module';
async function bootstrap(): Promise<void> {
  const config = parseEnvironment(process.env);
  // Fail fast at startup; auth settings are otherwise read on first use.
  parseAuthEnvironment(process.env);
  const app = await NestFactory.create(AppModule);
  // Behind the web server (or a load balancer) the client address comes from
  // X-Forwarded-For, but only from proxies TRUST_PROXY names.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
  app.use(requestLogging());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  await app.listen(config.API_PORT, '127.0.0.1');
}
void bootstrap().catch(() => {
  console.error('api startup failed; verify configuration and local services.');
  process.exitCode = 1;
});
