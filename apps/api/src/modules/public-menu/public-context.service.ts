import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

export interface PublicRestaurantContext {
  tenant: { id: string; name: string };
  branch: { id: string; name: string; publicSlug: string };
  pickupEnabled: boolean;
  tableQrEnabled: boolean;
  availablePaymentMethods: string[];
}

export interface PublicTableContext {
  tenant: { id: string; name: string };
  branch: { id: string; name: string; publicSlug: string | null };
  table: { id: string; label: string; capacity: number };
  diningArea: { id: string; name: string } | null;
  availableOrderTypes: string[];
  availablePaymentMethods: string[];
}

@Injectable()
export class PublicContextService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Resolve a public restaurant slug to safe context.
   * Used by /r/{publicSlug} — customer-facing pickup pre-order.
   * Never exposes internal tenant/branch IDs to the URL.
   */
  async resolvePublicSlug(publicSlug: string): Promise<PublicRestaurantContext> {
    const branch = await this.prisma.branch.findUnique({
      where: { publicSlug },
      include: {
        tenant: { select: { id: true, name: true } },
      },
    });

    if (!branch || !branch.isActive) {
      throw new NotFoundException('Restaurant not found or unavailable');
    }

    // Check feature flags
    const pickupFeature = await this.prisma.featureSetting.findFirst({
      where: {
        tenantId: branch.tenantId,
        featureKey: 'PICKUP_ORDERING',
        enabled: true,
      },
    });

    return {
      tenant: { id: branch.tenant.id, name: branch.tenant.name },
      branch: { id: branch.id, name: branch.name, publicSlug: branch.publicSlug! },
      pickupEnabled: !!pickupFeature,
      tableQrEnabled: false, // public slug never enables table QR
      availablePaymentMethods: pickupFeature
        ? ['BANK_TRANSFER', 'TELEBIRR']
        : [],
    };
  }

  /**
   * Resolve a QR token to table context.
   * Used by /o/{token} — customer-facing table ordering.
   * Returns safe context without exposing token hash or internal IDs in URLs.
   */
  async resolveQrToken(rawToken: string): Promise<PublicTableContext> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const token = await this.prisma.tableQrToken.findUnique({
      where: { tokenHash },
      include: {
        table: {
          include: {
            branch: {
              include: {
                tenant: { select: { id: true, name: true } },
              },
            },
            diningArea: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!token) {
      throw new NotFoundException('Invalid or revoked QR code');
    }

    if (token.revokedAt) {
      throw new NotFoundException('QR code has been revoked');
    }

    if (token.expiresAt && token.expiresAt < new Date()) {
      throw new NotFoundException('QR code has expired');
    }

    const branch = token.table.branch;
    if (!branch.isActive) {
      throw new NotFoundException('Restaurant is currently unavailable');
    }

    // Check feature flags
    const tableFeature = await this.prisma.featureSetting.findFirst({
      where: {
        tenantId: branch.tenantId,
        featureKey: 'TABLE_QR_ORDERING',
        enabled: true,
      },
    });

    // Determine available payment methods for table context
    const paymentMethods: string[] = [];
    if (tableFeature) {
      paymentMethods.push('CASH', 'BANK_TRANSFER', 'TELEBIRR');
    }

    return {
      tenant: { id: branch.tenant.id, name: branch.tenant.name },
      branch: {
        id: branch.id,
        name: branch.name,
        publicSlug: branch.publicSlug,
      },
      table: {
        id: token.table.id,
        label: token.table.label,
        capacity: token.table.capacity,
      },
      diningArea: token.table.diningArea,
      availableOrderTypes: tableFeature ? ['DINE_IN', 'TAKEAWAY'] : [],
      availablePaymentMethods: paymentMethods,
    };
  }

  /**
   * Generate a new publicSlug for a branch if one doesn't exist.
   * Slug format: {branch-name-slugified}-{short-hash}
   * Globally unique across all tenants.
   */
  async ensurePublicSlug(tenantId: string, branchId: string): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
    });

    if (!branch) {
      throw new NotFoundException(`Branch ${branchId} not found`);
    }

    if (branch.publicSlug) {
      return branch.publicSlug;
    }

    // Generate unique slug
    const baseSlug = branch.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const suffix = randomBytes(4).toString('hex');
    const publicSlug = `${baseSlug}-${suffix}`;

    await this.prisma.branch.update({
      where: { id: branchId },
      data: { publicSlug },
    });

    return publicSlug;
  }
}
