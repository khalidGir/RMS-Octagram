import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CollectOrderDto, ExpoOrdersQueryDto, RecallExpoDto, ReleaseExpoDto, ServiceBoardQueryDto, ServeLinesDto, ServeOrderDto } from './dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

describe('Fulfillment DTO validation', () => {
  it('accepts scoped service-board queries and converts HTTP pagination values', async () => {
    const result = await pipe.transform(
      { scope: 'all', limit: '25' },
      { type: 'query', metatype: ServiceBoardQueryDto },
    );
    expect(result).toBeInstanceOf(ServiceBoardQueryDto);
    expect(result).toMatchObject({ scope: 'all', limit: 25 });
  });

  it.each(['0', '101', 'not-a-number'])('rejects invalid service-board limit %s', async (limit) => {
    await expect(pipe.transform(
      { limit },
      { type: 'query', metatype: ServiceBoardQueryDto },
    )).rejects.toThrow();
  });

  it('rejects unknown query fields and unsupported scopes', async () => {
    await expect(pipe.transform(
      { scope: 'other-tenant' },
      { type: 'query', metatype: ServiceBoardQueryDto },
    )).rejects.toThrow();
    await expect(pipe.transform(
      { tenantId: 'injected' },
      { type: 'query', metatype: ServiceBoardQueryDto },
    )).rejects.toThrow();
  });

  it.each([CollectOrderDto, ReleaseExpoDto, ServeOrderDto])('requires a positive integer mutation version', async (metatype) => {
    for (const body of [{}, { expectedVersion: 0 }, { expectedVersion: '1' }]) {
      await expect(pipe.transform(body, { type: 'body', metatype })).rejects.toThrow();
    }
    await expect(pipe.transform({ expectedVersion: 1 }, { type: 'body', metatype }))
      .resolves.toMatchObject({ expectedVersion: 1 });
  });

  it('requires an expo recall reason', async () => {
    await expect(pipe.transform(
      { expectedVersion: 1, reason: '' },
      { type: 'body', metatype: RecallExpoDto },
    )).rejects.toThrow();
  });

  it('validates expo pagination using a runtime query class', async () => {
    await expect(pipe.transform({ limit: '10' }, { type: 'query', metatype: ExpoOrdersQueryDto }))
      .resolves.toMatchObject({ limit: 10 });
    await expect(pipe.transform({ limit: '101' }, { type: 'query', metatype: ExpoOrdersQueryDto }))
      .rejects.toThrow();
  });

  it.each([[], 'line-1', [1], [''], ['line-1', 'line-1']].map((lineIds) => ({ lineIds })))('rejects invalid partial-service line selections $lineIds', async ({ lineIds }) => {
    await expect(pipe.transform(
      { expectedVersion: 1, lineIds },
      { type: 'body', metatype: ServeLinesDto },
    )).rejects.toThrow();
  });

  it('accepts distinct nonempty partial-service line IDs', async () => {
    await expect(pipe.transform(
      { expectedVersion: 1, lineIds: ['line-1', 'line-2'] },
      { type: 'body', metatype: ServeLinesDto },
    )).resolves.toMatchObject({ lineIds: ['line-1', 'line-2'] });
  });
});
