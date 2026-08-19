import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CART_REDIS_CLIENT } from './cart-redis.tokens';

// Global within this service: the cart hash is the only piece of state
// cart-bff owns, and it's read/written from a single controller — one shared
// connection avoids reconnect overhead per module.
@Global()
@Module({
  providers: [
    {
      provide: CART_REDIS_CLIENT,
      useFactory: (config: ConfigService): Redis => {
        const url = config.get<string>('redisUrl')!;
        return new Redis(url);
      },
      inject: [ConfigService],
    },
  ],
  exports: [CART_REDIS_CLIENT],
})
export class CartRedisModule {}
