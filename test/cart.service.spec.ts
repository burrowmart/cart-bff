import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CartService } from '../src/cart/cart.service';
import { CartRedisService } from '../src/cart/redis/cart-redis.service';

const mockRedis: jest.Mocked<CartRedisService> = {
  addItem: jest.fn(),
  setQty: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  getAll: jest.fn(),
  ttl: jest.fn(),
} as unknown as jest.Mocked<CartRedisService>;

const configValues: Record<string, unknown> = {
  cartTtlSeconds: 604800,
  catalogServiceUrl: 'http://catalog-service.test',
  orderServiceUrl: 'http://order-service.test',
};
const config = { get: (key: string) => configValues[key] } as unknown as ConfigService;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => 'application/json' },
    json: async () => body,
  } as unknown as Response;
}

describe('CartService', () => {
  let service: CartService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CartService(mockRedis, config);
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  describe('addItem', () => {
    it('resolves price/name from catalog-service, then atomically increments in Redis', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: 'sku-1', name: 'Widget', description: '', price: 999, stock: 5 }),
      );
      mockRedis.addItem.mockResolvedValue(3);
      mockRedis.getAll.mockResolvedValue({ 'sku-1': { sku: 'sku-1', qty: 3, price: 999, name: 'Widget' } });

      const cart = await service.addItem('alice@example.com', 'sku-1', 3, { authorization: 'Bearer tok' });

      // catalog-service sits behind an Envoy PEP that verifies the Cognito JWT
      // on every route — the caller's credential must be forwarded, not dropped.
      expect(fetchMock).toHaveBeenCalledWith(
        'http://catalog-service.test/catalog/sku-1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ authorization: 'Bearer tok' }),
        }),
      );
      expect(mockRedis.addItem).toHaveBeenCalledWith('alice@example.com', 'sku-1', 3, 999, 'Widget', 604800);
      expect(cart).toEqual({
        userEmail: 'alice@example.com',
        items: [{ sku: 'sku-1', qty: 3, price: 999, name: 'Widget' }],
        total: 2997,
      });
    });

    it('throws NotFoundException when catalog-service has no such item, without touching Redis', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'not found' }));

      await expect(service.addItem('alice@example.com', 'missing', 1, {})).rejects.toThrow(NotFoundException);
      expect(mockRedis.addItem).not.toHaveBeenCalled();
    });

    it('throws BadGatewayException when catalog-service is unreachable', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.addItem('alice@example.com', 'sku-1', 1, {})).rejects.toThrow(BadGatewayException);
      expect(mockRedis.addItem).not.toHaveBeenCalled();
    });
  });

  describe('setQty', () => {
    it('throws NotFoundException when the sku is not already in the cart', async () => {
      mockRedis.setQty.mockResolvedValue(null);

      await expect(service.setQty('alice@example.com', 'sku-1', 5)).rejects.toThrow(NotFoundException);
    });

    it('returns the updated cart when the sku exists', async () => {
      mockRedis.setQty.mockResolvedValue(5);
      mockRedis.getAll.mockResolvedValue({ 'sku-1': { sku: 'sku-1', qty: 5, price: 10, name: 'Widget' } });

      const cart = await service.setQty('alice@example.com', 'sku-1', 5);

      expect(mockRedis.setQty).toHaveBeenCalledWith('alice@example.com', 'sku-1', 5, 604800);
      expect(cart.items[0].qty).toBe(5);
    });
  });

  describe('checkout', () => {
    it('rejects an empty cart before ever calling order-service', async () => {
      mockRedis.getAll.mockResolvedValue({});

      await expect(service.checkout('alice@example.com', {})).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockRedis.clear).not.toHaveBeenCalled();
    });

    it('places the order via order-service and clears the cart on 2xx — no saga knowledge here', async () => {
      mockRedis.getAll.mockResolvedValue({ 'sku-1': { sku: 'sku-1', qty: 2, price: 100, name: 'Widget' } });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, {
          id: 'order-1',
          userEmail: 'alice@example.com',
          items: [{ sku: 'sku-1', qty: 2, price: 100 }],
          total: 200,
          status: 'PENDING',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      );

      const result = await service.checkout('alice@example.com', {});

      expect(fetchMock).toHaveBeenCalledWith(
        'http://order-service.test/orders',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            userEmail: 'alice@example.com',
            items: [{ sku: 'sku-1', qty: 2, price: 100 }],
          }),
        }),
      );
      expect(result).toEqual({ orderId: 'order-1', status: 'PENDING' });
      expect(mockRedis.clear).toHaveBeenCalledWith('alice@example.com');
    });

    it('does NOT clear the cart when order-service rejects the checkout', async () => {
      mockRedis.getAll.mockResolvedValue({ 'sku-1': { sku: 'sku-1', qty: 2, price: 100, name: 'Widget' } });
      fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }));

      await expect(service.checkout('alice@example.com', {})).rejects.toThrow(BadGatewayException);
      expect(mockRedis.clear).not.toHaveBeenCalled();
    });
  });
});
