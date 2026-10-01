import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { CreateTenantDto } from './platform-admin.controller';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: CreateTenantDto, data: '' };

const valid = {
  name: 'Buna House',
  ownerPhone: '0911234567',
  ownerPassword: 'StrongP@ss1',
};

async function capture(value: unknown): Promise<unknown> {
  return pipe.transform(value, meta).catch((err: unknown) => err);
}

describe('CreateTenantDto validation', () => {
  it('accepts a valid payload', async () => {
    const result = await pipe.transform(valid, meta);
    expect((result as CreateTenantDto).name).toBe('Buna House');
  });

  it('rejects a weak owner password', async () => {
    const err = await capture({ ...valid, ownerPassword: 'lowercaseonly' });
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((err as BadRequestException).getResponse())).toContain('uppercase');
  });

  it('rejects a short owner password', async () => {
    const err = await capture({ ...valid, ownerPassword: 'Ab1' });
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing name', async () => {
    const err = await capture({ ownerPhone: valid.ownerPhone, ownerPassword: valid.ownerPassword });
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing owner phone', async () => {
    const err = await capture({ name: 'Buna', ownerPassword: valid.ownerPassword });
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown fields', async () => {
    const err = await capture({ ...valid, plan: 'ENTERPRISE' });
    expect(err).toBeInstanceOf(BadRequestException);
  });
});
