import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { MenuImageProcessor, PermanentImageError } from './menu-image.processor';

type Row = Record<string, unknown>;

interface S3PutInput {
  Bucket: string;
  Key: string;
  Body: Buffer | Uint8Array | string;
  ContentType?: string;
  CacheControl?: string;
  Metadata?: Record<string, string>;
}

// Everything the module-scope `new PrismaClient()` and the mocked S3 module
// need must exist before the imports below execute, hence vi.hoisted.
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const mediaObjects = new Map<string, Row>();
  const menuItems = new Map<string, Row>();
  const tenants = new Map<string, Row>();
  const audits: Row[] = [];
  const s3Objects = new Map<string, Buffer>();
  const s3Puts: string[] = [];
  const s3Deletes: string[] = [];
  const state = { failGet: false };

  function valueMatches(rowValue: unknown, cond: unknown): boolean {
    if (cond === null) return rowValue === null;
    if (cond instanceof Date)
      return rowValue instanceof Date && rowValue.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      const c = cond as { in?: unknown[]; lte?: Date; lt?: Date; gt?: Date };
      if (c.in) return c.in.includes(rowValue);
      if (c.lte !== undefined) return rowValue instanceof Date && rowValue <= c.lte;
      if (c.lt !== undefined) return rowValue instanceof Date && rowValue < c.lt;
      if (c.gt !== undefined) return rowValue instanceof Date && rowValue > c.gt;
      return false;
    }
    return rowValue === cond;
  }

  function matchWhere(row: Row, where: Row): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'OR') {
        if (!(cond as Row[]).some((clause) => matchWhere(row, clause))) return false;
      } else if (!valueMatches(row[key], cond)) {
        return false;
      }
    }
    return true;
  }

  function applyData(row: Row, data: Row): void {
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === 'object' &&
        !(value instanceof Date) &&
        'increment' in (value as Row)
      ) {
        row[key] = (row[key] as number) + (value as { increment: number }).increment;
      } else {
        row[key] = value;
      }
    }
  }

  // CAS semantics for exactly the query shapes the processor uses. Reads
  // return snapshots (like Prisma rows) so later updates cannot retroactively
  // mutate values a caller already read.
  type MockTransactionClient = Record<string, unknown>;
  const prismaDouble = {
    mediaObject: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = mediaObjects.get(where.id as string);
        return row ? { ...row } : null;
      },
      findFirst: async ({ where }: { where: Row }) => {
        const row = [...mediaObjects.values()].find((candidate) => matchWhere(candidate, where));
        return row ? { ...row } : null;
      },
      findMany: async ({ where, take }: { where: Row; take?: number }) => {
        const rows = [...mediaObjects.values()]
          .filter((candidate) => matchWhere(candidate, where))
          .map((row) => ({ ...row }));
        return typeof take === 'number' ? rows.slice(0, take) : rows;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = [...mediaObjects.values()].filter((row) => matchWhere(row, where));
        rows.forEach((row) => applyData(row, data));
        return { count: rows.length };
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = mediaObjects.get(where.id as string);
        if (!row || !matchWhere(row, where)) throw new Error('Record not found');
        applyData(row, data);
        return row;
      },
    },
    menuItem: {
      findFirst: async ({ where }: { where: Row }) => {
        const row = [...menuItems.values()].find((candidate) => matchWhere(candidate, where));
        return row ? { ...row } : null;
      },
      count: async ({ where }: { where: Row }) =>
        menuItems.size === 0
          ? 0
          : [...menuItems.values()].filter((row) => matchWhere(row, where)).length,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = [...menuItems.values()].filter((row) => matchWhere(row, where));
        rows.forEach((row) => applyData(row, data));
        return { count: rows.length };
      },
    },
    tenant: {
      findUnique: async ({ where }: { where: Row }) => {
        const row = tenants.get(where.id as string);
        return row ? { ...row } : null;
      },
      count: async ({ where }: { where: Row }) =>
        [...tenants.values()].filter((row) => matchWhere(row, where)).length,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const rows = [...tenants.values()].filter((row) => matchWhere(row, where));
        rows.forEach((row) => applyData(row, data));
        return { count: rows.length };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Row }) => {
        audits.push(data);
        return data;
      },
    },
    async $transaction(fn: (tx: MockTransactionClient) => Promise<unknown>) {
      return fn(prismaDouble);
    },
  };

  class GetObjectCommand {
    constructor(public input: Row) {}
  }
  class PutObjectCommand {
    constructor(public input: S3PutInput) {}
  }
  class DeleteObjectCommand {
    constructor(public input: { Bucket: string; Key: string }) {}
  }

  const s3Send = vi.fn(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      if (state.failGet) throw new Error('S3 connection reset');
      const body = s3Objects.get(command.input.Key as string);
      if (!body) throw new Error('NoSuchKey');
      return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
    }
    if (command instanceof PutObjectCommand) {
      s3Objects.set(command.input.Key, Buffer.from(command.input.Body));
      s3Puts.push(command.input.Key);
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      s3Objects.delete(command.input.Key);
      s3Deletes.push(command.input.Key);
      return {};
    }
    throw new Error('Unexpected S3 command');
  });

  return {
    mediaObjects,
    menuItems,
    tenants,
    audits,
    s3Objects,
    s3Puts,
    s3Deletes,
    state,
    s3Send,
    prismaDouble,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
  };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: function PrismaClient() {
    return h.prismaDouble;
  },
}));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: h.GetObjectCommand,
  PutObjectCommand: h.PutObjectCommand,
  DeleteObjectCommand: h.DeleteObjectCommand,
  S3Client: class {
    send = h.s3Send;
  },
}));

