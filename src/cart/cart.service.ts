import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCatalogServiceClient,
  createOrderServiceClient,
  FetchError,
  type Cart,
  type CheckoutResponse,
} from '@demo/contracts';
import { getCorrelationId } from '../common/correlation/correlation.context';
import { CartRedisService } from './redis/cart-redis.service';

@Injectable()
export class CartService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: CartRedisService,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = this.config.get<number>('cartTtlSeconds')!;
  }

  // Fresh client per call: correlationId lives in AsyncLocalStorage and changes
  // per request, while createXServiceClient() bakes defaultHeaders in at
  // construction time. Building the (header-only) closure per call is the
  // cheapest way to keep it current — no connection is opened until fetch() runs.
  // authHeaders forwards the caller's own credential — catalog-service's and
  // order-service's Envoy PEP sidecars verify the Cognito JWT signature (the
  // app guards only extract identity), so a request arriving without it
  // would be denied in a real deployment.
  private catalogClient(authHeaders: Record<string, string>) {
    return createCatalogServiceClient({
      baseUrl: this.config.get<string>('catalogServiceUrl')!,
      defaultHeaders: { ...authHeaders, ...this.correlationHeaders() },
    });
  }

  private orderClient(authHeaders: Record<string, string>) {
    return createOrderServiceClient({
      baseUrl: this.config.get<string>('orderServiceUrl')!,
      defaultHeaders: { ...authHeaders, ...this.correlationHeaders() },
    });
  }

  private correlationHeaders(): Record<string, string> {
    const id = getCorrelationId();
    return id ? { 'x-correlation-id': id } : {};
  }

  async getCart(email: string): Promise<Cart> {
    const items = Object.values(await this.redis.getAll(email));
    const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);
    return { userEmail: email, items, total };
  }

  /**
   * Price/name are resolved from catalog-service at add-time — cart-bff
   * aggregates, it never invents or caches pricing on its own.
   * "sku" here is the catalog item id; this demo doesn't model a distinct SKU.
   */
  async addItem(email: string, sku: string, qty: number, authHeaders: Record<string, string>): Promise<Cart> {
    let item;
    try {
      item = await this.catalogClient(authHeaders).getItem(sku);
    } catch (err) {
      if (err instanceof FetchError && err.status === 404) {
        throw new NotFoundException(`Catalog item ${sku} not found`);
      }
      throw new BadGatewayException('catalog-service unavailable');
    }

    await this.redis.addItem(email, sku, qty, item.price, item.name, this.ttlSeconds);
    return this.getCart(email);
  }

  async setQty(email: string, sku: string, qty: number): Promise<Cart> {
    const result = await this.redis.setQty(email, sku, qty, this.ttlSeconds);
    if (result === null) {
      throw new NotFoundException(`${sku} is not in the cart`);
    }
    return this.getCart(email);
  }

  async removeItem(email: string, sku: string): Promise<void> {
    await this.redis.removeItem(email, sku, this.ttlSeconds);
  }

  async clear(email: string): Promise<void> {
    await this.redis.clear(email);
  }

  /** No saga knowledge here: place the order, and only clear the cart once order-service confirms with a 2xx. */
  async checkout(email: string, authHeaders: Record<string, string>): Promise<CheckoutResponse> {
    const cart = await this.getCart(email);
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    let order;
    try {
      order = await this.orderClient(authHeaders).createOrder({
        userEmail: email,
        items: cart.items.map((i) => ({ sku: i.sku, qty: i.qty, price: i.price })),
      });
    } catch (err) {
      if (err instanceof FetchError) {
        throw new BadGatewayException(`order-service rejected checkout: ${err.status}`);
      }
      throw new BadGatewayException('order-service unavailable');
    }

    await this.clear(email);
    return { orderId: order.id, status: order.status };
  }
}
