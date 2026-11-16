import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseAuthEnvironment, parseEnvironment } from '@atlas/config';
import { API_PREFIX, ProblemFilter } from '@atlas/shared';
import { AppModule } from './app.module';
async function bootstrap(): Promise<void> {
  const config = parseEnvironment(process.env);
  // Fail fast at startup; auth settings are otherwise read on first use.
  parseAuthEnvironment(process.env);
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  await app.listen(config.API_PORT, '127.0.0.1');
}
void bootstrap().catch(() => {
  console.error('api startup failed; verify configuration and local services.');
  process.exitCode = 1;
});
