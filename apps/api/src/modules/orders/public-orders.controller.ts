import { Controller, Post, Get, Body, Param, BadRequestException, Inject, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { OrdersService } from './orders.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateTableOrderDto, CreatePickupOrderDto } from './dto';

@ApiTags('Public Orders')
@Controller('public')
export class PublicOrdersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  @Post('pickup-orders')
  @ApiOperation({ summary: 'Create pickup order from public branch page' })
  async createPickupOrder(@Body() dto: CreatePickupOrderDto) {
    if (!dto.customerName || !dto.customerName.trim()) {
      throw new BadRequestException('customerName is required');
    }
    if (!dto.customerPhone || !dto.customerPhone.trim()) {
      throw new BadRequestException('customerPhone is required');
    }
    if (!dto.pickupAt) {
      throw new BadRequestException('pickupAt is required');
    }

    const tenant = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, isActive: true },
      select: { tenantId: true, tenant: { select: { status: true } } },
    });
    if (!tenant || tenant.tenant.status !== 'ACTIVE') {
      throw new NotFoundException('Branch not found');
    }

    const result = await this.orders.createPickupOrder({
      tenantId: tenant.tenantId,
      branchId: dto.branchId,
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      pickupAt: dto.pickupAt,
      lines: dto.lines,
      notes: dto.notes,
      idempotencyKey: dto.idempotencyKey,
      quotedTotal: dto.quotedTotal,
    });

    return {
      data: {
        order: result.order,
        trackingToken: result.trackingTokenRaw,
      },
    };
  }

  @Post('orders')
  @ApiOperation({ summary: 'Create table order from QR context' })
  async createOrder(@Body() dto: CreateTableOrderDto) {
    // Resolve QR token server-side — never trust client for tenant/branch/table
    const tokenHash = crypto.createHash('sha256').update(dto.qrToken).digest('hex');

    const qrRecord = await this.prisma.tableQrToken.findUnique({
      where: { tokenHash },
      include: {
        table: {
          select: {
            id: true,
            branchId: true,
            tenantId: true,
            isActive: true,
          },
        },
      },
    });

    if (!qrRecord) {
      throw new NotFoundException('Invalid QR token');
    }

    if (qrRecord.revokedAt) {
      throw new BadRequestException('QR token has been revoked');
    }

    if (qrRecord.expiresAt && qrRecord.expiresAt < new Date()) {
      throw new BadRequestException('QR token has expired');
    }

    if (!qrRecord.table.isActive) {
      throw new BadRequestException('Table is not active');
    }

    // Defense in depth: verify token's tenant/branch match the table's actual relations
    if (qrRecord.table.tenantId !== qrRecord.tenantId || qrRecord.table.branchId !== qrRecord.branchId) {
      throw new BadRequestException('QR token does not match table context');
    }

    const result = await this.orders.createTableOrder({
      tenantId: qrRecord.table.tenantId,
      branchId: qrRecord.table.branchId,
      tableId: qrRecord.tableId,
      lines: dto.lines,
      notes: dto.notes,
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      idempotencyKey: dto.idempotencyKey,
      quotedTotal: dto.quotedTotal,
    });

    return {
      data: {
        order: result.order,
        trackingToken: result.trackingTokenRaw,
      },
    };
  }

  @Get('orders/:trackingToken')
  @ApiOperation({ summary: 'Track order status' })
  async trackOrder(@Param('trackingToken') trackingToken: string) {
    const result = await this.orders.trackOrder({ trackingToken });
    return { data: result };
  }
}
