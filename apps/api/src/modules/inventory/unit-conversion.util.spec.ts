import { describe, it, expect } from 'vitest';
import {
  getUnitGroup,
  validateCompatibleUnits,
  convertUnit,
  normalizeUnit,
  CANONICAL_UNITS,
} from './unit-conversion.util';
import { BadRequestException } from '@nestjs/common';

describe('unit-conversion.util', () => {
  describe('getUnitGroup', () => {
    it('returns weight for kg', () => {
      expect(getUnitGroup('kg')).toBe('weight');
    });

    it('returns volume for ml', () => {
      expect(getUnitGroup('ml')).toBe('volume');
    });

    it('returns count for pcs', () => {
      expect(getUnitGroup('pcs')).toBe('count');
    });

    it('normalizes case', () => {
      expect(getUnitGroup('KG')).toBe('weight');
      expect(getUnitGroup('Ml')).toBe('volume');
      expect(getUnitGroup('PCS')).toBe('count');
    });

    it('throws BadRequestException for unknown unit', () => {
      expect(() => getUnitGroup('widget')).toThrow(BadRequestException);
    });
  });

  describe('validateCompatibleUnits', () => {
    it('does not throw for compatible weight units', () => {
      expect(() => validateCompatibleUnits('kg', 'g')).not.toThrow();
    });

    it('does not throw for compatible volume units', () => {
      expect(() => validateCompatibleUnits('ml', 'l')).not.toThrow();
    });

    it('does not throw for compatible count units', () => {
      expect(() => validateCompatibleUnits('pcs', 'each')).not.toThrow();
    });

    it('throws for incompatible weight→volume', () => {
      expect(() => validateCompatibleUnits('kg', 'ml')).toThrow(BadRequestException);
    });

    it('throws for incompatible volume→count', () => {
      expect(() => validateCompatibleUnits('l', 'pcs')).toThrow(BadRequestException);
    });

    it('throws for incompatible weight→count', () => {
      expect(() => validateCompatibleUnits('oz', 'each')).toThrow(BadRequestException);
    });
  });

  describe('convertUnit', () => {
    it('converts kg to g', () => {
      expect(convertUnit(1, 'kg', 'g')).toBe(1000);
    });

    it('converts g to kg', () => {
      expect(convertUnit(1000, 'g', 'kg')).toBe(1);
    });

    it('converts l to ml', () => {
      expect(convertUnit(1, 'l', 'ml')).toBe(1000);
    });

    it('converts ml to l', () => {
      expect(convertUnit(500, 'ml', 'l')).toBe(0.5);
    });

    it('converts same unit to same value', () => {
      expect(convertUnit(42, 'kg', 'kg')).toBe(42);
    });

    it('throws for unknown unit', () => {
      expect(() => convertUnit(1, 'kg', 'widget')).toThrow(BadRequestException);
    });

    it('throws for incompatible units', () => {
      expect(() => convertUnit(1, 'kg', 'ml')).toThrow(BadRequestException);
    });
  });

  describe('normalizeUnit', () => {
    it('lowercases', () => {
      expect(normalizeUnit('KG')).toBe('kg');
    });

    it('trims whitespace', () => {
      expect(normalizeUnit('  ml  ')).toBe('ml');
    });
  });

  describe('CANONICAL_UNITS', () => {
    it('has all expected weight units', () => {
      for (const u of ['mg', 'g', 'kg', 'oz', 'lb']) {
        expect(CANONICAL_UNITS[u]).toBeDefined();
        expect(CANONICAL_UNITS[u].group).toBe('weight');
      }
    });

    it('has all expected volume units', () => {
      for (const u of ['ml', 'l', 'floz', 'cup', 'tbsp', 'tsp']) {
        expect(CANONICAL_UNITS[u]).toBeDefined();
        expect(CANONICAL_UNITS[u].group).toBe('volume');
      }
    });

    it('has all expected count units', () => {
      for (const u of ['pcs', 'each', 'portion', 'unit']) {
        expect(CANONICAL_UNITS[u]).toBeDefined();
        expect(CANONICAL_UNITS[u].group).toBe('count');
      }
    });
  });
});
