import { Injectable, Inject, BadRequestException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import * as crypto from 'crypto';

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const UPLOAD_URL_TTL_SECONDS = 300; // 5 minutes
const READ_URL_TTL_SECONDS = 900; // 15 minutes

@Injectable()
export class S3UploadService {
  readonly s3: S3Client;
  private readonly bucketName: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    const region = this.config.get<string>('S3_REGION', 'us-east-1');
    this.bucketName = this.config.get<string>('S3_PROOF_BUCKET') ?? 'rms-proof-bucket';

    const endpoint = this.config.get<string>('S3_ENDPOINT');
    this.s3 = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  get bucket(): string {
    return this.bucketName;
  }

  /**
   * Build the S3 key for a payment proof object.
   * Format: tenant/{tenantId}/branch/{branchId}/payments/{paymentId}/proofs/{uuid}.{ext}
   */
  buildObjectKey(
    tenantId: string,
    branchId: string,
    paymentId: string,
    contentType: string,
  ): string {
    const ext = this.mimeToExt(contentType);
    const id = crypto.randomUUID();
    return `tenant/${tenantId}/branch/${branchId}/payments/${paymentId}/proofs/${id}.${ext}`;
  }

  /**
   * Generate a presigned POST with policy constraints.
   * Policy binds: exact key, max size, exact MIME type, checksum field, private ACL, 5-minute expiry.
   */
  async createPresignedUpload(params: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<{ uploadUrl: string; objectKey: string; fields: Record<string, string> }> {
    this.validateUploadParams(params.contentType, params.sizeBytes);

    const objectKey = this.buildObjectKey(
      params.tenantId,
      params.branchId,
      params.paymentId,
      params.contentType,
    );

    // Convert client hex checksum to S3's base64 form for policy binding
    const sha256B64 = Buffer.from(params.sha256, 'hex').toString('base64');

    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucketName,
      Key: objectKey,
      Expires: UPLOAD_URL_TTL_SECONDS,
      Conditions: [
        { bucket: this.bucketName },
        { key: objectKey },
        { 'Content-Type': params.contentType },
        ['content-length-range', 1, MAX_SIZE_BYTES],
        { 'x-amz-checksum-sha256': sha256B64 },
        { 'x-amz-meta-tenant-id': params.tenantId },
        { 'x-amz-meta-branch-id': params.branchId },
        { 'x-amz-meta-payment-id': params.paymentId },
      ],
      Fields: {
        'Content-Type': params.contentType,
        'x-amz-checksum-sha256': sha256B64,
        'x-amz-meta-tenant-id': params.tenantId,
        'x-amz-meta-branch-id': params.branchId,
        'x-amz-meta-payment-id': params.paymentId,
      },
    });

    return { uploadUrl: url, objectKey, fields };
  }

  /**
   * Verify the uploaded object matches expected metadata.
   * Requires ChecksumSHA256 from S3 (base64-encoded) to match the stored hex checksum.
   */
  async verifyObject(params: {
    objectKey: string;
    expectedSha256Hex: string;
    expectedSize: number;
    expectedContentType: string;
  }): Promise<void> {
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: params.objectKey,
        }),
      );

      // Verify content length
      if (head.ContentLength !== params.expectedSize) {
        throw new BadRequestException(
          `Size mismatch: expected ${params.expectedSize}, got ${head.ContentLength}`,
        );
      }

      // Verify content type
      if (head.ContentType !== params.expectedContentType) {
        throw new BadRequestException(
          `Content-Type mismatch: expected ${params.expectedContentType}, got ${head.ContentType}`,
        );
      }

      // Verify checksum — S3 returns base64, we store hex. Convert and compare.
      if (!head.ChecksumSHA256) {
        throw new BadRequestException('Checksum missing from uploaded object');
      }
      const s3ChecksumHex = Buffer.from(head.ChecksumSHA256, 'base64').toString('hex');
      if (s3ChecksumHex !== params.expectedSha256Hex) {
        throw new BadRequestException('Checksum mismatch');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Object not found or inaccessible');
    }
  }

  /**
   * Generate a short-lived signed URL for authorized staff to view the proof.
   */
  async createPresignedReadUrl(objectKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: objectKey,
      ResponseContentType: 'application/octet-stream',
      ResponseContentDisposition: 'inline',
    });

    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(this.s3, command, { expiresIn: READ_URL_TTL_SECONDS });
  }

  private validateUploadParams(contentType: string, sizeBytes: number): void {
    if (!ACCEPTED_MIME_TYPES.includes(contentType)) {
      throw new BadRequestException(
        `Accepted types: ${ACCEPTED_MIME_TYPES.join(', ')}. Got: ${contentType}`,
      );
    }
    if (sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) {
      throw new BadRequestException(
        `File size must be between 1 and ${MAX_SIZE_BYTES} bytes. Got: ${sizeBytes}`,
      );
    }
  }

  private mimeToExt(contentType: string): string {
    switch (contentType) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        return 'bin';
    }
  }
}
