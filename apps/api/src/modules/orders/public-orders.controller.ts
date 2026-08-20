import { Controller, Post, Get, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- OrdersService is used as constructor value
import { OrdersService } from './orders.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DTOs must be value imports for class-validator decorator metadata
import { CreateTableOrderDto } from './dto';

@ApiTags('Public Orders')
@Controller('public')
export class PublicOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders')
  @ApiOperation({ summary: 'Create table order from QR context' })
  async createOrder(@Body() dto: CreateTableOrderDto, @Req() req: Request) {
    // Tenant, branch, table derived from QR token resolution
    // (set by QR resolution middleware or resolved in request pipeline)
    const context = (req as any).orderContext as {
      tenantId: string;
      branchId: string;
      tableId: string;
      diningSessionId?: string;
    };

    if (!context) {
      throw new Error('Order context not resolved. QR token must be resolved first.');
    }

    const result = await this.orders.createTableOrder({
      tenantId: context.tenantId,
      branchId: context.branchId,
      tableId: context.tableId,
      diningSessionId: context.diningSessionId,
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
        trackingToken: result.trackingTokenRaw, // Returned once, never stored in full
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
