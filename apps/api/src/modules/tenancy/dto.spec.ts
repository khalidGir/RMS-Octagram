import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateLogoUploadDto, FinalizeLogoDto, RemoveLogoDto } from './dto';

const validUpload = {
  contentType: 'image/png',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
  crop: { x: 0, y: 0, width: 1, height: 1 },
  expectedVersion: 1,
};

const errorProperties = async (dtoClass: unknown, payload: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(dtoClass as never, payload) as object);
  const properties: string[] = [];
  const walk = (nodes: ValidationError[]) => {
    for (const node of nodes) {
      if (node.constraints && Object.keys(node.constraints).length > 0)
        properties.push(node.property);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(errors);
  return properties;
};

describe('CreateLogoUploadDto', () => {
  it('accepts a valid logo upload body', async () => {
    expect(await errorProperties(CreateLogoUploadDto, validUpload)).toEqual([]);
  });

  it('rejects unsupported content types', async () => {
    expect(
      await errorProperties(CreateLogoUploadDto, { ...validUpload, contentType: 'image/gif' }),
    ).toContain('contentType');
  });

  it('rejects oversized payloads and zero/negative sizes', async () => {
    expect(
      await errorProperties(CreateLogoUploadDto, {
        ...validUpload,
        sizeBytes: 10 * 1024 * 1024 + 1,
      }),
    ).toContain('sizeBytes');
    expect(await errorProperties(CreateLogoUploadDto, { ...validUpload, sizeBytes: 0 })).toContain(
      'sizeBytes',
    );
  });

  it('rejects sha256 digests that are not lowercase hex', async () => {
    expect(
      await errorProperties(CreateLogoUploadDto, { ...validUpload, sha256: 'A'.repeat(64) }),
    ).toContain('sha256');
    expect(
      await errorProperties(CreateLogoUploadDto, { ...validUpload, sha256: 'a'.repeat(63) }),
    ).toContain('sha256');
  });

  it('rejects crop rects outside the normalized unit square', async () => {
    expect(
      await errorProperties(CreateLogoUploadDto, {
        ...validUpload,
        crop: { x: -0.1, y: 0, width: 1, height: 1 },
      }),
    ).toContain('x');
    expect(
      await errorProperties(CreateLogoUploadDto, {
        ...validUpload,
        crop: { x: 0, y: 0, width: 1.5, height: 1 },
      }),
    ).toContain('width');
    expect(
      await errorProperties(CreateLogoUploadDto, {
        ...validUpload,
        crop: { x: 0, y: 0, width: 0, height: 1 },
      }),
    ).toContain('width');
  });

  it('rejects invalid rotation values', async () => {
    expect(
      await errorProperties(CreateLogoUploadDto, {
        ...validUpload,
        crop: { x: 0, y: 0, width: 1, height: 1, rotation: 45 },
      }),
    ).toContain('rotation');
  });

  it('rejects a missing or non-positive expectedVersion', async () => {
    expect(
      await errorProperties(CreateLogoUploadDto, { ...validUpload, expectedVersion: 0 }),
    ).toContain('expectedVersion');
    expect(
      await errorProperties(CreateLogoUploadDto, { ...validUpload, expectedVersion: undefined }),
    ).toContain('expectedVersion');
  });
});

describe('FinalizeLogoDto', () => {
  it('accepts a valid finalize body', async () => {
    expect(
      await errorProperties(FinalizeLogoDto, { mediaObjectId: 'media-1', expectedVersion: 1 }),
    ).toEqual([]);
  });

  it('rejects a missing mediaObjectId', async () => {
    expect(await errorProperties(FinalizeLogoDto, { expectedVersion: 1 })).toContain(
      'mediaObjectId',
    );
  });
});

describe('RemoveLogoDto', () => {
  it('requires a positive expectedVersion', async () => {
    expect(await errorProperties(RemoveLogoDto, { expectedVersion: 1 })).toEqual([]);
    expect(await errorProperties(RemoveLogoDto, {})).toContain('expectedVersion');
    expect(await errorProperties(RemoveLogoDto, { expectedVersion: -1 })).toContain(
      'expectedVersion',
    );
  });
});
