import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsBoolean, IsArray, ArrayNotEmpty, ArrayUnique, Min, Max, Length, IsIn } from 'class-validator';

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
  @Type(() => Number)
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

// ─── Expo Workflow ─────────────────────

export class ExpoOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Filter by updated-after timestamp' })
  @IsOptional()
  @IsString()
  updatedAfter?: string;

  @ApiPropertyOptional({ description: 'Max results', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination cursor' })
  @IsOptional()
  @IsString()
  after?: string;
}

export class CollectOrderDto {
  @ApiProperty({ description: 'Expected order version for optimistic concurrency' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ReleaseExpoDto {
  @ApiProperty({ description: 'Expected order version for optimistic concurrency' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RecallExpoDto {
  @ApiProperty({ description: 'Reason for recalling from expo' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 500)
  reason!: string;

  @ApiProperty({ description: 'Expected order version for optimistic concurrency' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

// ─── Waiter Fulfillment ───────────────

export class AssignWaiterDto {
  @ApiProperty({ description: 'User ID of the waiter to assign' })
  @IsString()
  @IsNotEmpty()
  waiterUserId!: string;
}

export class ClaimOrderDto {
  @ApiPropertyOptional({ description: 'Idempotency key for retryable claims' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ServeOrderDto {
  @ApiProperty({ description: 'Expected order version for optimistic concurrency' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ description: 'Optional reason for serve' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}

export class ServeLinesDto {
  @ApiProperty({ description: 'Ticket line IDs to mark as served', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  lineIds!: string[];

  @ApiProperty({ description: 'Expected order version for optimistic concurrency' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ServiceBoardQueryDto {
  @ApiPropertyOptional({ description: 'Scope: mine, unassigned, or all', default: 'mine', enum: ['mine', 'unassigned', 'all'] })
  @IsOptional()
  @IsString()
  @IsIn(['mine', 'unassigned', 'all'], { message: 'scope must be mine, unassigned, or all' })
  scope?: string;

  @ApiPropertyOptional({ description: 'Filter by fulfillment status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by updated-after timestamp' })
  @IsOptional()
  @IsString()
  updatedAfter?: string;

  @ApiPropertyOptional({ description: 'Max results (default 50, max 100)', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination cursor (order ID)' })
  @IsOptional()
  @IsString()
  after?: string;
}

// ─── KDS Device Management ─────────────

export class RegisterKdsDeviceDto {
  @ApiProperty({ description: 'Device display name', example: 'KDS Screen 1' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;
}

export class UpdateKdsDeviceDto {
  @ApiPropertyOptional({ description: 'Device display name' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AssignStationToDeviceDto {
  @ApiProperty({ description: 'Kitchen station ID to assign' })
  @IsString()
  @IsNotEmpty()
  stationId!: string;

  @ApiPropertyOptional({ description: 'Display order for this station on the device', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
