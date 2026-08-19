export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // Abandonment TTL for a cart hash — refreshed on every write (see CartRedisService).
  cartTtlSeconds: parseInt(process.env.CART_TTL_SECONDS ?? String(7 * 24 * 60 * 60), 10),
  cognito: {
    issuer: process.env.COGNITO_ISSUER ?? '',
    audience: process.env.COGNITO_AUDIENCE ?? '',
  },
  catalogServiceUrl: process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3002',
  orderServiceUrl: process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003',
});
