import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsBoolean, Min, Max, Length, IsIn } from 'class-validator';

// ─── Kitchen Stations ──────────────────────

export class CreateStationDto {
  @ApiProperty({ description: 'Station name (e.g., Grill, Cold Kitchen, Bar)', example: 'Grill' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ description: 'Display order (lower = first)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateStationDto {
  @ApiPropertyOptional({ description: 'Station name' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ description: 'Display order' })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Station ↔ Menu Item Mapping ───────────

export class AssignMenuItemToStationDto {
  @ApiProperty({ description: 'Menu item ID to assign to this station' })
  @IsString()
  @IsNotEmpty()
  menuItemId!: string;
}

// ─── Kitchen Tickets ────────────────────────

export class TicketQueryDto {
  @ApiPropertyOptional({ description: 'Filter by station ID' })
  @IsOptional()
  @IsString()
  stationId?: string;

  @ApiPropertyOptional({ description: 'Filter by ticket status', default: 'QUEUED' })
  @IsOptional()
  @IsString()
  @IsIn(['QUEUED', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED'], {
    message: 'status must be one of: QUEUED, IN_PROGRESS, READY, COMPLETED, CANCELLED',
  })
  status?: string;

  @ApiPropertyOptional({ description: 'Max results (default 50, max 100)', default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination cursor (ticket ID)' })
  @IsOptional()
  @IsString()
  after?: string;
}

export class BumpTicketDto {
  @ApiPropertyOptional({ description: 'Reason or note for the bump' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;

  @ApiProperty({ description: 'Expected version for optimistic concurrency' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RecallTicketDto {
  @ApiProperty({ description: 'Reason for recall' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 500)
  reason!: string;

  @ApiProperty({ description: 'Expected version for optimistic concurrency' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
