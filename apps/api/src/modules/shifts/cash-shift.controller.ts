import { Controller, Get, Post, Body, Param, Req, HttpCode, HttpStatus, Inject, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString, IsInt, Min, MaxLength, IsOptional, MinLength, registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Roles } from '../auth/types';
import type { TenantContext } from '../auth/types';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TenantRole } from '@rms/contracts';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RolesGuard } from '../auth/roles.guard';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CashShiftService } from './cash-shift.service';

/**
 * Custom validator: string must be a non-negative decimal integer string.
 * Allows "0", "12345", but rejects "-1", "1.5", "1e3", "", " 123 ".
 * Max length 16 digits (max safe minor units for ~9 quadrillion, exceeds Number.MAX_SAFE_INTEGER).
 */
function IsMinorUnitString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMinorUnitString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') return false;
          // Must be non-empty, digits only, no leading/trailing spaces
          if (!/^\d{1,16}$/.test(value)) return false;
          // Reject leading zeros (except "0" itself)
          if (value.length > 1 && value.startsWith('0')) return false;
          return true;
        },
        defaultMessage() {
          return `${propertyName} must be a non-negative integer string (max 16 digits, no decimals, exponents, signs, or leading zeros)`;
        },
      },
    });
  };
}

class OpenShiftDto {
  @ApiProperty({ description: 'Opening cash amount in minor units as a decimal string (e.g. "10000")' })
  @IsString()
  @IsMinorUnitString()
  openingCashMinor!: string;
}

class CloseShiftDto {
  @ApiProperty({ description: 'Counted cash amount in minor units as a decimal string (e.g. "15000")' })
  @IsString()
  @IsMinorUnitString()
  countedCashMinor!: string;

  @ApiPropertyOptional({ description: 'Reason for non-zero variance (required if variance != 0)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  varianceReason?: string;

  @ApiProperty({ description: 'Expected version for optimistic locking' })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

@ApiTags('Cash Shifts')
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashShiftController {
  constructor(@Inject(CashShiftService) private readonly shiftService: CashShiftService) {}

  @Post('branches/:branchId/shifts/open')
  @HttpCode(HttpStatus.CREATED)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Open a new cash shift' })
  async openShift(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() dto: OpenShiftDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    let openingCashMinor: bigint;
    if (typeof dto.openingCashMinor !== 'string' || !/^\d{1,16}$/.test(dto.openingCashMinor) || (dto.openingCashMinor.length > 1 && dto.openingCashMinor.startsWith('0'))) {
      throw new BadRequestException('openingCashMinor must be a non-negative integer string (max 16 digits)');
    }
    openingCashMinor = BigInt(dto.openingCashMinor);
    return {
      data: await this.shiftService.openShift({
        tenantId: ctx.tenantId!,
        branchId,
        cashierUserId: ctx.userId,
        openingCashMinor,
        actorUserId: ctx.userId,
      }),
    };
  }

  @Get('branches/:branchId/shifts/current')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Get current active shift for authenticated cashier' })
  async getCurrentShift(
    @Req() req: Request,
    @Param('branchId') branchId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const shift = await this.shiftService.getCurrentShift({
      tenantId: ctx.tenantId!,
      branchId,
      cashierUserId: ctx.userId,
    });
    return { data: shift };
  }

  @Post('branches/:branchId/shifts/:shiftId/close')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Close a cash shift (creates immutable report)' })
  async closeShift(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('shiftId') shiftId: string,
    @Body() dto: CloseShiftDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    let countedCashMinor: bigint;
    if (typeof dto.countedCashMinor !== 'string' || !/^\d{1,16}$/.test(dto.countedCashMinor) || (dto.countedCashMinor.length > 1 && dto.countedCashMinor.startsWith('0'))) {
      throw new BadRequestException('countedCashMinor must be a non-negative integer string (max 16 digits)');
    }
    countedCashMinor = BigInt(dto.countedCashMinor);
    const result = await this.shiftService.closeShift({
      tenantId: ctx.tenantId!,
      branchId,
      shiftId,
      countedCashMinor,
      varianceReason: dto.varianceReason,
      expectedVersion: dto.expectedVersion,
      actorUserId: ctx.userId,
    });
    return result;
  }

  @Get('branches/:branchId/shifts/:shiftId/report')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Get immutable shift report' })
  async getReport(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('shiftId') shiftId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const report = await this.shiftService.getReport({
      tenantId: ctx.tenantId!,
      branchId,
      cashShiftId: shiftId,
    });
    return { data: report };
  }

  @Get('branches/:branchId/shifts/reports')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'List shift reports for a branch' })
  async listReports(
    @Req() req: Request,
    @Param('branchId') branchId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const reports = await this.shiftService.listReports({
      tenantId: ctx.tenantId!,
      branchId,
    });
    return { data: reports };
  }
}
