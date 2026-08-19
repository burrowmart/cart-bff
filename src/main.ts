// tracing MUST be the first import — instruments http/express before any module loads
import './common/tracing/tracing';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  // Swagger UI + doc generation — always on for demo; the `/api` path is
  // blocked in prod by the Envoy PEP sidecar (path allow-list in OPA policy).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cart BFF API')
    .setDescription('Redis-only cart aggregation BFF. Cart state is keyed by the authenticated user\'s email — no Mongo, no cart-service.')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? '3000';
  await app.listen(port);
}

bootstrap();
