import { IsString, IsOptional, IsInt, Min, MaxLength, IsBoolean, IsArray, ArrayNotEmpty, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDiningAreaDto {
  @ApiProperty({ example: 'Ground Floor' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 5 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateDiningAreaDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class CreateTableDto {
  @ApiProperty({ example: 'T1' })
  @IsString()
  @MaxLength(50)
  label!: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  capacity!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  diningAreaId?: string;
}

export class UpdateTableDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(50)
  @IsOptional()
  label?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(1)
  @IsOptional()
  capacity?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  diningAreaId?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class RotateQrTokenDto {
  @ApiPropertyOptional({ example: 'Reprint requested' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class RotateQrTokensBatchDto {
  @ApiProperty({
    description: 'Table ids to rotate in one transaction. Fresh plaintext tokens are issued for every selected table.',
    type: [String],
    example: ['3f1d2a4e-0000-4000-8000-000000000001'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tableIds!: string[];

  @ApiPropertyOptional({ example: 'Batch reprint for tabletop cards' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class ClearSessionDto {
  @ApiProperty({ description: 'Expected version for optimistic locking' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ example: 'Guests have left' })
  @IsString()
  @IsOptional()
  clearReason?: string;
}

export class CompleteOrderDto {
  @ApiPropertyOptional({ example: 'Served to table' })
  @IsString()
  @IsOptional()
  notes?: string;
}
