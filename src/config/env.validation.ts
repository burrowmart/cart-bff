import * as Joi from 'joi';
import { SERVICE_NAME } from '../constants';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  // Auth — required unless AUTH_DISABLED=true (used in tests)
  AUTH_DISABLED: Joi.string().valid('true', 'false').default('false'),
  COGNITO_ISSUER: Joi.string().when('AUTH_DISABLED', {
    is: 'true',
    then: Joi.string().optional().allow(''),
    otherwise: Joi.string().required(),
  }),
  COGNITO_AUDIENCE: Joi.string().when('AUTH_DISABLED', {
    is: 'true',
    then: Joi.string().optional().allow(''),
    otherwise: Joi.string().required(),
  }),
  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional(),
  OTEL_SERVICE_NAME: Joi.string().default(SERVICE_NAME),
  // Cart storage
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  CART_TTL_SECONDS: Joi.number().default(7 * 24 * 60 * 60),
  // Downstream services this BFF aggregates
  CATALOG_SERVICE_URL: Joi.string().default('http://localhost:3002'),
  ORDER_SERVICE_URL: Joi.string().default('http://localhost:3003'),
});
