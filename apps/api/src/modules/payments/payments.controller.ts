import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PaymentService } from './payments.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PaymentInstructionService } from './payment-instruction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { BranchScopeGuard } from '../auth/branch-scope.guard';
import { Roles, BranchScoped, type TenantContext } from '../auth/types';
import { TenantRole } from '@rms/contracts';
import {
  PaymentReviewQueryDto,
  CreatePaymentInstructionDto,
  UpdatePaymentInstructionDto,
  ApprovePaymentDto,
  RejectPaymentDto,
  StaffManualTransferDto,
} from './dto';

@ApiTags('Payments')
@ApiCookieAuth()
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Controller('branches/:branchId')
@BranchScoped()
export class PaymentsController {
  constructor(
    @Inject(PaymentService) private readonly paymentService: PaymentService,
    @Inject(PaymentInstructionService) private readonly instructionService: PaymentInstructionService,
  ) {}

  // ─── Payment Instructions (OWNER/MANAGER only) ────────────

  @Get('payment-instructions')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'List branch payment instructions' })
  async getInstructions(@Req() req: Request, @Param('branchId') branchId: string) {
    const ctx = req.tenantContext as TenantContext;
    const instructions = await this.instructionService.getInstructions(ctx.tenantId!, branchId);
    return { data: instructions };
  }

  @Post('payment-instructions')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Create a payment instruction' })
  async createInstruction(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() dto: CreatePaymentInstructionDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const instruction = await this.instructionService.createInstruction({
      tenantId: ctx.tenantId!,
      branchId,
      actorUserId: ctx.userId,
      ...dto,
    });

    return { data: instruction };
  }

  @Patch('payment-instructions/:instructionId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Update a payment instruction' })
  async updateInstruction(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('instructionId') instructionId: string,
    @Body() dto: UpdatePaymentInstructionDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const instruction = await this.instructionService.updateInstruction(
      ctx.tenantId!,
      branchId,
      instructionId,
      dto,
      ctx.userId,
    );

    return { data: instruction };
  }

  @Delete('payment-instructions/:instructionId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER)
  @ApiOperation({ summary: 'Delete a payment instruction' })
  async deleteInstruction(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('instructionId') instructionId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    await this.instructionService.deleteInstruction(
      ctx.tenantId!,
      branchId,
      instructionId,
      ctx.userId,
    );

    return { data: { deleted: true } };
  }

  // ─── Payment Review Queue ────────────────

  @Get('payments')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Cashier review queue' })
  async getReviewQueue(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Query() query: PaymentReviewQueryDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const payments = await this.paymentService.getReviewQueue({
      tenantId: ctx.tenantId!,
      branchId,
      status: query.status,
      limit: query.limit,
      after: query.after,
    });
    return { data: payments };
  }

  @Get('payments/:paymentId')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Get payment details' })
  async getPaymentDetails(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('paymentId') paymentId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const payment = await this.paymentService.getPaymentDetails(ctx.tenantId!, branchId, paymentId);
    return { data: payment };
  }

  @Get('payments/:paymentId/proof-url')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Get signed URL for payment proof (CLEAN only)' })
  async getProofUrl(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('paymentId') paymentId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.paymentService.getProofAccessUrl(ctx.tenantId!, branchId, paymentId);
    return { data: result };
  }

  // ─── Cash Payment ────────────────

  @Post('payments/cash')
  @HttpCode(HttpStatus.CREATED)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Record cash payment for an order' })
  async createCashPayment(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() body: StaffManualTransferDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.paymentService.createCashPayment({
      tenantId: ctx.tenantId!,
      branchId,
      orderId: body.orderId,
      idempotencyKey: body.idempotencyKey,
      actorUserId: ctx.userId,
    });
    return result;
  }

  @Post('payments/:paymentId/confirm-cash')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Confirm cash payment and approve order' })
  async confirmCashPayment(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('paymentId') paymentId: string,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const payment = await this.paymentService.confirmCashPayment({
      tenantId: ctx.tenantId!,
      branchId,
      paymentId,
      actorUserId: ctx.userId,
    });
    return { data: payment };
  }

  // ─── Payment Approval / Rejection ────────────────

  @Post('payments/manual-transfer')
  @HttpCode(HttpStatus.CREATED)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Create a manual-transfer payment for a POS order (staff)' })
  async staffCreateManualTransfer(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Body() dto: StaffManualTransferDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const result = await this.paymentService.createManualTransfer({
      tenantId: ctx.tenantId!,
      branchId,
      orderId: dto.orderId,
      idempotencyKey: dto.idempotencyKey,
      customerReference: dto.staffReference,
    });
    return result;
  }

  @Post('payments/:paymentId/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Approve a payment (cashier/manager/owner)' })
  async approvePayment(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: ApprovePaymentDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const payment = await this.paymentService.approvePayment({
      tenantId: ctx.tenantId!,
      branchId,
      paymentId,
      actorUserId: ctx.userId,
      reviewNote: dto.reviewNote,
    });
    return { data: payment };
  }

  @Post('payments/:paymentId/reject')
  @Roles(TenantRole.OWNER, TenantRole.MANAGER, TenantRole.CASHIER)
  @ApiOperation({ summary: 'Reject a payment (cashier/manager/owner)' })
  async rejectPayment(
    @Req() req: Request,
    @Param('branchId') branchId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: RejectPaymentDto,
  ) {
    const ctx = req.tenantContext as TenantContext;
    const payment = await this.paymentService.rejectPayment({
      tenantId: ctx.tenantId!,
      branchId,
      paymentId,
      actorUserId: ctx.userId,
      reason: dto.reason,
    });
    return { data: payment };
  }
}
