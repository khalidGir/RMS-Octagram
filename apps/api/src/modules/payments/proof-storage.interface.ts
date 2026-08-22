/**
 * Injectable token for proof storage operations.
 * AWS implementation delegates to S3; test adapter uses in-memory storage.
 */
export abstract class ProofStorage {
  abstract createUploadIntent(params: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<{ uploadUrl: string; objectKey: string; fields: Record<string, string> }>;

  abstract verifyObject(params: {
    objectKey: string;
    expectedSha256Hex: string;
    expectedSize: number;
    expectedContentType: string;
  }): Promise<void>;

  abstract createReadUrl(objectKey: string): Promise<string>;

  abstract getBucket(): string;
}
