import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { CartModule } from './cart/cart.module';
import { CommonModule } from './common/common.module';
import { RayIdMiddleware } from './common/tracing/ray-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    CommonModule,
    CartModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply at the Express level so trace.getActiveSpan() is inside the OTel HTTP span
    consumer.apply(RayIdMiddleware).forRoutes('*');
  }
}
