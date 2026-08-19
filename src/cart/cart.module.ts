import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartRedisService } from './redis/cart-redis.service';
import { CartRedisModule } from './redis/cart-redis.module';

@Module({
  imports: [CartRedisModule],
  controllers: [CartController],
  providers: [CartService, CartRedisService],
})
export class CartModule {}
