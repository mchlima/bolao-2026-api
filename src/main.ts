import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestContextMiddleware } from './common/request-context.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Capture per-request IP/UA/geo (from Cloudflare headers) into AsyncLocalStorage
  // so AuditService can stamp sensitive actions. Must run before routing.
  app.use(requestContextMiddleware);

  app.setGlobalPrefix(process.env.API_GLOBAL_PREFIX ?? 'api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
