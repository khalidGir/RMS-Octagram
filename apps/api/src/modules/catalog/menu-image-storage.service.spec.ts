import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

const h = vi.hoisted(() => {
  class HeadObjectCommand {
    constructor(public input: { Bucket: string; Key: string }) {}
  }
  const headResult: { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[] = [];
  const sent: unknown[] = [];
  const s3Send = vi.fn(async (command: unknown) => {
    sent.push(command);
    const name = (command as { constructor: { name: string } }).constructor.name;
    if (name === 'HeadObjectCommand') {
      return new Promise((resolve, reject) => headResult.push({ resolve, reject }));
    }
    return {};
  });
  const presign = vi.fn(async (_client: unknown, params: { Bucket: string; Key: string }) => ({
    url: `https://s3.upload.test/${params.Bucket}/${params.Key}`,
    fields: { key: params.Key, bucket: params.Bucket },
  }));
  return { s3Send, presign, sent, headResult, HeadObjectCommand };
});

vi.mock('@aws-sdk/client-s3', () => ({
  HeadObjectCommand: h.HeadObjectCommand,
  S3Client: class {
    send = h.s3Send;
  },
}));

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: h.presign,
}));

import { MenuImageStorageService } from './menu-image-storage.service';

const config = {
  get: (key: string, fallback?: string) => {
    if (key === 'S3_MEDIA_BUCKET') return 'media-bucket';
    if (key === 'S3_REGION') return 'us-east-1';
    return fallback;
  },
};

const sha = 'a'.repeat(64);

describe('MenuImageStorageService', () => {
  let service: MenuImageStorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    h.headResult.length = 0;
    service = new MenuImageStorageService(config as never);
  });

  describe('createUpload', () => {
    it('signs a tenant-scoped private key with checksum and metadata conditions', async () => {
      const result = await service.createUpload({ tenantId: 'tenant-a', itemId: 'item-1', contentType: 'image/jpeg', sizeBytes: 100, sha256: sha });

      expect(service.bucket).toBe('media-bucket');
      expect(result.uploadUrl).toContain('media-bucket');
      expect(result.objectKey).toMatch(/^tenant\/tenant-a\/menu-items\/item-1\/original\/[0-9a-f-]{36}\.jpg$/);
      const params = h.presign.mock.calls[0][1] as { Conditions: unknown[]; Fields: Record<string, string> };
      expect(params.Conditions).toContainEqual({ 'x-amz-meta-tenant-id': 'tenant-a' });
      expect(params.Conditions).toContainEqual({ 'x-amz-meta-menu-item-id': 'item-1' });
      expect(params.Conditions).toContainEqual(['content-length-range', 1, 10 * 1024 * 1024]);
      expect(params.Fields['Content-Type']).toBe('image/jpeg');
      expect(params.Fields['x-amz-checksum-sha256']).toBe(Buffer.from(sha, 'hex').toString('base64'));
    });

    it('maps png and webp content types to their extensions', async () => {
      await expect(service.createUpload({ tenantId: 't', itemId: 'i', contentType: 'image/png', sizeBytes: 5, sha256: sha })).resolves.toMatchObject({ objectKey: expect.stringContaining('.png') });
      await expect(service.createUpload({ tenantId: 't', itemId: 'i', contentType: 'image/webp', sizeBytes: 5, sha256: sha })).resolves.toMatchObject({ objectKey: expect.stringContaining('.webp') });
    });

    it.each([
      ['unsupported content type', { contentType: 'image/gif', sizeBytes: 100 }],
      ['zero bytes', { contentType: 'image/jpeg', sizeBytes: 0 }],
      ['oversized payload', { contentType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 + 1 }],
    ])('rejects %s', async (_label, params) => {
      await expect(service.createUpload({ tenantId: 't', itemId: 'i', sha256: sha, ...params })).rejects.toThrow(BadRequestException);
      expect(h.presign).not.toHaveBeenCalled();
    });

    it('fails with 503 when S3_MEDIA_BUCKET is not configured', async () => {
      const unconfigured = new MenuImageStorageService({
        get: (key: string, fallback?: string) => (key === 'S3_REGION' ? 'us-east-1' : fallback),
      } as never);
      await expect(unconfigured.createUpload({ tenantId: 't', itemId: 'i', contentType: 'image/jpeg', sizeBytes: 100, sha256: sha })).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(h.presign).not.toHaveBeenCalled();
    });

    it('never falls back to the payment-proof bucket', async () => {
      const proofAware = new MenuImageStorageService({
        get: (key: string, fallback?: string) => {
          if (key === 'S3_PROOF_BUCKET') return 'rms-proof-bucket';
          if (key === 'S3_REGION') return 'us-east-1';
          return fallback;
        },
      } as never);
      expect(proofAware.bucket).toBe('');
      await expect(proofAware.createUpload({ tenantId: 't', itemId: 'i', contentType: 'image/jpeg', sizeBytes: 100, sha256: sha })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('verifyObject', () => {
    it('accepts an object whose size, type and checksum match the intent', async () => {
      const pending = service.verifyObject({ objectKey: 'k', sizeBytes: 42, contentType: 'image/jpeg', sha256: sha });
      h.headResult[0].resolve({ ContentLength: 42, ContentType: 'image/jpeg', ChecksumSHA256: Buffer.from(sha, 'hex').toString('base64') });
      await expect(pending).resolves.toBeUndefined();
    });

    it('rejects a size mismatch', async () => {
      const pending = service.verifyObject({ objectKey: 'k', sizeBytes: 42, contentType: 'image/jpeg', sha256: sha });
      h.headResult[0].resolve({ ContentLength: 41, ContentType: 'image/jpeg', ChecksumSHA256: Buffer.from(sha, 'hex').toString('base64') });
      await expect(pending).rejects.toThrow('does not match its upload intent');
    });

    it('rejects a checksum mismatch', async () => {
      const pending = service.verifyObject({ objectKey: 'k', sizeBytes: 42, contentType: 'image/jpeg', sha256: sha });
      h.headResult[0].resolve({ ContentLength: 42, ContentType: 'image/jpeg', ChecksumSHA256: Buffer.from('b'.repeat(64), 'hex').toString('base64') });
      await expect(pending).rejects.toThrow('does not match its upload intent');
    });

    it('rejects a content type mismatch', async () => {
      const pending = service.verifyObject({ objectKey: 'k', sizeBytes: 42, contentType: 'image/jpeg', sha256: sha });
      h.headResult[0].resolve({ ContentLength: 42, ContentType: 'image/png', ChecksumSHA256: Buffer.from(sha, 'hex').toString('base64') });
      await expect(pending).rejects.toThrow('does not match its upload intent');
    });

    it('reports a missing object as a bad request', async () => {
      const pending = service.verifyObject({ objectKey: 'k', sizeBytes: 42, contentType: 'image/jpeg', sha256: sha });
      h.headResult[0].reject(new Error('NotFound'));
      await expect(pending).rejects.toThrow('was not found');
    });
  });
});
