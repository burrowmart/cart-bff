import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { CartItem } from '@demo/contracts';
import { CART_REDIS_CLIENT } from './cart-redis.tokens';

const cartKey = (email: string) => `cart:${email}`;

interface StoredItem {
  qty: number;
  price: number;
  name: string;
}

/**
 * Every mutation here is a single Lua script (EVAL), not MULTI/EXEC.
 *
 * MULTI/EXEC queues blind commands — it cannot branch on a value read earlier
 * in the same transaction (that needs WATCH + optimistic-retry, i.e. a client
 * round trip per attempt). Every op below is read-current-JSON -> compute ->
 * write-back, which is exactly the shape Lua is for: the whole script runs as
 * one atomic, non-interleaved unit on the Redis server. That's what makes 50
 * concurrent `add sku=A qty=1` calls land on qty=50 instead of losing updates
 * to a lost-update race (two clients reading qty=N before either writes N+1).
 */
const ADD_ITEM_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
local delta = tonumber(ARGV[2])
local qty = delta
if existing then
  local item = cjson.decode(existing)
  qty = item.qty + delta
end
local encoded = cjson.encode({ qty = qty, price = tonumber(ARGV[3]), name = ARGV[4] })
redis.call('HSET', KEYS[1], ARGV[1], encoded)
redis.call('EXPIRE', KEYS[1], ARGV[5])
return qty
`;

const SET_QTY_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
if not existing then
  return -1
end
local qty = tonumber(ARGV[2])
if qty <= 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
  return 0
end
local item = cjson.decode(existing)
item.qty = qty
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(item))
redis.call('EXPIRE', KEYS[1], ARGV[3])
return qty
`;

const REMOVE_ITEM_SCRIPT = `
redis.call('HDEL', KEYS[1], ARGV[1])
local remaining = redis.call('HLEN', KEYS[1])
if remaining > 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return remaining
`;

@Injectable()
export class CartRedisService {
  constructor(@Inject(CART_REDIS_CLIENT) private readonly redis: Redis) {}

  /** Increments qty for sku (creates it at `delta` if absent); refreshes TTL. Returns the new qty. */
  async addItem(
    email: string,
    sku: string,
    delta: number,
    price: number,
    name: string,
    ttlSeconds: number,
  ): Promise<number> {
    const qty = await this.redis.eval(
      ADD_ITEM_SCRIPT,
      1,
      cartKey(email),
      sku,
      delta,
      price,
      name,
      ttlSeconds,
    );
    return Number(qty);
  }

  /** Sets qty absolutely; qty<=0 removes the line. Returns null if the sku isn't in the cart. */
  async setQty(email: string, sku: string, qty: number, ttlSeconds: number): Promise<number | null> {
    const result = await this.redis.eval(SET_QTY_SCRIPT, 1, cartKey(email), sku, qty, ttlSeconds);
    return Number(result) === -1 ? null : Number(result);
  }

  /** Removes a line item outright; refreshes TTL only if the cart still has items. */
  async removeItem(email: string, sku: string, ttlSeconds: number): Promise<void> {
    await this.redis.eval(REMOVE_ITEM_SCRIPT, 1, cartKey(email), sku, ttlSeconds);
  }

  /** Deletes the whole cart hash — a single native command is already atomic; no script needed. */
  async clear(email: string): Promise<void> {
    await this.redis.del(cartKey(email));
  }

  async getAll(email: string): Promise<Record<string, CartItem>> {
    const raw = await this.redis.hgetall(cartKey(email));
    const items: Record<string, CartItem> = {};
    for (const [sku, json] of Object.entries(raw)) {
      const stored = JSON.parse(json) as StoredItem;
      items[sku] = { sku, qty: stored.qty, price: stored.price, name: stored.name };
    }
    return items;
  }

  /** -2 if the key doesn't exist (empty/never-created cart), -1 if it exists with no TTL. */
  async ttl(email: string): Promise<number> {
    return this.redis.ttl(cartKey(email));
  }
}
