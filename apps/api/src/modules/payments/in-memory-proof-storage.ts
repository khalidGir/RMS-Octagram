import { BadRequestException } from '@nestjs/common';
import { ProofStorage } from './proof-storage.interface';
import * as crypto from 'crypto';

/**
 * Deterministic in-memory proof storage for E2E tests.
 * Stores uploaded objects in a Map and verifies checksums against stored bytes.
 */
export class InMemoryProofStorage extends ProofStorage {
  private objects = new Map<string, { data: Buffer; contentType: string; sha256Hex: string }>();

  async createUploadIntent(params: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }) {
    const id = crypto.randomUUID();
    const objectKey = `test/tenant/${params.tenantId}/branch/${params.branchId}/payments/${params.paymentId}/proofs/${id}.jpg`;

    return {
      uploadUrl: `http://localhost:9000/test-bucket/${objectKey}`,
      objectKey,
      fields: {
        'Content-Type': params.contentType,
        'x-amz-checksum-sha256': Buffer.from(params.sha256, 'hex').toString('base64'),
        key: objectKey,
      },
    };
  }

  async verifyObject(params: {
    objectKey: string;
    expectedSha256Hex: string;
    expectedSize: number;
    expectedContentType: string;
  }) {
    const stored = this.objects.get(params.objectKey);
    if (!stored) {
      throw new BadRequestException('Object not found in storage');
    }

    // Verify content type
    if (stored.contentType !== params.expectedContentType) {
      throw new BadRequestException(
        `Content-Type mismatch: expected ${params.expectedContentType}, got ${stored.contentType}`,
      );
    }

    // Verify size
    if (stored.data.length !== params.expectedSize) {
      throw new BadRequestException(
        `Size mismatch: expected ${params.expectedSize}, got ${stored.data.length}`,
      );
    }

    // Verify SHA-256 checksum
    const computedHash = crypto.createHash('sha256').update(stored.data).digest('hex');
    if (computedHash !== params.expectedSha256Hex) {
      throw new BadRequestException('Checksum mismatch');
    }
  }

  async createReadUrl(objectKey: string) {
    return `http://localhost:9000/test-bucket/${objectKey}?signed=true`;
  }

  getBucket(): string {
    return 'test-bucket';
  }

  /** Test helper: simulate an uploaded object */
  simulateUpload(objectKey: string, data: Buffer, contentType: string, sha256Hex: string) {
    this.objects.set(objectKey, { data, contentType, sha256Hex });
  }

  /** Test helper: check if an object exists */
  hasObject(objectKey: string): boolean {
    return this.objects.has(objectKey);
  }

  clear() {
    this.objects.clear();
  }
}
