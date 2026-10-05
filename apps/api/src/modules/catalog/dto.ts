import { IsString, IsOptional, IsBoolean, IsInt, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Beverages' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Hot and cold drinks' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Drinks' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateItemDto {
  @ApiProperty({ example: 'Espresso' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Strong single shot' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sku?: string;
}

export class UpdateItemDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateVariantDto {
  @ApiProperty({ example: 'Regular' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 15000 })
  @IsInt()
  @Min(0)
  basePriceMinor!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

export class UpdateVariantDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  basePriceMinor?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sku?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class CreateModifierGroupDto {
  @ApiProperty({ example: 'Size' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  minSelections?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxSelections?: number;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;
}

export class CreateModifierOptionDto {
  @ApiProperty({ example: 'Large' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 5000 })
  @IsInt()
  priceDeltaMinor!: number;
}

export class SetBranchAvailabilityDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isAvailable!: boolean;

  @ApiPropertyOptional({ example: 18000 })
  @IsInt()
  @Min(0)
  @IsOptional()
  priceOverrideMinor?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsString()
  @IsOptional()
  availableFrom?: string;

  @ApiPropertyOptional({ example: '22:00' })
  @IsString()
  @IsOptional()
  availableUntil?: string;
}

export class LinkModifierGroupDto {
  @ApiProperty()
  @IsString()
  modifierGroupId!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
