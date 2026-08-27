import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsArray,
  IsIn,
  ValidateNested,
  ArrayMinSize,
  Matches,
  IsDateString,
  IsNotEmpty,
  IsDefined,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Order Line DTOs ─────────────────────────

export class OrderLineDto {
  @ApiProperty({ description: 'Menu item variant ID', example: 'uuid-variant-id' })
  @IsString()
  variantId!: string;

  @ApiProperty({ description: 'Quantity (must be positive)', example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Selected modifier option IDs',
    example: ['uuid-mod-1', 'uuid-mod-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modifierOptionIds?: string[];

  @ApiPropertyOptional({ description: 'Line-level notes', example: 'No onions' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ─── Create Table Order ──────────────────────

export class CreateTableOrderDto {
  @ApiProperty({ description: 'QR token from table QR code' })
  @IsString()
  qrToken!: string;

  @ApiProperty({ type: [OrderLineDto], description: 'Order lines' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  @ApiPropertyOptional({ description: 'Customer name', example: 'Abebe' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @ApiPropertyOptional({ description: 'Customer phone', example: '+251911111111' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  customerPhone?: string;

  @ApiPropertyOptional({ description: 'Order notes', example: 'No spicy' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for safe retries' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'Quoted total for stale-cart detection (string BigInt minor units)',
    example: '15000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'quotedTotal must be a numeric string' })
  quotedTotal?: string;
}

// ─── Create POS Order ────────────────────────

export class CreatePosOrderDto {
  @ApiProperty({ type: [OrderLineDto], description: 'Order lines' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  @ApiPropertyOptional({ description: 'Order notes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({
    enum: ['POS', 'DINE_IN', 'PICKUP'],
    description: 'Order type',
    example: 'POS',
  })
  @IsString()
  @IsIn(['POS', 'DINE_IN', 'PICKUP'])
  orderType!: string;

  @ApiPropertyOptional({ description: 'Table ID for dine-in orders (required when orderType is DINE_IN)' })
  @IsOptional()
  @IsString()
  tableId?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for safe retries' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'Quoted total for stale-cart detection (string BigInt minor units)',
    example: '15000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'quotedTotal must be a numeric string' })
  quotedTotal?: string;
}

// ─── Edit Order ──────────────────────────────

export class EditOrderDto {
  @ApiProperty({ type: [OrderLineDto], description: 'Replacement order lines' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  @ApiPropertyOptional({ description: 'Updated notes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ description: 'Expected order version for optimistic locking', example: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Quoted total for stale-cart detection' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'quotedTotal must be a numeric string' })
  quotedTotal?: string;
}

// ─── Cancel Order ────────────────────────────

export class CancelOrderDto {
  @ApiPropertyOptional({ description: 'Cancellation reason', example: 'Customer changed mind' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ description: 'Expected order version for optimistic locking', example: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

// ─── List Orders ─────────────────────────────

export class ListOrdersDto {
  @ApiPropertyOptional({ description: 'Filter by order status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by order type' })
  @IsOptional()
  @IsString()
  orderType?: string;

  @ApiPropertyOptional({ description: 'Filter orders created after this ISO datetime' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter orders created before this ISO datetime' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Page size (1-100)', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cursor for pagination (ISO datetime of last item)' })
  @IsOptional()
  @IsString()
  after?: string;
}

// ─── Confirm Order (disabled in 3A) ──────────

export class ConfirmOrderDto {
  @ApiPropertyOptional({ description: 'Confirmation note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ─── Create Public Pickup Order ─────────────

export class CreatePickupOrderDto {
  @ApiProperty({ description: 'Branch ID to order from' })
  @IsString()
  branchId!: string;

  @ApiProperty({ type: [OrderLineDto], description: 'Order lines' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];

  @ApiProperty({ description: 'Customer name (required for pickup)', example: 'Abebe' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  customerName!: string;

  @ApiProperty({ description: 'Customer phone (required for pickup)', example: '+251911111111' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  customerPhone!: string;

  @ApiProperty({ description: 'Pickup time (ISO 8601, must be in the future)', example: '2026-08-23T15:00:00Z' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  pickupAt!: string;

  @ApiPropertyOptional({ description: 'Order notes', example: 'No spicy' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for safe retries' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: 'Quoted total for stale-cart detection (string BigInt minor units)',
    example: '15000',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'quotedTotal must be a numeric string' })
  quotedTotal?: string;
}
