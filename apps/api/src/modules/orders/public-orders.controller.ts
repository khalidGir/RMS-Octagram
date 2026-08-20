import { Controller, Post, Get, Body, Param, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- PrismaService is used as constructor value
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- OrdersService is used as constructor value
import { OrdersService } from './orders.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTOs must be value imports for class-validator decorator metadata
import { CreateTableOrderDto } from './dto';

@ApiTags('Public Orders')
@Controller('public')
export class PublicOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

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

    const result = await this.orders.createTableOrder({
      tenantId: qrRecord.tenantId,
      branchId: qrRecord.branchId,
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