const config = {
  get: (key: string, fallback?: string) => {
    if (key === 'S3_MEDIA_BUCKET') return 'media-test-bucket';
    if (key === 'S3_REGION') return 'us-east-1';
    return fallback;
  },
};

async function solid(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
}

async function quadrantImage(orientation?: number): Promise<Buffer> {
  const tiles = [
    { input: await solid(600, 450, { r: 220, g: 0, b: 0 }), left: 0, top: 0 },
    { input: await solid(600, 450, { r: 0, g: 200, b: 0 }), left: 600, top: 0 },
    { input: await solid(600, 450, { r: 0, g: 0, b: 220 }), left: 0, top: 450 },
    { input: await solid(600, 450, { r: 230, g: 220, b: 0 }), left: 600, top: 450 },
  ];
  let pipeline = sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 0, g: 0, b: 0 } },
  }).composite(tiles);
  if (orientation) pipeline = pipeline.withMetadata({ orientation });
  return pipeline.jpeg({ quality: 95 }).toBuffer();
}

async function centerColor(bytes: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const offset =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
}

function expectColorNear(
  actual: { r: number; g: number; b: number },
  expected: { r: number; g: number; b: number },
) {
  expect(Math.abs(actual.r - expected.r)).toBeLessThan(70);
  expect(Math.abs(actual.g - expected.g)).toBeLessThan(70);
  expect(Math.abs(actual.b - expected.b)).toBeLessThan(70);
}

const FULL_CROP = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };
const QUARTER_CROP = { x: 0, y: 0, width: 0.5, height: 0.5, rotation: 0 };

function seedItem(overrides: Row = {}) {
  h.menuItems.set('item-1', {
    id: 'item-1',
    tenantId: 'tenant-a',
    version: 1,
    imageMediaId: null,
    deletedAt: null,
    ...overrides,
  });
}

function seedMedia(bytes: Buffer, overrides: Row = {}) {
  h.s3Objects.set('tenant/tenant-a/menu-items/item-1/original/src.jpg', bytes);
  h.mediaObjects.set('media-1', {
    id: 'media-1',
    tenantId: 'tenant-a',
    targetMenuItemId: 'item-1',
    purpose: 'MENU_ITEM_IMAGE',
    deletedAt: null,
    objectKey: 'tenant/tenant-a/menu-items/item-1/original/src.jpg',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    cropData: FULL_CROP,
    expectedItemVersion: 1,
    uploadedByUserId: 'user-1',
    processingStatus: 'PENDING_PROCESSING',
    processingLeaseExpiresAt: null,
    processingStartedAt: null,
    processingAttempt: 0,
    ...overrides,
  });
}

