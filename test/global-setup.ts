/**
 * Jest globalSetup — runs once before any test file is loaded.
 *
 * cart-bff owns no Mongo collection, so unlike every domain service there is
 * no MongoMemoryServer here. Its only two dependencies are Redis (real —
 * REDIS_URL, default the platform-infra compose stack, because the TTL and
 * atomicity proofs can't be faithfully exercised against a mock) and two
 * downstream REST services, which are stood up here as minimal in-process
 * HTTP stubs so the e2e suite doesn't depend on catalog-service/order-service
 * actually running.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

interface CreateOrderBody {
  userEmail: string;
  items: Array<{ sku: string; qty: number; price: number }>;
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Echoes back a fixed-price item for any sku, except 'missing-item' -> 404 (used to test the not-found path). */
function startCatalogStub(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const match = /^\/catalog\/([^/]+)$/.exec(req.url ?? '');
      if (req.method === 'GET' && match) {
        const id = decodeURIComponent(match[1]);
        if (id === 'missing-item') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id,
            name: `Item ${id}`,
            description: 'stub catalog item',
            price: 1000,
            stock: 999,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/** Accepts any POST /orders and returns it PENDING — cart-bff's checkout seam only needs a 2xx to clear the cart on. */
function startOrderStub(): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/orders') {
        void readJsonBody<CreateOrderBody>(req).then((body) => {
          const total = (body.items ?? []).reduce((sum, i) => sum + i.qty * i.price, 0);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: randomUUID(),
              userEmail: body.userEmail,
              items: body.items ?? [],
              total,
              status: 'PENDING',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          );
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'not found' }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function port(server: Server): number {
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('stub server failed to bind a TCP port');
  return addr.port;
}

export default async function globalSetup(): Promise<void> {
  const [catalog, order] = await Promise.all([startCatalogStub(), startOrderStub()]);

  process.env.PORT = '3010';
  process.env.AUTH_DISABLED = 'true';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
  // Short TTL so the e2e suite can prove presence + refresh without a multi-day sleep.
  process.env.CART_TTL_SECONDS = process.env.CART_TTL_SECONDS ?? '5';
  process.env.CATALOG_SERVICE_URL = `http://127.0.0.1:${port(catalog)}`;
  process.env.ORDER_SERVICE_URL = `http://127.0.0.1:${port(order)}`;

  (global as { __CATALOG_STUB__?: Server }).__CATALOG_STUB__ = catalog;
  (global as { __ORDER_STUB__?: Server }).__ORDER_STUB__ = order;
}
