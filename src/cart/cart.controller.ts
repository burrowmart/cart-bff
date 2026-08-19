import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from 'jsonwebtoken';
import { Claims } from '../common/auth/claims.decorator';
import { forwardAuthHeaders } from '../common/auth/forward-auth-headers.helper';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { SetCartItemQtyDto } from './dto/set-cart-item-qty.dto';

@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly service: CartService) {}

  @Get()
  @ApiOkResponse({ description: 'The authenticated user\'s cart' })
  getCart(@Claims() claims: JwtPayload) {
    return this.service.getCart(claims.email as string);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Item added (qty incremented); price/name resolved from catalog-service' })
  addItem(
    @Claims() claims: JwtPayload,
    @Body() dto: AddCartItemDto,
    @Headers() headers: Record<string, string>,
  ) {
    return this.service.addItem(claims.email as string, dto.sku, dto.qty, forwardAuthHeaders(headers));
  }

  @Patch('items/:sku')
  @ApiOkResponse({ description: 'Line item quantity set absolutely; 0 removes it' })
  setQty(@Claims() claims: JwtPayload, @Param('sku') sku: string, @Body() dto: SetCartItemQtyDto) {
    return this.service.setQty(claims.email as string, sku, dto.qty);
  }

  @Delete('items/:sku')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Line item removed' })
  removeItem(@Claims() claims: JwtPayload, @Param('sku') sku: string) {
    return this.service.removeItem(claims.email as string, sku);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Cart cleared' })
  clear(@Claims() claims: JwtPayload) {
    return this.service.clear(claims.email as string);
  }

  @Post('checkout')
  @ApiCreatedResponse({ description: 'Order placed via order-service; cart cleared on success' })
  checkout(@Claims() claims: JwtPayload, @Headers() headers: Record<string, string>) {
    return this.service.checkout(claims.email as string, forwardAuthHeaders(headers));
  }
}