function seedTenant(overrides: Row = {}) {
  h.tenants.set('tenant-a', {
    id: 'tenant-a',
    version: 1,
    logoMediaId: null,
    name: 'Buna House',
    ...overrides,
  });
}

function seedLogoMedia(bytes: Buffer, overrides: Row = {}) {
  h.s3Objects.set('tenant/tenant-a/logo/original/logo-src.png', bytes);
  h.mediaObjects.set('media-1', {
    id: 'media-1',
    tenantId: 'tenant-a',
    targetMenuItemId: null,
    purpose: 'TENANT_LOGO',
    deletedAt: null,
    objectKey: 'tenant/tenant-a/logo/original/logo-src.png',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    cropData: FULL_CROP,
    expectedItemVersion: 1,
    uploadedByUserId: 'user-1',
    processingStatus: 'PENDING_PROCESSING',
    processingLeaseExpiresAt: null,
    processingStartedAt: null,
    processingAttempt: 0,
    ...overrides,
  });
}

let processor: MenuImageProcessor;

describe('MenuImageProcessor', () => {
  beforeEach(() => {
    h.mediaObjects.clear();
    h.menuItems.clear();
    h.tenants.clear();
    h.audits.length = 0;
    h.s3Objects.clear();
    h.s3Puts.length = 0;
    h.s3Deletes.length = 0;
    h.state.failGet = false;
    h.s3Send.mockClear();
    processor = new MenuImageProcessor(config as never);
  });

  it('completes a healthy upload: READY, three derivatives, secret CDN key, attached item', async () => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes);

    await expect(processor.handleJob('media-1')).resolves.toBe('COMPLETED');

    const media = h.mediaObjects.get('media-1')!;
    expect(media.processingStatus).toBe('READY');
    expect(media.processingLeaseExpiresAt).toBeNull();
    expect(media.processingAttempt).toBe(1);
    expect(media.outputWidth).toBe(1280);
    expect(media.outputHeight).toBe(960);
    expect(media.rejectionReason).toBeNull();

    const base = media.cdnKeyBase as string;
    expect(base).toMatch(/^menu-items\/item-1\/[A-Za-z0-9_-]{22}-[0-9a-f]{12}$/);
    expect(base).not.toContain('tenant-a');
    expect(base).not.toContain('media-1');

    const keys = h.s3Puts.map((key) => key.replace(`public/${base}/`, '')).sort();
    expect(keys).toEqual(['1280x960.webp', '320x240.webp', '640x480.webp']);
    for (const [width, height] of [
      [320, 240],
      [640, 480],
      [1280, 960],
    ]) {
      const derivative = h.s3Objects.get(`public/${base}/${width}x${height}.webp`)!;
      const meta = await sharp(derivative).metadata();
      expect(meta.width).toBe(width);
      expect(meta.height).toBe(height);
      expect(meta.format).toBe('webp');
    }

    const item = h.menuItems.get('item-1')!;
    expect(item.imageMediaId).toBe('media-1');
    expect(item.version).toBe(2);
    expect(h.audits.map((entry) => entry.action)).toContain('MENU_IMAGE_PROCESS_COMPLETE');
  });

  it('fails transiently and touches nothing when S3_MEDIA_BUCKET is not configured', async () => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes);
    const unconfigured = new MenuImageProcessor({
      get: (key: string, fallback?: string) => (key === 'S3_REGION' ? 'us-east-1' : fallback),
    } as never);

    await expect(unconfigured.handleJob('media-1')).rejects.toThrow(
      'S3_MEDIA_BUCKET is not configured',
    );

    expect(h.s3Send).not.toHaveBeenCalled();
    expect(h.s3Puts).toHaveLength(0);
    const media = h.mediaObjects.get('media-1')!;
    expect(media.processingStatus).toBe('PENDING_PROCESSING');
    expect(media.processingLeaseExpiresAt).toBeNull();
    expect(h.menuItems.get('item-1')!.imageMediaId).toBeNull();
  });

  it('crops the selected quadrant without rotation', async () => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes, { cropData: QUARTER_CROP });

    await expect(processor.handleJob('media-1')).resolves.toBe('COMPLETED');

    const base = h.mediaObjects.get('media-1')!.cdnKeyBase as string;
    expectColorNear(await centerColor(h.s3Objects.get(`public/${base}/640x480.webp`)!), {
      r: 220,
      g: 0,
      b: 0,
    });
  });

  it('rotates before extracting so the crop lands on the rotated quadrant', async () => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes, { cropData: { ...QUARTER_CROP, rotation: 90 } });

    await expect(processor.handleJob('media-1')).resolves.toBe('COMPLETED');

    // 90° clockwise moves the original bottom-left (blue) quadrant into the
    // top-left of the rotated image, which is the region the crop selects.
    const base = h.mediaObjects.get('media-1')!.cdnKeyBase as string;
    expectColorNear(await centerColor(h.s3Objects.get(`public/${base}/640x480.webp`)!), {
      r: 0,
      g: 0,
      b: 220,
    });
  });

  it('bakes EXIF orientation before cropping (orientation 6 behaves like 90° rotation)', async () => {
    const bytes = await quadrantImage(6);
    seedItem();
    seedMedia(bytes, { cropData: QUARTER_CROP });

    await expect(processor.handleJob('media-1')).resolves.toBe('COMPLETED');

    const base = h.mediaObjects.get('media-1')!.cdnKeyBase as string;
    expectColorNear(await centerColor(h.s3Objects.get(`public/${base}/640x480.webp`)!), {
      r: 0,
      g: 0,
      b: 220,
    });
  });

  it('rejects images below the minimum size without uploading anything', async () => {
    const bytes = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .jpeg()
      .toBuffer();
    seedItem();
    seedMedia(bytes);

    await expect(processor.handleJob('media-1')).resolves.toBe('REJECTED');

    const media = h.mediaObjects.get('media-1')!;
    expect(media.processingStatus).toBe('REJECTED');
    expect(media.rejectionReason).toContain('800');
    expect(media.cleanupAfter).toBeInstanceOf(Date);
    expect(h.s3Puts).toHaveLength(0);
    expect(h.menuItems.get('item-1')!.imageMediaId).toBeNull();
  });

  it('rejects bytes that are not decodable as an image', async () => {
    seedItem();
    seedMedia(Buffer.from('this is definitely not an image payload'));

    await expect(processor.handleJob('media-1')).resolves.toBe('REJECTED');
    expect(h.mediaObjects.get('media-1')!.processingStatus).toBe('REJECTED');
    expect(h.s3Puts).toHaveLength(0);
  });

  it('rejects on version conflict, removes uploaded derivatives, never resurrects the item image', async () => {
    const bytes = await quadrantImage();
    seedItem({ version: 7 });
    seedMedia(bytes, { expectedItemVersion: 5 });

    await expect(processor.handleJob('media-1')).resolves.toBe('REJECTED');

    const media = h.mediaObjects.get('media-1')!;
    expect(media.processingStatus).toBe('REJECTED');
    expect(media.rejectionReason).toContain('changed during processing');
    expect(h.s3Puts).toHaveLength(3);
    expect(h.s3Deletes).toHaveLength(3);
    expect([...h.s3Objects.keys()].filter((key) => key.startsWith('public/'))).toHaveLength(0);
    const item = h.menuItems.get('item-1')!;
    expect(item.imageMediaId).toBeNull();
    expect(item.version).toBe(7);
  });

  it('rejects when the target menu item was deleted during processing', async () => {
    const bytes = await quadrantImage();
    seedItem({ deletedAt: new Date() });
    seedMedia(bytes);

    await expect(processor.handleJob('media-1')).resolves.toBe('REJECTED');
    expect(h.mediaObjects.get('media-1')!.processingStatus).toBe('REJECTED');
  });

  it('resets to PENDING_PROCESSING and rethrows on transient S3 failure', async () => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes);
    h.state.failGet = true;

    await expect(processor.handleJob('media-1')).rejects.toThrow('S3 connection reset');

    const media = h.mediaObjects.get('media-1')!;
    expect(media.processingStatus).toBe('PENDING_PROCESSING');
    expect(media.processingLeaseExpiresAt).toBeNull();
    expect(media.processingStartedAt).toBeNull();
  });

  it('does not touch a job whose lease is still live', async () => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes, {
      processingStatus: 'PROCESSING',
      processingLeaseExpiresAt: new Date(Date.now() + 60_000),
      processingStartedAt: new Date(),
    });

    await expect(processor.handleJob('media-1')).resolves.toBe('IN_FLIGHT');
    expect(h.s3Send).not.toHaveBeenCalled();
    expect(h.mediaObjects.get('media-1')!.processingStatus).toBe('PROCESSING');
  });

  it('reclaims a crashed job after its lease expired', async () => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes, {
      processingStatus: 'PROCESSING',
      processingLeaseExpiresAt: new Date(Date.now() - 1_000),
      processingStartedAt: new Date(Date.now() - 600_000),
    });

    await expect(processor.handleJob('media-1')).resolves.toBe('COMPLETED');
    expect(h.mediaObjects.get('media-1')!.processingStatus).toBe('READY');
    expect(h.mediaObjects.get('media-1')!.processingAttempt).toBe(1);
  });

  it.each([
    ['missing row', null as Row | null],
    ['terminal READY', { processingStatus: 'READY' } as Row],
    ['terminal REJECTED', { processingStatus: 'REJECTED' } as Row],
    ['upload not finalized', { processingStatus: 'PENDING_UPLOAD' } as Row],
    ['wrong purpose', { purpose: 'PAYMENT_PROOF' } as Row],
    ['soft deleted', { deletedAt: new Date() } as Row],
  ])('skips when the job is %s', async (_label, overrides) => {
    const bytes = await quadrantImage();
    seedItem();
    seedMedia(bytes, overrides ?? {});
    if (overrides === null) h.mediaObjects.delete('media-1');

    await expect(processor.handleJob('media-1')).resolves.toBe('SKIPPED');
    expect(h.s3Send).not.toHaveBeenCalled();
  });

  it('schedules cleanup of the replaced image when attaching a new one', async () => {
    const bytes = await quadrantImage();
    seedItem({ imageMediaId: 'old-media' });
    h.mediaObjects.set('old-media', {
      id: 'old-media',
      tenantId: 'tenant-a',
      purpose: 'MENU_ITEM_IMAGE',
      deletedAt: null,
      cleanupAfter: null,
      cdnKeyBase: 'menu-items/item-1/old-token-000000000000-abcdefabcdef',
      objectKey: 'tenant/tenant-a/menu-items/item-1/original/old.jpg',
    });
    seedMedia(bytes);

    await expect(processor.handleJob('media-1')).resolves.toBe('COMPLETED');

    const old = h.mediaObjects.get('old-media')!;
    expect(old.cleanupAfter).toBeInstanceOf(Date);
    expect((old.cleanupAfter as Date).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(old.deletedAt).toBeNull();
  });

  it('sweep deletes expired media and its S3 objects but never touches attached media', async () => {
    h.s3Objects.set('tenant/tenant-a/menu-items/item-1/original/expired.jpg', Buffer.from('x'));
    const base = 'menu-items/item-1/old-token-000000000000-abcdefabcdef';
    for (const [width, height] of [
      [320, 240],
      [640, 480],
      [1280, 960],
    ]) {
      h.s3Objects.set(`public/${base}/${width}x${height}.webp`, Buffer.from('x'));
    }
    h.mediaObjects.set('media-expired', {
      id: 'media-expired',
      tenantId: 'tenant-a',
      purpose: 'MENU_ITEM_IMAGE',
      deletedAt: null,
      processingStatus: 'REJECTED',
      cleanupAfter: new Date(Date.now() - 1_000),
      cdnKeyBase: base,
      objectKey: 'tenant/tenant-a/menu-items/item-1/original/expired.jpg',
    });
    h.s3Objects.set('tenant/tenant-a/menu-items/item-1/original/attached.jpg', Buffer.from('y'));
    h.mediaObjects.set('media-attached', {
      id: 'media-attached',
      tenantId: 'tenant-a',
      purpose: 'MENU_ITEM_IMAGE',
      deletedAt: null,
      processingStatus: 'READY',
      cleanupAfter: new Date(Date.now() - 1_000),
      cdnKeyBase: null,
      objectKey: 'tenant/tenant-a/menu-items/item-1/original/attached.jpg',
    });
    h.menuItems.set('item-attached', {
      id: 'item-attached',
      tenantId: 'tenant-a',
      imageMediaId: 'media-attached',
    });

    await processor.sweep();

    expect(h.mediaObjects.get('media-expired')!.deletedAt).toBeInstanceOf(Date);
    expect(h.mediaObjects.get('media-attached')!.deletedAt).toBeNull();
    expect(h.s3Objects.has('tenant/tenant-a/menu-items/item-1/original/expired.jpg')).toBe(false);
    expect(h.s3Objects.has(`public/${base}/640x480.webp`)).toBe(false);
    expect(h.s3Objects.has('tenant/tenant-a/menu-items/item-1/original/attached.jpg')).toBe(true);
  });

  describe('tenant logo purpose', () => {
    const LOGO_OUTPUT_FILES = [
      '180x180.png',
      '192x192.png',
      '320x320.webp',
      '512x512-maskable.png',
      '512x512.png',
    ];

    it('completes a healthy logo: READY, five derivatives, tenant attached with version bump', async () => {
      const bytes = await quadrantImage();
      seedTenant();
      seedLogoMedia(bytes);

      await expect(processor.handleJob('media-1')).resolves.toBe('COMPLETED');

      const media = h.mediaObjects.get('media-1')!;
      expect(media.processingStatus).toBe('READY');
      expect(media.processingAttempt).toBe(1);
      expect(media.outputWidth).toBe(512);
      expect(media.outputHeight).toBe(512);
      expect(media.outputFormat).toBe('png');
      expect(media.rejectionReason).toBeNull();

      const base = media.cdnKeyBase as string;
      expect(base).toMatch(/^logos\/[A-Za-z0-9_-]{22}-[0-9a-f]{12}$/);
      expect(base).not.toContain('tenant-a');
      expect(base).not.toContain('media-1');

      const keys = h.s3Puts.map((key) => key.replace(`public/${base}/`, '')).sort();
      expect(keys).toEqual(LOGO_OUTPUT_FILES);

      const icon = await sharp(h.s3Objects.get(`public/${base}/192x192.png`)!).metadata();
      expect([icon.width, icon.height, icon.format]).toEqual([192, 192, 'png']);
      const maskable = await sharp(
        h.s3Objects.get(`public/${base}/512x512-maskable.png`)!,
      ).metadata();
      expect([maskable.width, maskable.height, maskable.format]).toEqual([512, 512, 'png']);
      const thumb = await sharp(h.s3Objects.get(`public/${base}/320x320.webp`)!).metadata();
      expect([thumb.width, thumb.height, thumb.format]).toEqual([320, 320, 'webp']);

      const tenant = h.tenants.get('tenant-a')!;
      expect(tenant.logoMediaId).toBe('media-1');
      expect(tenant.version).toBe(2);
      expect(h.audits.map((entry) => entry.action)).toContain('BRANDING_LOGO_PROCESS_COMPLETE');
    });

    it('rejects a logo below the minimum size without uploading or attaching anything', async () => {
      const bytes = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 10, b: 10 } },
      })
        .png()
        .toBuffer();
      seedTenant();
      seedLogoMedia(bytes);

      await expect(processor.handleJob('media-1')).resolves.toBe('REJECTED');

      const media = h.mediaObjects.get('media-1')!;
      expect(media.processingStatus).toBe('REJECTED');
      expect(media.rejectionReason).toContain('256');
      expect(h.s3Puts).toHaveLength(0);
      const tenant = h.tenants.get('tenant-a')!;
      expect(tenant.logoMediaId).toBeNull();
      expect(tenant.version).toBe(1);
    });

    it('rejects a tenant version conflict, removes uploaded derivatives, never attaches the logo', async () => {
      const bytes = await quadrantImage();
      seedTenant({ version: 7 });
      seedLogoMedia(bytes, { expectedItemVersion: 5 });

      await expect(processor.handleJob('media-1')).resolves.toBe('REJECTED');

      const media = h.mediaObjects.get('media-1')!;
      expect(media.processingStatus).toBe('REJECTED');
      expect(media.rejectionReason).toContain('changed during processing');
      expect(h.s3Puts).toHaveLength(5);
      expect(h.s3Deletes).toHaveLength(5);
      expect([...h.s3Objects.keys()].filter((key) => key.startsWith('public/'))).toHaveLength(0);
      const tenant = h.tenants.get('tenant-a')!;
      expect(tenant.logoMediaId).toBeNull();
      expect(tenant.version).toBe(7);
    });

    it('rejects when the tenant was deleted during processing', async () => {
      const bytes = await quadrantImage();
      seedLogoMedia(bytes);
      h.tenants.delete('tenant-a');

      await expect(processor.handleJob('media-1')).resolves.toBe('REJECTED');
      expect(h.mediaObjects.get('media-1')!.processingStatus).toBe('REJECTED');
      expect(h.mediaObjects.get('media-1')!.rejectionReason).toContain('no longer exists');
      expect(h.s3Puts).toHaveLength(5);
      expect(h.s3Deletes).toHaveLength(5);
      expect([...h.s3Objects.keys()].filter((key) => key.startsWith('public/'))).toHaveLength(0);
    });

    it('sweep removes expired logo media with its derivatives but never the attached logo', async () => {
      const base = 'logos/old-token-000000000000-abcdefabcdef';
      h.s3Objects.set('tenant/tenant-a/logo/original/expired.png', Buffer.from('x'));
      for (const file of LOGO_OUTPUT_FILES)
        h.s3Objects.set(`public/${base}/${file}`, Buffer.from('x'));
      h.mediaObjects.set('media-expired-logo', {
        id: 'media-expired-logo',
        tenantId: 'tenant-a',
        purpose: 'TENANT_LOGO',
        deletedAt: null,
        processingStatus: 'REJECTED',
        cleanupAfter: new Date(Date.now() - 1_000),
        cdnKeyBase: base,
        objectKey: 'tenant/tenant-a/logo/original/expired.png',
      });

      const attachedBase = 'logos/attached-token-000000000000-abcdefabcdef';
      h.s3Objects.set('tenant/tenant-a/logo/original/attached.png', Buffer.from('y'));
      h.mediaObjects.set('media-logo-attached', {
        id: 'media-logo-attached',
        tenantId: 'tenant-a',
        purpose: 'TENANT_LOGO',
        deletedAt: null,
        processingStatus: 'READY',
        cleanupAfter: new Date(Date.now() - 1_000),
        cdnKeyBase: attachedBase,
        objectKey: 'tenant/tenant-a/logo/original/attached.png',
      });
      seedTenant({ logoMediaId: 'media-logo-attached' });

      await processor.sweep();

      expect(h.mediaObjects.get('media-expired-logo')!.deletedAt).toBeInstanceOf(Date);
      expect(h.mediaObjects.get('media-logo-attached')!.deletedAt).toBeNull();
      expect(h.s3Objects.has(`public/${base}/192x192.png`)).toBe(false);
      expect(h.s3Objects.has('tenant/tenant-a/logo/original/expired.png')).toBe(false);
      expect(h.s3Objects.has('tenant/tenant-a/logo/original/attached.png')).toBe(true);
    });
  });
});

describe('PermanentImageError', () => {
  it('is an Error subclass so retry classification works', () => {
    expect(new PermanentImageError('x')).toBeInstanceOf(Error);
  });
});
