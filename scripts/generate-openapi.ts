/**
 * Generates openapi.yaml from the NestJS Swagger module metadata.
 *
 * Run from the cart-bff directory: npm run generate:openapi
 *
 * The emitted openapi.yaml is committed to the repo and consumed by the
 * contracts package client generator.
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { AppModule } from '../src/app.module';

process.env.AUTH_DISABLED ??= 'true';

async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('Cart BFF API')
    .setDescription('Redis-only cart aggregation BFF. Cart state is keyed by the authenticated user\'s email — no Mongo, no cart-service.')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outPath = join(__dirname, '..', 'openapi.yaml');
  writeFileSync(outPath, yaml.dump(document, { lineWidth: 120, noRefs: true }));
  console.log(`openapi.yaml written to ${outPath}`);

  await app.close();
  process.exit(0);
}

generate().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
