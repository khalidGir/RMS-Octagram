import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'crypto';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Presigned direct-to-S3 uploads for the tenant (restaurant) logo. The logo is
 * tenant-wide, so object keys carry no branch or menu-item segment.
 */
@Injectable()
export class BrandingStorageService {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.bucket = config.get<string>('S3_MEDIA_BUCKET') ?? '';
    const endpoint = config.get<string>('S3_ENDPOINT');
    this.client = new S3Client({
      region: config.get<string>('S3_REGION', 'us-east-1'),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  private requireBucket(): string {
    if (!this.bucket) throw new ServiceUnavailableException('Logo storage is not configured');
    return this.bucket;
  }

  async createUpload(params: {
    tenantId: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }) {
    const bucket = this.requireBucket();
    if (!TYPES.has(params.contentType) || params.sizeBytes < 1 || params.sizeBytes > MAX_BYTES) {
      throw new BadRequestException('Unsupported logo image');
    }
    const extension =
      params.contentType === 'image/jpeg' ? 'jpg' : params.contentType.split('/')[1];
    const objectKey = `tenant/${params.tenantId}/logo/original/${randomUUID()}.${extension}`;
    const checksum = Buffer.from(params.sha256, 'hex').toString('base64');
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: bucket,
      Key: objectKey,
      Expires: 300,
      Conditions: [
        { key: objectKey },
        { 'Content-Type': params.contentType },
        ['content-length-range', 1, MAX_BYTES],
        { 'x-amz-checksum-sha256': checksum },
        { 'x-amz-meta-sha256': params.sha256 },
        { 'x-amz-meta-tenant-id': params.tenantId },
        { 'x-amz-meta-purpose': 'tenant-logo' },
      ],
      Fields: {
        'Content-Type': params.contentType,
        'x-amz-checksum-sha256': checksum,
        'x-amz-meta-sha256': params.sha256,
        'x-amz-meta-tenant-id': params.tenantId,
        'x-amz-meta-purpose': 'tenant-logo',
      },
    });
    return { uploadUrl: url, objectKey, fields };
  }

  async verifyObject(params: {
    objectKey: string;
    sizeBytes: number;
    contentType: string;
    sha256: string;
  }) {
    const bucket = this.requireBucket();
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: params.objectKey }),
      );
      const checksum = head.ChecksumSHA256
        ? Buffer.from(head.ChecksumSHA256, 'base64').toString('hex')
        : null;
      const metadataChecksum = head.Metadata?.sha256?.toLowerCase() ?? null;
      const observedChecksum = checksum ?? metadataChecksum;
      if (
        head.ContentLength !== params.sizeBytes ||
        head.ContentType !== params.contentType ||
        observedChecksum !== params.sha256
      ) {
        throw new BadRequestException('Uploaded logo does not match its upload intent');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Uploaded logo was not found');
    }
  }
}
