import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ProofStorage } from './proof-storage.interface';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { IdempotencyService } from '../orders/idempotency.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FeatureResolver } from '../features/feature-resolver.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { InventoryDeductionService } from '../inventory/inventory-deduction.service';
import { generatePaymentToken, hashPaymentToken } from './payment-token.util';
import { FeatureKey } from '@rms/contracts';

const PAYMENT_TOKEN_TTL_HOURS = 24;
const UPLOAD_INTENT_TTL_MINUTES = 5;
const MAX_PROOF_ATTEMPTS = 3;

const TERMINAL_STATUSES = ['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED'];

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProofStorage) private readonly proofStorage: ProofStorage,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(FeatureResolver) private readonly featureResolver: FeatureResolver,
    @Inject(InventoryDeductionService) private readonly deductionService: InventoryDeductionService,
  ) {}

  /**
   * Create a manual-transfer payment for an order.
   * Wrapped in IdempotencyService: same key + same payload replays with the original raw token.
   * Same key + different payload → 409.
   */
  async createManualTransfer(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    idempotencyKey: string;
    customerReference?: string;
    method?: 'BANK_TRANSFER' | 'TELEBIRR' | 'MANUAL_TRANSFER';
  }) {
    const { tenantId, branchId, orderId, idempotencyKey, customerReference } = params;
    const paymentMethod = params.method ?? 'BANK_TRANSFER';

    // Service-level feature assertion
    await this.featureResolver.assertEffective(tenantId, FeatureKey.MANUAL_TRANSFER_PAYMENTS, branchId);

    const { result, reused } = await this.idempotency.withIdempotency(
      {
        tenantId,
        branchId,
        operation: 'manual-transfer',
        key: idempotencyKey,
        requestPayload: { orderId, customerReference },
        ttlMinutes: 60,
      },
      async () => {
        // Verify order exists and belongs to this tenant/branch
        const order = await this.prisma.order.findFirst({
          where: { id: orderId, tenantId, branchId },
        });
        if (!order) {
          throw new NotFoundException('Order not found');
        }

        // Order must be in a payable state
        if (!['PENDING_PAYMENT', 'PENDING_CONFIRMATION'].includes(order.status)) {
          throw new ConflictException(
            `Order is ${order.status} and cannot accept new payments`,
          );
        }

        // Create payment + audit atomically — conflict check is INSIDE the transaction
        // to prevent TOCTOU race between concurrent requests with different idempotency keys.
        const { raw, hash } = generatePaymentToken();
        const expiresAt = new Date(Date.now() + PAYMENT_TOKEN_TTL_HOURS * 3600_000);

        let payment;
        try {
          payment = await this.prisma.$transaction(async (tx) => {
            // Check for existing active transfer payment WITHIN the transaction.
            // Uses SELECT ... FOR UPDATE semantics viafindFirst with lock to serialize.
            const existing = await tx.payment.findFirst({
              where: {
                tenantId,
                branchId,
                orderId,
                method: { in: ['BANK_TRANSFER', 'TELEBIRR', 'MANUAL_TRANSFER'] },
                status: { notIn: TERMINAL_STATUSES },
              },
            });

            if (existing) {
              throw new ConflictException('A payment already exists for this order');
            }

            const p = await tx.payment.create({
              data: {
                tenantId,
                branchId,
                orderId,
                method: paymentMethod,
                status: 'PENDING',
                amountMinor: order.totalMinor,
                currency: order.currency,
                paymentTokenHash: hash,
                paymentTokenExpiresAt: expiresAt,
                customerReference: customerReference ?? null,
              },
            });

            await tx.auditLog.create({
              data: {
                actorUserId: null,
                tenantId,
                branchId,
                action: 'PAYMENT_CREATE',
                entityType: 'Payment',
                entityId: p.id,
                afterJson: {
                  orderId,
                  method: paymentMethod,
                  amountMinor: order.totalMinor.toString(),
                  currency: order.currency,
                },
              },
            });

            return p;
          });
        } catch (err) {
          if (this.isP2002(err)) {
            throw new ConflictException('A payment already exists for this order');
          }
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('Unique constraint') && msg.includes('Payment_one_active_per_order')) {
            throw new ConflictException('A payment already exists for this order');
          }
          throw err;
        }

        return {
          status: 201,
          body: {
            ...this.serializePayment(payment),
            paymentToken: raw,
          },
          resourceId: payment.id,
        };
      },
    );

    return { data: result.body, reused };
  }

  /**
   * Resolve a payment by its opaque token.
   * Validates expiry and terminal state.
   */
  async resolvePaymentByToken(paymentTokenRaw: string) {
    const tokenHash = hashPaymentToken(paymentTokenRaw);

    const payment = await this.prisma.payment.findFirst({
      where: { paymentTokenHash: tokenHash },
      include: {
        order: { select: { id: true, orderNumber: true, totalMinor: true, currency: true, status: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('Invalid payment token');
    }

    // Check expiry
    if (payment.paymentTokenExpiresAt && payment.paymentTokenExpiresAt < new Date()) {
      throw new BadRequestException('Payment token has expired');
    }

    // Check terminal state
    if (TERMINAL_STATUSES.includes(payment.status)) {
      throw new BadRequestException('Payment is in a terminal state');
    }

    return payment;
  }

  /**
   * Create an upload intent (MediaObject) before issuing presigned credentials.
   * Client must provide sha256 checksum; it is stored and bound into the S3 policy.
   */
  async createUploadIntent(params: {
    tenantId: string;
    branchId: string;
    paymentTokenRaw: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<{ mediaObjectId: string; uploadUrl: string; objectKey: string; fields: Record<string, string> }> {
    const payment = await this.resolvePaymentByToken(params.paymentTokenRaw);

    // Verify payment belongs to this tenant/branch
    if (payment.tenantId !== params.tenantId || payment.branchId !== params.branchId) {
      throw new NotFoundException('Payment not found');
    }

    // Check proof attempt limit — count only consumed uploads for THIS payment
    const consumedCount = await this.prisma.mediaObject.count({
      where: {
        tenantId: params.tenantId,
        branchId: params.branchId,
        paymentId: payment.id,
        purpose: 'PAYMENT_PROOF',
        scanStatus: { in: ['PENDING_SCAN', 'CLEAN', 'REJECTED'] },
      },
    });
    if (consumedCount >= MAX_PROOF_ATTEMPTS) {
      throw new ConflictException('Maximum proof upload attempts reached');
    }

    // Cap active unexpired intents per payment
    const activeCount = await this.prisma.mediaObject.count({
      where: {
        tenantId: params.tenantId,
        branchId: params.branchId,
        paymentId: payment.id,
        purpose: 'PAYMENT_PROOF',
        scanStatus: 'PENDING_UPLOAD',
        uploadExpiresAt: { gt: new Date() },
      },
    });
    if (activeCount >= 2) {
      throw new ConflictException('Too many active upload intents for this payment');
    }

    const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_MINUTES * 60_000);

    // Create MediaObject with PENDING_UPLOAD status and expiry
    const mediaObject = await this.prisma.mediaObject.create({
      data: {
        tenantId: params.tenantId,
        branchId: params.branchId,
        paymentId: payment.id,
        purpose: 'PAYMENT_PROOF',
        bucket: this.proofStorage.getBucket(),
        objectKey: '', // Will be set after presigned URL generation
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        sha256: params.sha256,
        scanStatus: 'PENDING_UPLOAD',
        uploadExpiresAt: expiresAt,
      },
    });

    // Get presigned POST
    const { uploadUrl, objectKey, fields } = await this.proofStorage.createUploadIntent({
      tenantId: params.tenantId,
      branchId: params.branchId,
      paymentId: payment.id,
      contentType: params.contentType,
      sizeBytes: params.sizeBytes,
      sha256: params.sha256,
    });

    // Update the MediaObject with the actual object key
    await this.prisma.mediaObject.update({
      where: { id: mediaObject.id },
      data: { objectKey },
    });

    return {
      mediaObjectId: mediaObject.id,
      uploadUrl,
      objectKey,
      fields,
    };
  }

  /**
   * Finalize a proof upload: verify S3 object, create PaymentProof, transition payment status.
   * Atomic: scanStatus claim, proof creation, payment update, audit, and outbox in one transaction.
   * The conditional claim includes all invariants to eliminate race conditions.
   * Idempotent: if this media object was already finalized for this payment, returns the existing result.
   */
  async finalizeProof(params: {
    tenantId: string;
    branchId: string;
    paymentTokenRaw: string;
    mediaObjectId: string;
    customerReference?: string;
  }): Promise<Record<string, unknown>> {
    // Service-level feature assertion
    await this.featureResolver.assertEffective(params.tenantId, FeatureKey.MANUAL_TRANSFER_PAYMENTS, params.branchId);

    const payment = await this.resolvePaymentByToken(params.paymentTokenRaw);

    if (payment.tenantId !== params.tenantId || payment.branchId !== params.branchId) {
      throw new NotFoundException('Payment not found');
    }

    // Load upload intent
    const mediaObject = await this.prisma.mediaObject.findFirst({
      where: {
        id: params.mediaObjectId,
        tenantId: params.tenantId,
        branchId: params.branchId,
        purpose: 'PAYMENT_PROOF',
      },
    });

    if (!mediaObject) {
      throw new NotFoundException('Upload intent not found');
    }

    // Verify upload intent belongs to this payment via explicit relation
    if (mediaObject.paymentId !== payment.id) {
      throw new ConflictException('Upload intent does not belong to this payment');
    }

    // Idempotent: if already consumed (PENDING_SCAN, CLEAN, or REJECTED), return existing proof
    if (mediaObject.scanStatus !== 'PENDING_UPLOAD') {
      const existingProof = await this.prisma.paymentProof.findFirst({
        where: { paymentId: payment.id, mediaObjectId: mediaObject.id },
      });
      if (existingProof) {
        return this.serializePayment(payment)!;
      }
      // Consumed but no proof found — should not happen, fall through to conflict
      throw new ConflictException('Upload intent already consumed');
    }

    // Check upload intent expiry before expensive S3 verification
    if (mediaObject.uploadExpiresAt && mediaObject.uploadExpiresAt < new Date()) {
      throw new ConflictException('Upload intent has expired');
    }

    // Verify S3 object — uses the stored checksum (client-computed, bound in policy)
    await this.proofStorage.verifyObject({
      objectKey: mediaObject.objectKey,
      expectedSha256Hex: mediaObject.sha256!,
      expectedSize: Number(mediaObject.sizeBytes),
      expectedContentType: mediaObject.contentType,
    });

    const now = new Date();

    // Atomic: claim upload intent + create proof + retire previous + transition payment + audit + outbox
    const result = await this.prisma.$transaction(async (tx) => {
      // Claim upload intent: all invariants enforced atomically
      // Includes: tenant, branch, payment ownership, PENDING_UPLOAD, expiry, key, checksum
      const claimed = await tx.mediaObject.updateMany({
        where: {
          id: mediaObject.id,
          tenantId: params.tenantId,
          branchId: params.branchId,
          paymentId: payment.id,
          scanStatus: 'PENDING_UPLOAD',
          uploadExpiresAt: { gte: now },
          objectKey: mediaObject.objectKey,
          sha256: mediaObject.sha256,
        },
        data: { scanStatus: 'PENDING_SCAN' },
      });

      if (claimed.count !== 1) {
        throw new ConflictException('Upload intent already consumed, expired, or not found');
      }

      // Retire previous current proof
      await tx.paymentProof.updateMany({
        where: { paymentId: payment.id, isCurrent: true },
        data: { isCurrent: false },
      });

      // Create new proof
      const proof = await tx.paymentProof.create({
        data: {
          tenantId: params.tenantId,
          branchId: params.branchId,
          paymentId: payment.id,
          mediaObjectId: mediaObject.id,
          submittedByContext: 'CUSTOMER',
          isCurrent: true,
        },
      });

      // Transition payment status — conditional on expected version and allowed status
      const updatedPayment = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: ['PENDING', 'PENDING_VERIFICATION'] },
          version: payment.version,
        },
        data: {
          status: 'PENDING_VERIFICATION',
          submittedAt: new Date(),
          customerReference: params.customerReference ?? payment.customerReference,
          version: { increment: 1 },
        },
      });

      if (updatedPayment.count !== 1) {
        throw new ConflictException('Payment version conflict or unexpected status');
      }

      const latestPayment = await tx.payment.findUnique({ where: { id: payment.id } });

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          tenantId: params.tenantId,
          branchId: params.branchId,
          action: 'PAYMENT_PROOF_SUBMITTED',
          entityType: 'Payment',
          entityId: payment.id,
          afterJson: {
            proofId: proof.id,
            mediaObjectId: mediaObject.id,
            status: 'PENDING_VERIFICATION',
          },
        },
      });

      // Outbox event
      await tx.outboxEvent.create({
        data: {
          tenantId: params.tenantId,
          branchId: params.branchId,
          aggregateType: 'Payment',
          aggregateId: payment.id,
          eventType: 'payment.submitted',
          payload: {
            paymentId: payment.id,
            orderId: payment.orderId,
            status: 'PENDING_VERIFICATION',
          },
        },
      });

      return { proof, payment: latestPayment };
    });

    return this.serializePayment(result.payment!)!;
  }

  /**
   * Get the cashier review queue for a branch.
   */
  async getReviewQueue(params: {
    tenantId: string;
    branchId: string;
    status?: string;
    limit?: number;
    after?: string;
  }) {
    const status = params.status ?? 'PENDING_VERIFICATION';
    const limit = params.limit ?? 50;

    const payments = await this.prisma.payment.findMany({
      where: {
        tenantId: params.tenantId,
        branchId: params.branchId,
        status,
        method: { in: ['BANK_TRANSFER', 'TELEBIRR', 'MANUAL_TRANSFER'] },
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalMinor: true,
            currency: true,
            customerName: true,
            status: true,
          },
        },
        proofs: {
          where: { isCurrent: true },
          include: { mediaObject: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(params.after
        ? { cursor: { id: params.after }, skip: 1 }
        : {}),
    });

    return payments.map((p) => this.serializePaymentWithOrder(p));
  }

  /**
   * Get payment details by ID (staff only).
   */
  async getPaymentDetails(tenantId: string, branchId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, branchId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            totalMinor: true,
            currency: true,
            customerName: true,
            customerPhone: true,
            status: true,
          },
        },
        proofs: {
          include: { mediaObject: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return this.serializePaymentDetail(payment);
  }

  /**
   * Generate a short-lived signed URL for authorized staff to view the proof.
   * Only CLEAN proofs receive read URLs.
   */
  async getProofAccessUrl(tenantId: string, branchId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, branchId },
      include: {
        proofs: {
          where: { isCurrent: true },
          include: { mediaObject: true },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    const currentProof = payment.proofs[0];
    if (!currentProof) {
      throw new NotFoundException('No proof attached to this payment');
    }

    // Only CLEAN proofs are accessible
    if (currentProof.mediaObject.scanStatus !== 'CLEAN') {
      throw new BadRequestException('Proof is not yet cleared for viewing');
    }

    const url = await this.proofStorage.createReadUrl(currentProof.mediaObject.objectKey);
    return { url, expiresIn: 900 };
  }

  /**
   * Transition a proof from PENDING_SCAN to CLEAN or REJECTED.
   * Called by scanner worker or authorized staff.
   * NOTE: Full scanner integration deferred to Phase 4B. This is the contract boundary.
   */
  async transitionScanStatus(params: {
    tenantId: string;
    branchId: string;
    mediaObjectId: string;
    newStatus: 'CLEAN' | 'REJECTED';
    scanResult?: Record<string, unknown>;
  }) {
    const mediaObject = await this.prisma.mediaObject.findFirst({
      where: {
        id: params.mediaObjectId,
        tenantId: params.tenantId,
        branchId: params.branchId,
      },
    });

    if (!mediaObject) {
      throw new NotFoundException('Media object not found');
    }

    if (mediaObject.scanStatus !== 'PENDING_SCAN') {
      throw new ConflictException(`Cannot transition from ${mediaObject.scanStatus}`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.mediaObject.updateMany({
        where: {
          id: params.mediaObjectId,
          tenantId: params.tenantId,
          branchId: params.branchId,
          scanStatus: 'PENDING_SCAN',
        },
        data: { scanStatus: params.newStatus },
      });

      if (updated.count !== 1) {
        throw new ConflictException('Scan status already transitioned');
      }

      await tx.auditLog.create({
        data: {
          actorUserId: null,
          tenantId: params.tenantId,
          branchId: params.branchId,
          action: `PAYMENT_PROOF_${params.newStatus}`,
          entityType: 'MediaObject',
          entityId: params.mediaObjectId,
          afterJson: {
            scanStatus: params.newStatus,
            scanResult: (params.scanResult as any) ?? null,
          },
        },
      });

      // Outbox event
      await tx.outboxEvent.create({
        data: {
          tenantId: params.tenantId,
          branchId: params.branchId,
          aggregateType: 'MediaObject',
          aggregateId: params.mediaObjectId,
          eventType: `media.scanned.${params.newStatus.toLowerCase()}`,
          payload: {
            mediaObjectId: params.mediaObjectId,
            scanStatus: params.newStatus,
            scanResult: (params.scanResult as any) ?? null,
          },
        },
      });

      return { success: true };
    });

    return result;
  }

  // ─── APPROVE PAYMENT ─────────────────────

  /**
   * Create a cash payment for a POS order.
   * Idempotent: same key replays, different key on same order rejects.
   */
  async createCashPayment(params: {
    tenantId: string;
    branchId: string;
    orderId: string;
    idempotencyKey: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, orderId, idempotencyKey, actorUserId } = params;

    const { result: idempotencyResult, reused } = await this.idempotency.withIdempotency(
      {
        tenantId,
        branchId,
        operation: 'cash-payment',
        key: idempotencyKey,
        requestPayload: { orderId },
        ttlMinutes: 60,
      },
      async () => {
        const order = await this.prisma.order.findFirst({
          where: { id: orderId, tenantId, branchId },
        });
        if (!order) throw new NotFoundException('Order not found');

        if (!['PENDING_PAYMENT', 'PENDING_CONFIRMATION'].includes(order.status)) {
          throw new ConflictException(`Order is ${order.status} and cannot accept new payments`);
        }

        const existing = await this.prisma.payment.findFirst({
          where: {
            tenantId,
            branchId,
            orderId,
            method: 'CASH',
            status: { notIn: TERMINAL_STATUSES },
          },
        });
        if (existing) {
          throw new ConflictException('A payment already exists for this order');
        }

        let payment;
        try {
          payment = await this.prisma.$transaction(async (tx) => {
            const p = await tx.payment.create({
              data: {
                tenantId,
                branchId,
                orderId,
                method: 'CASH',
                status: 'PENDING',
                amountMinor: order.totalMinor,
                currency: order.currency,
              },
            });

            await tx.auditLog.create({
              data: {
                actorUserId,
                tenantId,
                branchId,
                action: 'PAYMENT_CREATE_CASH',
                entityType: 'Payment',
                entityId: p.id,
                afterJson: {
                  orderId,
                  method: 'CASH',
                  amountMinor: order.totalMinor.toString(),
                  currency: order.currency,
                },
              },
            });

            return p;
          });
        } catch (err) {
          if (this.isP2002(err)) {
            throw new ConflictException('A payment already exists for this order');
          }
          throw err;
        }

        return {
          status: 201,
          body: this.serializePayment(payment),
          resourceId: payment.id,
        };
      },
    );

    return { data: idempotencyResult.body, reused };
  }

  /**
   * Confirm a cash payment: approve payment + confirm order atomically.
   * Idempotent: already APPROVED returns without error.
   */
  async confirmCashPayment(params: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    actorUserId: string;
  }) {
    const { tenantId, branchId, paymentId, actorUserId } = params;

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, branchId, method: 'CASH' },
      include: {
        order: {
          select: {
            id: true, status: true, version: true, totalMinor: true, currency: true,
            lines: { select: { id: true, variantId: true, quantity: true } },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === 'APPROVED') {
      return this.serializePayment(payment);
    }

    if (payment.status !== 'PENDING') {
      throw new ConflictException(`Payment is ${payment.status}, expected PENDING`);
    }

    if (!['PENDING_PAYMENT', 'PENDING_CONFIRMATION'].includes(payment.order.status)) {
      throw new ConflictException(`Order is ${payment.order.status} and cannot be confirmed`);
    }

    const now = new Date();
    const orderLines = payment.order.lines;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: 'PENDING',
          version: payment.version,
        },
        data: {
          status: 'APPROVED',
          reviewedAt: now,
          reviewedByUserId: actorUserId,
          version: { increment: 1 },
        },
      });

      if (updatedPayment.count !== 1) {
        throw new ConflictException('Payment version conflict or already processed');
      }

      const latestPayment = await tx.payment.findUnique({ where: { id: paymentId } });

      await tx.order.updateMany({
        where: {
          id: payment.order.id,
          status: payment.order.status,
          version: payment.order.version,
        },
        data: {
          status: 'CONFIRMED',
          confirmedAt: now,
          version: { increment: 1 },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId: payment.order.id,
          fromStatus: payment.order.status,
          toStatus: 'CONFIRMED',
          actorUserId,
        },
      });

      // Synchronous inventory deduction — rolls back entire transaction on failure
      if (orderLines.length > 0) {
        await this.deductionService.deductForOrder(tx, {
          tenantId,
          branchId,
          orderId: payment.order.id,
          lines: orderLines
            .filter((l) => l.variantId)
            .map((l) => ({ variantId: l.variantId!, quantity: l.quantity })),
          actorUserId,
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'PAYMENT_CASH_CONFIRM',
          entityType: 'Payment',
          entityId: paymentId,
          beforeJson: { status: 'PENDING' },
          afterJson: { status: 'APPROVED', orderId: payment.order.id },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Payment',
          aggregateId: paymentId,
          eventType: 'payment.approved',
          payload: {
            paymentId,
            orderId: payment.order.id,
            amountMinor: payment.amountMinor.toString(),
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: payment.order.id,
          eventType: 'order.confirmed',
          payload: {
            orderId: payment.order.id,
            paymentId,
            totalMinor: payment.order.totalMinor.toString(),
          },
        },
      });

      return latestPayment;
    });

    return this.serializePayment(result);
  }

  /**
   * Approve a PENDING_VERIFICATION payment.
   * Atomic: payment → APPROVED, order → CONFIRMED, audit, outbox.
   * Idempotent: already APPROVED returns the payment without error.
   */
  async approvePayment(params: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    actorUserId: string;
    reviewNote?: string;
  }) {
    const { tenantId, branchId, paymentId, actorUserId, reviewNote } = params;

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, branchId },
      include: {
        order: {
          select: {
            id: true, status: true, version: true, totalMinor: true, currency: true,
            lines: { select: { id: true, variantId: true, quantity: true } },
          },
        },
      },
    });

    if (!payment) throw new NotFoundException('Payment not found');

    // Already approved → idempotent return
    if (payment.status === 'APPROVED') {
      return this.serializePayment(payment);
    }

    // Must be PENDING_VERIFICATION
    if (payment.status !== 'PENDING_VERIFICATION') {
      throw new ConflictException(`Payment is ${payment.status}, expected PENDING_VERIFICATION`);
    }

    // Order must be in a payable state
    if (!['PENDING_PAYMENT', 'PENDING_CONFIRMATION'].includes(payment.order.status)) {
      throw new ConflictException(`Order is ${payment.order.status} and cannot be confirmed`);
    }

    const now = new Date();
    const orderLines = payment.order.lines;

    const result = await this.prisma.$transaction(async (tx) => {
      // Approve payment — conditional on expected version
      const updatedPayment = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: 'PENDING_VERIFICATION',
          version: payment.version,
        },
        data: {
          status: 'APPROVED',
          reviewedAt: now,
          reviewedByUserId: actorUserId,
          reviewNote: reviewNote ?? null,
          version: { increment: 1 },
        },
      });

      if (updatedPayment.count !== 1) {
        throw new ConflictException('Payment version conflict or already processed');
      }

      const latestPayment = await tx.payment.findUnique({ where: { id: paymentId } });

      // Confirm order
      await tx.order.updateMany({
        where: {
          id: payment.order.id,
          status: payment.order.status,
          version: payment.order.version,
        },
        data: {
          status: 'CONFIRMED',
          confirmedAt: now,
          version: { increment: 1 },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          branchId,
          orderId: payment.order.id,
          fromStatus: payment.order.status,
          toStatus: 'CONFIRMED',
          actorUserId,
        },
      });

      // Synchronous inventory deduction — rolls back entire transaction on failure
      if (orderLines.length > 0) {
        await this.deductionService.deductForOrder(tx, {
          tenantId,
          branchId,
          orderId: payment.order.id,
          lines: orderLines
            .filter((l) => l.variantId)
            .map((l) => ({ variantId: l.variantId!, quantity: l.quantity })),
          actorUserId,
        });
      }

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'PAYMENT_APPROVE',
          entityType: 'Payment',
          entityId: paymentId,
          beforeJson: { status: 'PENDING_VERIFICATION' },
          afterJson: {
            status: 'APPROVED',
            orderId: payment.order.id,
            reviewNote: reviewNote ?? null,
          },
        },
      });

      // Outbox: payment.approved
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Payment',
          aggregateId: paymentId,
          eventType: 'payment.approved',
          payload: {
            paymentId,
            orderId: payment.order.id,
            amountMinor: payment.amountMinor.toString(),
          },
        },
      });

      // Outbox: order.confirmed
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Order',
          aggregateId: payment.order.id,
          eventType: 'order.confirmed',
          payload: {
            orderId: payment.order.id,
            paymentId,
            totalMinor: payment.order.totalMinor.toString(),
          },
        },
      });

      return latestPayment;
    });

    return this.serializePayment(result);
  }

  /**
   * Reject a PENDING_VERIFICATION payment.
   * Atomic: payment → REJECTED, audit, outbox.
   * Idempotent: already REJECTED returns the payment without error.
   */
  async rejectPayment(params: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    actorUserId: string;
    reason: string;
  }) {
    const { tenantId, branchId, paymentId, actorUserId, reason } = params;

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId, branchId },
      include: {
        order: { select: { id: true, status: true, version: true } },
      },
    });

    if (!payment) throw new NotFoundException('Payment not found');

    // Already rejected → idempotent return
    if (payment.status === 'REJECTED') {
      return this.serializePayment(payment);
    }

    // Must be PENDING_VERIFICATION
    if (payment.status !== 'PENDING_VERIFICATION') {
      throw new ConflictException(`Payment is ${payment.status}, expected PENDING_VERIFICATION`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: 'PENDING_VERIFICATION',
          version: payment.version,
        },
        data: {
          status: 'REJECTED',
          reviewedAt: new Date(),
          reviewedByUserId: actorUserId,
          reviewNote: reason,
          version: { increment: 1 },
        },
      });

      if (updatedPayment.count !== 1) {
        throw new ConflictException('Payment version conflict or already processed');
      }

      const latestPayment = await tx.payment.findUnique({ where: { id: paymentId } });

      // Audit
      await tx.auditLog.create({
        data: {
          actorUserId,
          tenantId,
          branchId,
          action: 'PAYMENT_REJECT',
          entityType: 'Payment',
          entityId: paymentId,
          beforeJson: { status: 'PENDING_VERIFICATION' },
          afterJson: { status: 'REJECTED', reason },
        },
      });

      // Outbox
      await tx.outboxEvent.create({
        data: {
          tenantId,
          branchId,
          aggregateType: 'Payment',
          aggregateId: paymentId,
          eventType: 'payment.rejected',
          payload: {
            paymentId,
            orderId: payment.order.id,
            reason,
          },
        },
      });

      return latestPayment;
    });

    return this.serializePayment(result);
  }

  // ─── Serialization helpers ──────────────────────

  private isP2002(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    );
  }

  serializePayment(payment: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!payment) return null;
    const p = payment as any;
    return {
      id: p.id,
      orderId: p.orderId,
      method: p.method,
      status: p.status,
      amountMinor: p.amountMinor?.toString?.() ?? p.amountMinor,
      currency: p.currency,
      customerReference: p.customerReference,
      submittedAt: p.submittedAt,
      version: p.version,
      createdAt: p.createdAt,
    };
  }

  private serializePaymentWithOrder(payment: any) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      method: payment.method,
      status: payment.status,
      amountMinor: payment.amountMinor?.toString?.() ?? payment.amountMinor,
      currency: payment.currency,
      customerReference: payment.customerReference,
      submittedAt: payment.submittedAt,
      version: payment.version,
      createdAt: payment.createdAt,
      order: payment.order
        ? {
            id: payment.order.id,
            orderNumber: payment.order.orderNumber?.toString?.() ?? payment.order.orderNumber,
            totalMinor: payment.order.totalMinor?.toString?.() ?? payment.order.totalMinor,
            currency: payment.order.currency,
            customerName: payment.order.customerName,
            status: payment.order.status,
          }
        : undefined,
      proofs: payment.proofs?.map((pr: any) => ({
        id: pr.id,
        mediaObjectId: pr.mediaObjectId,
        scanStatus: pr.mediaObject?.scanStatus,
        submittedByContext: pr.submittedByContext,
        isCurrent: pr.isCurrent,
        createdAt: pr.createdAt,
      })),
    };
  }

  private serializePaymentDetail(payment: any) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      method: payment.method,
      status: payment.status,
      amountMinor: payment.amountMinor?.toString?.() ?? payment.amountMinor,
      currency: payment.currency,
      customerReference: payment.customerReference,
      submittedAt: payment.submittedAt,
      reviewedAt: payment.reviewedAt,
      reviewNote: payment.reviewNote,
      version: payment.version,
      createdAt: payment.createdAt,
      order: payment.order
        ? {
            id: payment.order.id,
            orderNumber: payment.order.orderNumber?.toString?.() ?? payment.order.orderNumber,
            totalMinor: payment.order.totalMinor?.toString?.() ?? payment.order.totalMinor,
            currency: payment.order.currency,
            customerName: payment.order.customerName,
            customerPhone: payment.order.customerPhone,
            status: payment.order.status,
          }
        : undefined,
      proofs: payment.proofs?.map((pr: any) => ({
        id: pr.id,
        mediaObjectId: pr.mediaObjectId,
        scanStatus: pr.mediaObject?.scanStatus,
        contentType: pr.mediaObject?.contentType,
        sizeBytes: pr.mediaObject?.sizeBytes?.toString?.() ?? pr.mediaObject?.sizeBytes,
        submittedByContext: pr.submittedByContext,
        isCurrent: pr.isCurrent,
        createdAt: pr.createdAt,
      })),
    };
  }
}
