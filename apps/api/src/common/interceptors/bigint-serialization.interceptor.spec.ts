import { describe, expect, it } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { BigIntSerializationInterceptor } from './bigint-serialization.interceptor';

const context = {} as ExecutionContext;

function run(result: unknown): Promise<unknown> {
  const next = { handle: () => of(result) } as CallHandler;
  return lastValueFrom(new BigIntSerializationInterceptor().intercept(context, next));
}

describe('BigIntSerializationInterceptor', () => {
  it('converts top-level bigint to a decimal string', async () => {
    await expect(run(12345678901234567890n)).resolves.toBe('12345678901234567890');
  });

  it('converts bigint leaves nested in objects and arrays', async () => {
    const result = (await run({
      data: [
        { id: 'i1', variants: [{ basePriceMinor: 2500n, priceOverrideMinor: null }] },
        { basePriceMinor: -1n, costMinor: 750n },
      ],
      meta: { total: 42n },
    })) as Record<string, unknown>;

    expect(result).toEqual({
      data: [
        { id: 'i1', variants: [{ basePriceMinor: '2500', priceOverrideMinor: null }] },
        { basePriceMinor: '-1', costMinor: '750' },
      ],
      meta: { total: '42' },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('honors toJSON exactly like JSON.stringify (Date, Buffer, Decimal-like)', async () => {
    const date = new Date('2026-10-05T00:00:00.000Z');
    const buffer = Buffer.from('ab');
    const decimalLike = { e: 1, d: [65], toJSON: () => '6.500000' };

    await expect(run(date)).resolves.toBe('2026-10-05T00:00:00.000Z');
    await expect(run(decimalLike)).resolves.toBe('6.500000');
    const bufferResult = (await run({ proof: buffer })) as Record<string, unknown>;
    expect(bufferResult).toEqual({ proof: { type: 'Buffer', data: [97, 98] } });
  });

  it('converts bigint leaves inside toJSON results', async () => {
    const wrapper = { toJSON: () => ({ amount: 5n }) };
    await expect(run(wrapper)).resolves.toEqual({ amount: '5' });
  });

  it('passes through null and non-object primitives unchanged', async () => {
    await expect(run(null)).resolves.toBeNull();
    await expect(run(undefined)).resolves.toBeUndefined();
    await expect(run('text')).resolves.toBe('text');
    await expect(run(7)).resolves.toBe(7);
    await expect(run(true)).resolves.toBe(true);
  });

  it('final JSON for a BigInt payload matches JSON.stringify of the string-ified payload', async () => {
    const payload = { data: [{ basePriceMinor: 12500n, name: 'Shiro Wot' }] };
    const serialized = (await run(payload)) as unknown;
    expect(JSON.parse(JSON.stringify(serialized))).toEqual({
      data: [{ basePriceMinor: '12500', name: 'Shiro Wot' }],
    });
  });
});
