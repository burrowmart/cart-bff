# cart-bff

## Architecture

`cart-bff` is a **Redis-only** BFF — there is no `cart-service` and no Mongo
collection. Cart state lives entirely in a Redis hash keyed by the
authenticated user's email, and every mutation runs as a single Lua script so
concurrent writes to the same line item never lose an update.

- Owns `cart:{email}` — a Redis hash, field = sku, value = JSON `{qty, price, name}`.
- The whole hash carries a TTL (`CART_TTL_SECONDS`, default 7 days) for cart
  abandonment, refreshed on every write.
- Prices/names are resolved from `catalog-service` at add-time via the typed
  `@demo/contracts` client — this BFF holds no pricing logic of its own.
- `POST /cart/checkout` calls `order-service` and clears the cart on a 2xx
  response. It has no saga/compensation knowledge — that lives in
  order-service's orchestrator.

### What this service owns

| Resource | Type | Notes |
|----------|------|-------|
| `cart:{email}` | Redis hash + TTL | field=sku, value=JSON `{qty, price, name}` |

### Why Lua scripts, not MULTI/EXEC

Every mutation is read-current-JSON → compute → write-back. `MULTI/EXEC`
queues commands blindly and can't branch on a value read earlier in the same
transaction (that needs `WATCH` + an optimistic-retry loop — a client round
trip per attempt under contention). A Lua script runs atomically on the Redis
server in one round trip, so 50 concurrent `add sku=A qty=1` calls land on
exactly qty=50 instead of racing each other. See
[`src/cart/redis/cart-redis.service.ts`](src/cart/redis/cart-redis.service.ts).

### Request flow

```
Client → POST /cart/items {sku, qty}
         ↓
CartController   (@Claims() → authenticated email; validation)
         ↓
CartService      (fetches price/name from catalog-service)
         ↓
CartRedisService (EVAL add-item.lua — atomic incr + TTL refresh)
         ↓
Redis cart:{email} hash
```

---

## Running locally

### Prerequisites

```bash
# 1. Build the shared contracts package (provides DTOs + typed clients)
cd ../contracts && npm install && npm run build && cd -

# 2. Install service dependencies
npm install

# 3. Copy env and start Redis (this service needs nothing else from compose)
cp .env.example .env
docker compose -f ../platform-infra/docker-compose.yml up -d redis
```

### Start in dev mode

```bash
npm run start:dev
# Service listens on http://localhost:3000
# Swagger UI at    http://localhost:3000/api
```

### Build

```bash
npm run build
```

### Tests

```bash
# Unit tests — CartRedisService mocked, no external deps
npm test

# E2E tests — real Redis (REDIS_URL, default redis://localhost:6379) because
# TTL expiry and cross-request atomicity can't be faithfully mocked.
npm run test:e2e
```

### curl round-trip

```bash
BASE=http://localhost:3000

# Add an item (price/name resolved from catalog-service)
curl -s -X POST $BASE/cart/items \
  -H 'Content-Type: application/json' \
  -d '{"sku":"<catalog-item-id>","qty":2}' | jq

# View cart
curl -s $BASE/cart | jq

# Set absolute qty (0 removes)
curl -s -X PATCH $BASE/cart/items/<catalog-item-id> \
  -H 'Content-Type: application/json' \
  -d '{"qty":5}' | jq

# Remove a line item
curl -s -X DELETE $BASE/cart/items/<catalog-item-id> -o /dev/null -w "%{http_code}\n"

# Checkout — calls order-service, clears the cart on 2xx
curl -s -X POST $BASE/cart/checkout | jq

# Clear the whole cart
curl -s -X DELETE $BASE/cart -o /dev/null -w "%{http_code}\n"
```

With `AUTH_DISABLED=true` (set in `.env.example`), the JWT guard bypasses
signature verification but still populates `req.claims.email` — from the
`x-test-user-email` header if present, otherwise `test@example.com` — so
every `@Claims()`-based route keeps working under test. Set
`AUTH_DISABLED=false` and point `COGNITO_ISSUER`/`COGNITO_AUDIENCE` at a real
pool for production-like local testing.
