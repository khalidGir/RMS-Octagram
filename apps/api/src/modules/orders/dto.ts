import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsArray,
  IsIn,
  ValidateNested,
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
  @ApiProperty({ type: [OrderLineDto], description: 'Order lines' })
  @IsArray()
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
  quotedTotal?: string;
}

// ─── Create POS Order ────────────────────────

export class CreatePosOrderDto {
  @ApiProperty({ type: [OrderLineDto], description: 'Order lines' })
  @IsArray()
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

  @ApiPropertyOptional({ description: 'Table ID for dine-in orders' })
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
  })
  @IsOptional()
  @IsString()
  quotedTotal?: string;
}

// ─── Edit Order ──────────────────────────────

export class EditOrderDto {
  @ApiProperty({ type: [OrderLineDto], description: 'Replacement order lines' })
  @IsArray()
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
  quotedTotal?: string;
}

// ─── Cancel Order ────────────────────────────

export class CancelOrderDto {
  @ApiPropertyOptional({ description: 'Cancellation reason', example: 'Customer changed mind' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ─── Confirm Order (disabled in 3A) ──────────

export class ConfirmOrderDto {
  @ApiPropertyOptional({ description: 'Confirmation note' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
