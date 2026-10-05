import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/**
 * JSON cannot encode BigInt (Prisma BigInt columns such as `basePriceMinor`).
 * Express throws "Do not know how to serialize a BigInt" at `res.json`, which
 * turns any endpoint returning raw rows into a 500. This interceptor mirrors
 * `JSON.stringify` semantics but converts BigInt leaves to decimal strings —
 * the transport convention already used by the public menu and the DTO docs
 * ("string BigInt minor units").
 */
function serializeBigInts(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value === null || typeof value !== 'object') return value;
  // Honor toJSON (Date, Buffer, Prisma Decimal, ...) exactly like
  // JSON.stringify, then keep mapping BigInt leaves inside the result.
  const withToJson = value as { toJSON?: () => unknown };
  if (typeof withToJson.toJSON === 'function') return serializeBigInts(withToJson.toJSON());
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeBigInts(entry)]),
  );
}

@Injectable()
export class BigIntSerializationInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(serializeBigInts));
  }
}
