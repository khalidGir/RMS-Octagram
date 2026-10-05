import { IsString, IsOptional, IsBoolean, IsInt, IsNumber, Min, Max, MaxLength, IsIn, IsDefined, Matches, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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

export class ImageCropDto {
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0) @Max(1) x!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0) @Max(1) y!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0.01) @Max(1) width!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0.01) @Max(1) height!: number;
  @ApiPropertyOptional({ enum: [0, 90, 180, 270] }) @IsIn([0, 90, 180, 270]) @IsOptional() rotation?: number;
}

export class CreateMenuImageUploadDto {
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: string;

  @ApiProperty({ minimum: 1, maximum: 10485760 }) @IsInt() @Min(1) @Max(10 * 1024 * 1024) sizeBytes!: number;
  @ApiProperty({ description: 'Lowercase SHA-256 hex digest' }) @Matches(/^[a-f0-9]{64}$/) sha256!: string;
  @ApiProperty() @IsDefined() @ValidateNested() @Type(() => ImageCropDto) crop!: ImageCropDto;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class FinalizeMenuImageDto {
  @ApiProperty() @IsString() mediaObjectId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class RemoveMenuImageDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
