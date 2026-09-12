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

// ─── Kitchen CRUD ─────────────────────

export class CreateKitchenDto {
  @ApiProperty({ description: 'Kitchen name (e.g., Main Kitchen, Bar, Pastry)', example: 'Main Kitchen' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ description: 'Kitchen description' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({ description: 'Collection label shown on receipts', example: 'Pass window' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  collectionLabel?: string;

  @ApiPropertyOptional({ description: 'Display order (lower = first)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}

export class UpdateKitchenDto {
  @ApiPropertyOptional({ description: 'Kitchen name' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ description: 'Kitchen description' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({ description: 'Collection label' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  collectionLabel?: string;

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

// ─── Route CRUD ──────────────────────

export class CreateRouteDto {
  @ApiProperty({ description: 'Menu item ID' })
  @IsString()
  @IsNotEmpty()
  menuItemId!: string;

  @ApiProperty({ description: 'Station ID' })
  @IsString()
  @IsNotEmpty()
  stationId!: string;

  @ApiPropertyOptional({ description: 'Route type', default: 'PREPARE', enum: ['PREPARE', 'ASSEMBLE'] })
  @IsOptional()
  @IsString()
  @IsIn(['PREPARE', 'ASSEMBLE'], { message: 'routeType must be PREPARE or ASSEMBLE' })
  routeType?: string;

  @ApiPropertyOptional({ description: 'Whether this route is required', default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Sort order (lower = first)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class RouteItemDto {
  @ApiProperty({ description: 'Station ID' })
  @IsString()
  @IsNotEmpty()
  stationId!: string;

  @ApiPropertyOptional({ description: 'Route type', default: 'PREPARE', enum: ['PREPARE', 'ASSEMBLE'] })
  @IsOptional()
  @IsString()
  @IsIn(['PREPARE', 'ASSEMBLE'])
  routeType?: string;

  @ApiPropertyOptional({ description: 'Whether this route is required', default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Sort order', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ReplaceRoutesDto {
  @ApiProperty({ description: 'New routes for this menu item (replaces all existing)', type: [RouteItemDto] })
  @IsNotEmpty()
  routes!: RouteItemDto[];
}

// ─── Fulfillment Policy ─────────────

export class UpsertFulfillmentPolicyDto {
  @ApiPropertyOptional({ description: 'Service mode', enum: ['ALL_AT_ONCE', 'PARTIAL_ALLOWED'], default: 'ALL_AT_ONCE' })
  @IsOptional()
  @IsString()
  @IsIn(['ALL_AT_ONCE', 'PARTIAL_ALLOWED'], { message: 'serviceMode must be ALL_AT_ONCE or PARTIAL_ALLOWED' })
  serviceMode?: string;

  @ApiPropertyOptional({ description: 'Expo mode', enum: ['NONE', 'OPTIONAL', 'REQUIRED'], default: 'NONE' })
  @IsOptional()
  @IsString()
  @IsIn(['NONE', 'OPTIONAL', 'REQUIRED'], { message: 'expoMode must be NONE, OPTIONAL, or REQUIRED' })
  expoMode?: string;

  @ApiPropertyOptional({ description: 'Allow waiters to self-claim orders', default: false })
  @IsOptional()
  @IsBoolean()
  allowWaiterSelfClaim?: boolean;

  @ApiPropertyOptional({ description: 'Show unassigned ready orders to waiters', default: false })
  @IsOptional()
  @IsBoolean()
  showUnassignedReadyOrdersToWaiters?: boolean;

  @ApiPropertyOptional({ description: 'Ready reminder interval in seconds (0 = disabled)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  readyReminderSeconds?: number;

  @ApiPropertyOptional({ description: 'Ready escalation interval in seconds (0 = disabled)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  readyEscalationSeconds?: number;

  @ApiPropertyOptional({ description: 'Auto-complete kitchen ticket when order is collected', default: false })
  @IsOptional()
  @IsBoolean()
  autoCompleteKitchenTicketOnCollected?: boolean;
}
