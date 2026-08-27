import {
  Controller,
  Post,
  Body,
  Inject,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PaymentService } from './payments.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PaymentInstructionService } from './payment-instruction.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CreateManualTransferDto,
  ProofUploadIntentDto,
  ProofFinalizeDto,
} from './dto';
import * as crypto from 'crypto';

@ApiTags('Public Payments')
@Controller('public')
export class PublicPaymentsController {
  constructor(
    @Inject(PaymentService) private readonly paymentService: PaymentService,
    @Inject(PaymentInstructionService) private readonly instructionService: PaymentInstructionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('payment-options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get branch payment instructions and payable balance' })
  async getPaymentOptions(@Body() body: { trackingToken: string }) {
    const tokenHash = crypto.createHash('sha256').update(body.trackingToken).digest('hex');
    const order = await this.prisma.order.findFirst({
      where: { trackingTokenHash: tokenHash },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        totalMinor: true,
        currency: true,
        status: true,
        customerName: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const instructions = await this.instructionService.getActiveInstructions(
      order.tenantId,
      order.branchId,
    );

    return {
      data: {
        orderId: order.id,
        totalMinor: order.totalMinor.toString(),
        currency: order.currency,
        status: order.status,
        instructions: instructions.map((i) => ({
          id: i.id,
          method: i.method,
          label: i.label,
          accountHolder: i.accountHolder,
          accountIdentifier: i.accountIdentifier,
          instructions: i.instructions,
        })),
      },
    };
  }

  @Post('payments/manual-transfer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a manual-transfer payment record' })
  async createManualTransfer(@Body() body: CreateManualTransferDto) {
    if (!body.trackingToken || typeof body.trackingToken !== 'string') {
      throw new NotFoundException('Order not found');
    }
    if (!body.idempotencyKey || typeof body.idempotencyKey !== 'string') {
      throw new BadRequestException('idempotencyKey is required');
    }

    const tokenHash = crypto.createHash('sha256').update(body.trackingToken).digest('hex');
    const order = await this.prisma.order.findFirst({
      where: { trackingTokenHash: tokenHash },
      select: { id: true, tenantId: true, branchId: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const result = await this.paymentService.createManualTransfer({
      tenantId: order.tenantId,
      branchId: order.branchId,
      orderId: order.id,
      idempotencyKey: body.idempotencyKey,
      customerReference: body.customerReference,
      method: body.method,
    });

    return result;
  }

  @Post('payments/proof-upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get presigned upload URL for payment proof' })
  async initiateProofUpload(@Body() body: ProofUploadIntentDto) {
    if (!body.paymentToken || typeof body.paymentToken !== 'string') {
      throw new BadRequestException('paymentToken is required');
    }
    if (!body.contentType || !/^image\/(jpeg|png|webp)$/.test(body.contentType)) {
      throw new BadRequestException('contentType must be image/jpeg, image/png, or image/webp');
    }
    if (!body.sizeBytes || typeof body.sizeBytes !== 'number' || body.sizeBytes <= 0 || body.sizeBytes > 5 * 1024 * 1024) {
      throw new BadRequestException('sizeBytes must be between 1 and 5242880');
    }
    if (!body.sha256 || typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256)) {
      throw new BadRequestException('sha256 must be a 64-character hex string');
    }

    const payment = await this.paymentService.resolvePaymentByToken(body.paymentToken);

    const { mediaObjectId, uploadUrl, objectKey, fields } =
      await this.paymentService.createUploadIntent({
        tenantId: payment.tenantId,
        branchId: payment.branchId,
        paymentTokenRaw: body.paymentToken,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      });

    return {
      data: {
        mediaObjectId,
        uploadUrl,
        objectKey,
        fields,
        expiresIn: 300,
      },
    };
  }

  @Post('payments/proof-finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalize proof upload and submit for review' })
  async finalizeProof(@Body() body: ProofFinalizeDto) {
    const payment = await this.paymentService.resolvePaymentByToken(body.paymentToken);

    // Finalize uses the stored checksum from the upload intent
    const result = await this.paymentService.finalizeProof({
      tenantId: payment.tenantId,
      branchId: payment.branchId,
      paymentTokenRaw: body.paymentToken,
      mediaObjectId: body.mediaObjectId,
      customerReference: body.customerReference,
    });

    return { data: result };
  }
}
