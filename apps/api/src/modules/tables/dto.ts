import { IsString, IsOptional, IsInt, Min, MaxLength, IsBoolean } from 'class-validator';
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
