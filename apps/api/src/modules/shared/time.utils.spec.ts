import { describe, it, expect } from 'vitest';
import { normalizeTimeValue, localTimeInTimezone, isWithinTimeWindow } from './time.utils';

describe('time.utils', () => {
  describe('normalizeTimeValue', () => {
    it('returns null for falsy values', () => {
      expect(normalizeTimeValue(null)).toBeNull();
      expect(normalizeTimeValue(undefined)).toBeNull();
      expect(normalizeTimeValue('')).toBeNull();
    });

    it('extracts HH:MM from string', () => {
      expect(normalizeTimeValue('14:30:00')).toBe('14:30');
      expect(normalizeTimeValue('09:00')).toBe('09:00');
    });

    it('normalizes Prisma @db.Time Date object to HH:MM', () => {
      // Prisma returns Date with epoch 1970-01-01 and time as UTC hours/minutes
      const date = new Date(Date.UTC(1970, 0, 1, 14, 30, 0));
      expect(normalizeTimeValue(date)).toBe('14:30');
    });

    it('normalizes midnight correctly', () => {
      const date = new Date(Date.UTC(1970, 0, 1, 0, 0, 0));
      expect(normalizeTimeValue(date)).toBe('00:00');
    });

    it('normalizes end-of-day correctly', () => {
      const date = new Date(Date.UTC(1970, 0, 1, 23, 59, 0));
      expect(normalizeTimeValue(date)).toBe('23:59');
    });
  });

  describe('localTimeInTimezone', () => {
    it('returns HH:MM format', () => {
      const result = localTimeInTimezone('Africa/Addis_Ababa');
      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    it('Addis Ababa is UTC+3', () => {
      // Get current UTC time
      const now = new Date();
      const utcHours = now.getUTCHours();
      const utcMinutes = now.getUTCMinutes();

      const addisTime = localTimeInTimezone('Africa/Addis_Ababa');
      const [hh, mm] = addisTime.split(':').map(Number);

      // Addis Ababa is UTC+3 (or UTC+3 with DST, but Ethiopia doesn't use DST)
      const expectedMinutes = (utcHours * 60 + utcMinutes + 3 * 60) % (24 * 60);
      const expectedH = Math.floor(expectedMinutes / 60);
      const expectedM = expectedMinutes % 60;

      expect(hh).toBe(expectedH);
      expect(mm).toBe(expectedM);
    });
  });

  describe('isWithinTimeWindow', () => {
    it('same-day window: inside', () => {
      expect(isWithinTimeWindow('12:00', '09:00', '21:00')).toBe(true);
    });

    it('same-day window: at boundaries', () => {
      expect(isWithinTimeWindow('09:00', '09:00', '21:00')).toBe(true);
      expect(isWithinTimeWindow('21:00', '09:00', '21:00')).toBe(true);
    });

    it('same-day window: outside', () => {
      expect(isWithinTimeWindow('08:59', '09:00', '21:00')).toBe(false);
      expect(isWithinTimeWindow('21:01', '09:00', '21:00')).toBe(false);
    });

    it('overnight window: inside (before midnight)', () => {
      expect(isWithinTimeWindow('23:00', '22:00', '06:00')).toBe(true);
    });

    it('overnight window: inside (after midnight)', () => {
      expect(isWithinTimeWindow('03:00', '22:00', '06:00')).toBe(true);
    });

    it('overnight window: at boundaries', () => {
      expect(isWithinTimeWindow('22:00', '22:00', '06:00')).toBe(true);
      expect(isWithinTimeWindow('06:00', '22:00', '06:00')).toBe(true);
    });

    it('overnight window: outside', () => {
      expect(isWithinTimeWindow('12:00', '22:00', '06:00')).toBe(false);
      expect(isWithinTimeWindow('21:59', '22:00', '06:00')).toBe(false);
      expect(isWithinTimeWindow('06:01', '22:00', '06:00')).toBe(false);
    });
  });
});
