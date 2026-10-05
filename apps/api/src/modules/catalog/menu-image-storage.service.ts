import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'crypto';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class MenuImageStorageService {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.bucket = config.get<string>('S3_MEDIA_BUCKET') ?? config.get<string>('S3_PROOF_BUCKET') ?? 'rms-proof-bucket';
    const endpoint = config.get<string>('S3_ENDPOINT');
    this.client = new S3Client({
      region: config.get<string>('S3_REGION', 'us-east-1'),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  async createUpload(params: { tenantId: string; itemId: string; contentType: string; sizeBytes: number; sha256: string }) {
    if (!TYPES.has(params.contentType) || params.sizeBytes < 1 || params.sizeBytes > MAX_BYTES) {
      throw new BadRequestException('Unsupported menu image');
    }
    const extension = params.contentType === 'image/jpeg' ? 'jpg' : params.contentType.split('/')[1];
    const objectKey = `tenant/${params.tenantId}/menu-items/${params.itemId}/original/${randomUUID()}.${extension}`;
    const checksum = Buffer.from(params.sha256, 'hex').toString('base64');
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: objectKey,
      Expires: 300,
      Conditions: [
        { key: objectKey },
        { 'Content-Type': params.contentType },
        ['content-length-range', 1, MAX_BYTES],
        { 'x-amz-checksum-sha256': checksum },
        { 'x-amz-meta-tenant-id': params.tenantId },
        { 'x-amz-meta-menu-item-id': params.itemId },
      ],
      Fields: {
        'Content-Type': params.contentType,
        'x-amz-checksum-sha256': checksum,
        'x-amz-meta-tenant-id': params.tenantId,
        'x-amz-meta-menu-item-id': params.itemId,
      },
    });
    return { uploadUrl: url, objectKey, fields };
  }

  async verifyObject(params: { objectKey: string; sizeBytes: number; contentType: string; sha256: string }) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: params.objectKey }));
      const checksum = head.ChecksumSHA256 ? Buffer.from(head.ChecksumSHA256, 'base64').toString('hex') : null;
      if (head.ContentLength !== params.sizeBytes || head.ContentType !== params.contentType || checksum !== params.sha256) {
        throw new BadRequestException('Uploaded image does not match its upload intent');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Uploaded image was not found');
    }
  }
}
