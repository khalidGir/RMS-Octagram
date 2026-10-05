import { Injectable, Inject } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { S3UploadService } from './s3-upload.service';
import { ProofStorage } from './proof-storage.interface';

@Injectable()
export class AwsProofStorage extends ProofStorage {
  constructor(@Inject(S3UploadService) private readonly s3: S3UploadService) {
    super();
  }

  async createUploadIntent(params: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }) {
    return this.s3.createPresignedUpload(params);
  }

  async verifyObject(params: {
    objectKey: string;
    expectedSha256Hex: string;
    expectedSize: number;
    expectedContentType: string;
  }) {
    return this.s3.verifyObject(params);
  }

  async createReadUrl(objectKey: string) {
    return this.s3.createPresignedReadUrl(objectKey);
  }

  getBucket(): string {
    return this.s3.bucket;
  }
}
