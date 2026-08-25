import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsIn,
  Matches,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE_REGEX = /^[A-Za-z_\/]+$/;

export class ReportQueryDto {
  @ApiPropertyOptional({ description: 'Branch ID (omit for tenant-wide)' })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD, inclusive)', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'fromLocalDate must be YYYY-MM-DD' })
  fromLocalDate?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD, inclusive)', example: '2026-01-31' })
  @IsOptional()
  @IsString()
  @Matches(DATE_REGEX, { message: 'toLocalDate must be YYYY-MM-DD' })
  toLocalDate?: string;

  @ApiPropertyOptional({ description: 'IANA timezone', default: 'Africa/Addis_Ababa' })
  @IsOptional()
  @IsString()
  @Matches(TIMEZONE_REGEX, { message: 'Invalid timezone format' })
  timezone?: string;
}

export class BestSellersQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ description: 'Max results (default 20, max 100)', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class InventoryConsumptionQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ description: 'Movement type filter', enum: ['RECEIVE', 'DEDUCT', 'WASTE', 'ADJUST', 'VOID_RESTORE'] })
  @IsOptional()
  @IsString()
  @IsIn(['RECEIVE', 'DEDUCT', 'WASTE', 'ADJUST', 'VOID_RESTORE'])
  movementType?: string;

  @ApiPropertyOptional({ description: 'Inventory item ID filter' })
  @IsOptional()
  @IsString()
  inventoryItemId?: string;
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Page number (default 1)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size (default 50, max 200)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class TenantWideQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated branch IDs to include' })
  @IsOptional()
  @IsString()
  branchIds?: string;
}
