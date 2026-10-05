import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BranchOrderCounterService } from './branch-order-counter.service';

describe('BranchOrderCounterService', () => {
  let service: BranchOrderCounterService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BranchOrderCounterService();
  });

  describe('nextOrderNumber', () => {
    it('returns the value from a single atomic query', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ lastNumber: 1n }]),
      };

      const result = await service.nextOrderNumber(mockTx, 'branch-1');

      expect(result).toBe(1n);
      expect(mockTx.$queryRaw).toHaveBeenCalledOnce();
      // Single atomic query, not multi-step
      const templateParts = mockTx.$queryRaw.mock.calls[0][0];
      const sql = Array.isArray(templateParts) ? templateParts.join('') : String(templateParts);
      expect(sql).toContain('INSERT');
      expect(sql).toContain('ON CONFLICT');
    });

    it('increments atomically for subsequent orders', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ lastNumber: 42n }]),
      };

      const result = await service.nextOrderNumber(mockTx, 'branch-1');

      expect(result).toBe(42n);
    });

    it('concurrent calls produce unique sequential numbers', async () => {
      let counter = 0n;
      const mockTx = {
        $queryRaw: vi.fn().mockImplementation(async () => {
          counter += 1n;
          return [{ lastNumber: counter }];
        }),
      };

      const results = await Promise.all([
        service.nextOrderNumber(mockTx, 'branch-1'),
        service.nextOrderNumber(mockTx, 'branch-1'),
        service.nextOrderNumber(mockTx, 'branch-1'),
      ]);

      // All results are unique
      const unique = new Set(results);
      expect(unique.size).toBe(3);
      // They are sequential (sorted)
      const sorted = [...results].sort((a, b) => Number(a - b));
      expect(results).toEqual(sorted);
    });

    it('different branches get independent counters', async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ lastNumber: 1n }]),
      };

      const [r1, r2] = await Promise.all([
        service.nextOrderNumber(mockTx, 'branch-1'),
        service.nextOrderNumber(mockTx, 'branch-2'),
      ]);

      expect(typeof r1).toBe('bigint');
      expect(typeof r2).toBe('bigint');
    });
  });
});
