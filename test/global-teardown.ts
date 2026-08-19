import type { Server } from 'node:http';

export default async function globalTeardown(): Promise<void> {
  const catalog = (global as { __CATALOG_STUB__?: Server }).__CATALOG_STUB__;
  const order = (global as { __ORDER_STUB__?: Server }).__ORDER_STUB__;
  await Promise.all([
    new Promise<void>((resolve) => (catalog ? catalog.close(() => resolve()) : resolve())),
    new Promise<void>((resolve) => (order ? order.close(() => resolve()) : resolve())),
  ]);
}
