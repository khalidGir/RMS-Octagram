import { BadRequestException } from '@nestjs/common';

const CANONICAL_UNITS: Record<string, { group: string; factor: number }> = {
  mg: { group: 'weight', factor: 0.001 },
  g: { group: 'weight', factor: 1 },
  kg: { group: 'weight', factor: 1000 },
  oz: { group: 'weight', factor: 28.3495 },
  lb: { group: 'weight', factor: 453.592 },
  ml: { group: 'volume', factor: 1 },
  l: { group: 'volume', factor: 1000 },
  floz: { group: 'volume', factor: 29.5735 },
  cup: { group: 'volume', factor: 236.588 },
  tbsp: { group: 'volume', factor: 14.7868 },
  tsp: { group: 'volume', factor: 4.92892 },
  pcs: { group: 'count', factor: 1 },
  each: { group: 'count', factor: 1 },
  portion: { group: 'count', factor: 1 },
  unit: { group: 'count', factor: 1 },
};

export function getUnitGroup(unit: string): string {
  const normalized = unit.toLowerCase().trim();
  const info = CANONICAL_UNITS[normalized];
  if (!info) {
    throw new BadRequestException(`Unknown unit: ${unit}. Supported units: ${Object.keys(CANONICAL_UNITS).join(', ')}`);
  }
  return info.group;
}

export function validateCompatibleUnits(fromUnit: string, toUnit: string): void {
  const fromGroup = getUnitGroup(fromUnit);
  const toGroup = getUnitGroup(toUnit);
  if (fromGroup !== toGroup) {
    throw new BadRequestException(
      `Incompatible units: ${fromUnit} (${fromGroup}) cannot be converted to ${toUnit} (${toGroup})`,
    );
  }
}

export function convertUnit(quantity: number, fromUnit: string, toUnit: string): number {
  const from = CANONICAL_UNITS[fromUnit.toLowerCase().trim()];
  const to = CANONICAL_UNITS[toUnit.toLowerCase().trim()];
  if (!from || !to) {
    throw new BadRequestException(`Unknown unit: ${fromUnit} or ${toUnit}`);
  }
  if (from.group !== to.group) {
    throw new BadRequestException(`Incompatible units: ${fromUnit} and ${toUnit}`);
  }
  const baseQuantity = quantity * from.factor;
  return baseQuantity / to.factor;
}

export function normalizeUnit(unit: string): string {
  return unit.toLowerCase().trim();
}

export { CANONICAL_UNITS };
