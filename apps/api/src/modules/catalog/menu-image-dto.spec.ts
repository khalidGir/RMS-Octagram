import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMenuImageUploadDto, FinalizeMenuImageDto, RemoveMenuImageDto } from './dto';

// class-validator stores decorator metadata at decoration time, so these tests
// verify DTO rules without needing Nest's ValidationPipe or emitDecoratorMetadata.
const validIntent = {
  contentType: 'image/jpeg',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
  expectedVersion: 1,
};

const intentViolations = (body: unknown) => validate(plainToInstance(CreateMenuImageUploadDto, body));

describe('CreateMenuImageUploadDto', () => {
  it('accepts a valid upload intent payload', async () => {
    expect(await intentViolations(validIntent)).toHaveLength(0);
  });

  it('accepts png and webp content types', async () => {
    expect(await intentViolations({ ...validIntent, contentType: 'image/png' })).toHaveLength(0);
    expect(await intentViolations({ ...validIntent, contentType: 'image/webp' })).toHaveLength(0);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/html'])('rejects content type %s', async (contentType) => {
    expect((await intentViolations({ ...validIntent, contentType })).length).toBeGreaterThan(0);
  });

  it.each([
    ['zero bytes', { sizeBytes: 0 }],
    ['negative size', { sizeBytes: -1 }],
    ['fractional size', { sizeBytes: 10.5 }],
    ['oversized payload', { sizeBytes: 10 * 1024 * 1024 + 1 }],
    ['payload at the exact limit is accepted', null],
  ])('%s', async (_label, override) => {
    if (override === null) {
      expect(await intentViolations({ ...validIntent, sizeBytes: 10 * 1024 * 1024 })).toHaveLength(0);
      return;
    }
    expect((await intentViolations({ ...validIntent, ...override })).length).toBeGreaterThan(0);
  });

  it.each([
    ['non-hex sha256', 'not-a-valid-hex-digest'],
    ['too-short digest', 'a'.repeat(63)],
    ['too-long digest', 'a'.repeat(65)],
    ['uppercase digest', 'A'.repeat(64)],
  ])('rejects %s', async (_label, sha256) => {
    expect((await intentViolations({ ...validIntent, sha256 })).length).toBeGreaterThan(0);
  });

  it.each([
    ['crop x above 1', { crop: { x: 2, y: 0, width: 1, height: 1 } }],
    ['crop y below 0', { crop: { x: 0, y: -0.5, width: 1, height: 1 } }],
    ['zero crop width', { crop: { x: 0, y: 0, width: 0, height: 1 } }],
    ['zero crop height', { crop: { x: 0, y: 0, width: 1, height: 0 } }],
    ['invalid rotation', { crop: { x: 0, y: 0, width: 1, height: 1, rotation: 45 } }],
  ])('rejects %s', async (_label, override) => {
    expect((await intentViolations({ ...validIntent, ...override })).length).toBeGreaterThan(0);
  });

  it('rejects a missing or non-positive expectedVersion', async () => {
    expect((await intentViolations({ ...validIntent, expectedVersion: 0 })).length).toBeGreaterThan(0);
    const { expectedVersion: _omitted, ...withoutVersion } = validIntent;
    expect((await intentViolations(withoutVersion)).length).toBeGreaterThan(0);
  });

  it('rejects a missing content type, sha256 or crop', async () => {
    const { contentType: _c, ...noContentType } = validIntent;
    expect((await intentViolations(noContentType)).length).toBeGreaterThan(0);
    const { sha256: _s, ...noSha } = validIntent;
    expect((await intentViolations(noSha)).length).toBeGreaterThan(0);
    const { crop: _cr, ...noCrop } = validIntent;
    expect((await intentViolations(noCrop)).length).toBeGreaterThan(0);
  });
});

describe('FinalizeMenuImageDto', () => {
  it('accepts a valid finalize payload', async () => {
    expect(await validate(plainToInstance(FinalizeMenuImageDto, { mediaObjectId: 'media-1', expectedVersion: 3 }))).toHaveLength(0);
  });

  it('rejects a missing mediaObjectId', async () => {
    expect((await validate(plainToInstance(FinalizeMenuImageDto, { expectedVersion: 3 }))).length).toBeGreaterThan(0);
  });

  it('rejects a non-positive expectedVersion', async () => {
    expect((await validate(plainToInstance(FinalizeMenuImageDto, { mediaObjectId: 'media-1', expectedVersion: 0 }))).length).toBeGreaterThan(0);
  });
});

describe('RemoveMenuImageDto', () => {
  it('accepts a valid removal payload', async () => {
    expect(await validate(plainToInstance(RemoveMenuImageDto, { expectedVersion: 2 }))).toHaveLength(0);
  });

  it('rejects a missing or zero expectedVersion', async () => {
    expect((await validate(plainToInstance(RemoveMenuImageDto, {}))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(RemoveMenuImageDto, { expectedVersion: 0 }))).length).toBeGreaterThan(0);
  });
});
