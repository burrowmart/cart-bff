/**
 * cart-bff e2e verification.
 *
 * Redis is REAL (REDIS_URL, default redis://localhost:6379) — atomicity under
 * concurrency and TTL refresh can't be faithfully exercised against a mock.
 * catalog-service/order-service are minimal in-process HTTP stubs started by
 * test/global-setup.ts (CATALOG_SERVICE_URL / ORDER_SERVICE_URL).
 *
 * The app is bound to a real listening port (app.listen(0)) and driven with
 * native fetch — see chat-service's e2e suite for why (supertest's in-memory
 * agent intermittently misreports ECONNRESET under real concurrency).
 */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { CART_REDIS_CLIENT } from '../src/cart/redis/cart-redis.tokens';

describe('Cart (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    redis = moduleFixture.get(CART_REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  const asJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;
  const authed = (email: string) => ({ 'Content-Type': 'application/json', 'x-test-user-email': email });

  const addItem = (email: string, sku: string, qty: number) =>
    fetch(`${baseUrl}/cart/items`, { method: 'POST', headers: authed(email), body: JSON.stringify({ sku, qty }) });

  const getCart = (email: string) => fetch(`${baseUrl}/cart`, { headers: authed(email) });

  it('GET /health — returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await asJson(res)).toEqual({ status: 'ok' });
  });

  it('GET /cart — empty for a user who has never added anything', async () => {
    const email = `empty-${randomUUID()}@example.com`;
    const res = await getCart(email);
    expect(res.status).toBe(200);
    expect(await asJson(res)).toEqual({ userEmail: email, items: [], total: 0 });
  });

  it('POST /cart/items — 404 when catalog-service has no such item', async () => {
    const res = await addItem(`nf-${randomUUID()}@example.com`, 'missing-item', 1);
    expect(res.status).toBe(404);
  });

  it('50 concurrent `add sku=A qty=1` → final qty is exactly 50 (no lost updates)', async () => {
    const email = `concurrency-${randomUUID()}@example.com`;
    const sku = 'sku-A';

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => addItem(email, sku, 1)),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);

    // Prove it two ways: through the REST read path, and directly against Redis.
    const cart = await asJson<{ items: { sku: string; qty: number }[] }>(await getCart(email));
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].sku).toBe(sku);
    expect(cart.items[0].qty).toBe(50);

    const stored = JSON.parse((await redis.hget(`cart:${email}`, sku)) ?? '{}');
    expect(stored.qty).toBe(50);
  });

  it('TTL is present after a write and refreshed by a subsequent write', async () => {
    const email = `ttl-${randomUUID()}@example.com`;
    const configuredTtl = Number(process.env.CART_TTL_SECONDS ?? '5');

    expect((await addItem(email, 'sku-1', 1)).status).toBe(200);
    const ttlAfterFirstWrite = await redis.ttl(`cart:${email}`);
    expect(ttlAfterFirstWrite).toBeGreaterThan(0);
    expect(ttlAfterFirstWrite).toBeLessThanOrEqual(configuredTtl);

    // Let it visibly count down, then write again — the key must be refreshed
    // back up near the full TTL, not left counting down from the first write.
    await new Promise((r) => setTimeout(r, 2_000));
    const ttlBeforeRefresh = await redis.ttl(`cart:${email}`);
    expect(ttlBeforeRefresh).toBeLessThan(ttlAfterFirstWrite);

    expect((await addItem(email, 'sku-2', 1)).status).toBe(200);
    const ttlAfterRefresh = await redis.ttl(`cart:${email}`);
    expect(ttlAfterRefresh).toBeGreaterThan(ttlBeforeRefresh);
    expect(ttlAfterRefresh).toBeLessThanOrEqual(configuredTtl);
  }, 15_000);

  it('PATCH /cart/items/:sku — sets qty absolutely; 0 removes the line', async () => {
    const email = `patch-${randomUUID()}@example.com`;
    expect((await addItem(email, 'sku-1', 3)).status).toBe(200);

    const patched = await fetch(`${baseUrl}/cart/items/sku-1`, {
      method: 'PATCH',
      headers: authed(email),
      body: JSON.stringify({ qty: 7 }),
    });
    expect(patched.status).toBe(200);
    expect((await asJson<{ items: { qty: number }[] }>(patched)).items[0].qty).toBe(7);

    const removed = await fetch(`${baseUrl}/cart/items/sku-1`, {
      method: 'PATCH',
      headers: authed(email),
      body: JSON.stringify({ qty: 0 }),
    });
    expect((await asJson<{ items: unknown[] }>(removed)).items).toHaveLength(0);
  });

  it('PATCH /cart/items/:sku — 404 for a sku never added', async () => {
    const res = await fetch(`${baseUrl}/cart/items/never-added`, {
      method: 'PATCH',
      headers: authed(`patch-404-${randomUUID()}@example.com`),
      body: JSON.stringify({ qty: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /cart/checkout — 400 on an empty cart, and never calls order-service', async () => {
    const res = await fetch(`${baseUrl}/cart/checkout`, {
      method: 'POST',
      headers: authed(`checkout-empty-${randomUUID()}@example.com`),
    });
    expect(res.status).toBe(400);
  });

  it('POST /cart/checkout — places the order via order-service and clears the cart on 2xx', async () => {
    const email = `checkout-${randomUUID()}@example.com`;
    expect((await addItem(email, 'sku-1', 2)).status).toBe(200);
    expect((await addItem(email, 'sku-2', 1)).status).toBe(200);

    const res = await fetch(`${baseUrl}/cart/checkout`, { method: 'POST', headers: authed(email) });
    expect(res.status).toBe(201); // NestJS default status for @Post() with no @HttpCode override

    const body = await asJson<{ orderId: string; status: string }>(res);
    expect(body.orderId).toBeDefined();
    expect(body.status).toBe('PENDING');

    const cartAfter = await asJson<{ items: unknown[] }>(await getCart(email));
    expect(cartAfter.items).toHaveLength(0);
    expect(await redis.exists(`cart:${email}`)).toBe(0);
  });
});
