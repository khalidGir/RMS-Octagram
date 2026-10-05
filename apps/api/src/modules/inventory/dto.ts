import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  Length,
  IsIn,
  IsDefined,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Inventory Items ──────────────────────

export class CreateInventoryItemDto {
  @ApiProperty({ description: 'Item name', example: 'Tomatoes' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({ description: 'SKU code', example: 'TOM-001' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  sku?: string;

  @ApiProperty({ description: 'Base measurement unit (kg, g, l, ml, pcs, etc.)', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  baseUnit!: string;

  @ApiPropertyOptional({ description: 'Low stock alert threshold', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lowStockThreshold?: number;
}

export class UpdateInventoryItemDto {
  @ApiPropertyOptional({ description: 'Item name' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ description: 'SKU code' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  sku?: string;

  @ApiPropertyOptional({ description: 'Low stock alert threshold' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Batches ──────────────────────────────

export class ReceiveBatchDto {
  @ApiProperty({ description: 'Batch code / reference', example: 'BATCH-2026-001' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  batchCode!: string;

  @ApiProperty({ description: 'Quantity received', example: 50 })
  @IsDefined()
  @IsNumber()
  @Min(0.000001)
  receivedQuantity!: number;

  @ApiProperty({ description: 'Unit of measurement', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  unit!: string;

  @ApiPropertyOptional({ description: 'Number of portions in this batch', example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  portionCount?: number;

  @ApiPropertyOptional({ description: 'Cost in minor units (cents)', example: 5000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  costMinor?: number;

  @ApiPropertyOptional({ description: 'Expiry date (ISO 8601)' })
  @IsOptional()
  @IsString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for this receive operation' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  idempotencyKey?: string;
}

// ─── Adjustments ──────────────────────────

export class CreateAdjustmentDto {
  @ApiProperty({ description: 'Adjustment quantity (positive = add, negative = subtract)', example: 5 })
  @IsDefined()
  @IsNumber()
  quantity!: number;

  @ApiProperty({ description: 'Unit of measurement', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  unit!: string;

  @ApiProperty({ description: 'Reason for adjustment', example: 'Stock count correction' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 500)
  reason!: string;

  @ApiPropertyOptional({ description: 'Batch ID to adjust (for batch inventory)' })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for this adjustment' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  idempotencyKey?: string;
}

// ─── Waste ────────────────────────────────

export class CreateWasteDto {
  @ApiProperty({ description: 'Quantity wasted', example: 2 })
  @IsDefined()
  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @ApiProperty({ description: 'Unit of measurement', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  unit!: string;

  @ApiProperty({ description: 'Reason for waste', example: 'Expired product' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 500)
  reason!: string;

  @ApiPropertyOptional({ description: 'Batch ID to waste from (for batch inventory)' })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for this waste record' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  idempotencyKey?: string;
}

// ─── Movements Query ──────────────────────

export class MovementQueryDto {
  @ApiPropertyOptional({ description: 'Filter by movement type' })
  @IsOptional()
  @IsString()
  @IsIn(['RECEIVE', 'DEDUCT', 'ADJUST', 'VOID_RESTORE', 'WASTE', 'TRANSFER'])
  movementType?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Max results (default 50, max 200)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination cursor (movement ID)' })
  @IsOptional()
  @IsString()
  after?: string;
}

// ─── Recipes ──────────────────────────────

export class RecipeComponentInputDto {
  @ApiProperty({ description: 'Inventory item ID' })
  @IsString()
  @IsNotEmpty()
  inventoryItemId!: string;

  @ApiProperty({ description: 'Quantity required', example: 0.5 })
  @IsDefined()
  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @ApiProperty({ description: 'Unit of measurement', example: 'kg' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 20)
  unit!: string;

  @ApiPropertyOptional({ description: 'Quantity per portion' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  portionQuantity?: number;
}

export class UpsertRecipeDto {
  @ApiProperty({ description: 'Recipe name', example: 'Classic Burger Recipe' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  name!: string;

  @ApiProperty({ description: 'Recipe components (ingredients)', type: [RecipeComponentInputDto] })
  @IsDefined()
  components!: RecipeComponentInputDto[];
}

// ─── Alerts Query ─────────────────────────

export class AlertsQueryDto {
  @ApiPropertyOptional({ description: 'Max results (default 50, max 200)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

// ─── Inventory Items Query ────────────────

export class InventoryItemsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Search by name or SKU' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Max results (default 50, max 200)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination cursor (item ID)' })
  @IsOptional()
  @IsString()
  after?: string;
}
