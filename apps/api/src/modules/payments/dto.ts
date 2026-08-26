import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsNumber,
  IsBoolean,
  IsInt,
  Min,
  Max,
  Length,
  IsIn,
} from 'class-validator';

const MAX_PROOF_SIZE = 5 * 1024 * 1024;

// ─── Customer-facing DTOs ──────────────────

export class CreateManualTransferDto {
  @ApiProperty({ description: 'Order tracking token (opaque, from order creation)' })
  @IsString()
  @IsNotEmpty()
  trackingToken!: string;

  @ApiProperty({ description: 'Client-generated idempotency key (unique per request)' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @ApiPropertyOptional({ enum: ['BANK_TRANSFER', 'TELEBIRR'], description: 'Payment method (default: BANK_TRANSFER)' })
  @IsOptional()
  @IsIn(['BANK_TRANSFER', 'TELEBIRR'])
  method?: 'BANK_TRANSFER' | 'TELEBIRR';

  @ApiPropertyOptional({ description: 'Customer payment reference (e.g., transaction ID)' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  customerReference?: string;
}

export class ProofUploadIntentDto {
  @ApiProperty({ description: 'Payment token (opaque, from manual-transfer creation)' })
  @IsString()
  @IsNotEmpty()
  paymentToken!: string;

  @ApiProperty({ description: 'Expected MIME type', example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^image\/(jpeg|png|webp)$/, { message: 'Accepted types: image/jpeg, image/png, image/webp' })
  contentType!: string;

  @ApiProperty({ description: 'Expected file size in bytes', example: 1048576 })
  @IsNumber()
  @Min(1)
  @Max(MAX_PROOF_SIZE)
  sizeBytes!: number;

  @ApiProperty({ description: 'SHA-256 checksum of the file (hex-encoded). Client must compute before uploading.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9a-f]{64}$/, { message: 'sha256 must be a 64-character hex string' })
  sha256!: string;
}

export class ProofFinalizeDto {
  @ApiProperty({ description: 'Payment token (opaque, from manual-transfer creation)' })
  @IsString()
  @IsNotEmpty()
  paymentToken!: string;

  @ApiProperty({ description: 'Upload intent ID (mediaObjectId from proof-upload response)' })
  @IsString()
  @IsNotEmpty()
  mediaObjectId!: string;

  @ApiPropertyOptional({ description: 'Customer payment reference (e.g., transaction ID)' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  customerReference?: string;
}

export class ApprovePaymentDto {
  @ApiPropertyOptional({ description: 'Review note' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reviewNote?: string;
}

export class RejectPaymentDto {
  @ApiProperty({ description: 'Rejection reason' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 500)
  reason!: string;
}

export class StaffManualTransferDto {
  @ApiProperty({ description: 'Order ID to pay' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiProperty({ description: 'Client-generated idempotency key' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @ApiPropertyOptional({ enum: ['BANK_TRANSFER', 'TELEBIRR', 'MANUAL_TRANSFER'], description: 'Payment method (default: BANK_TRANSFER)' })
  @IsOptional()
  @IsIn(['BANK_TRANSFER', 'TELEBIRR', 'MANUAL_TRANSFER'])
  method?: 'BANK_TRANSFER' | 'TELEBIRR' | 'MANUAL_TRANSFER';

  @ApiPropertyOptional({ description: 'Staff reference note' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  staffReference?: string;
}

// ─── Staff-facing DTOs ────────────────────

export class PaymentReviewQueryDto {
  @ApiPropertyOptional({ description: 'Filter by status', default: 'PENDING_VERIFICATION' })
  @IsOptional()
  @IsString()
  @IsIn(['PENDING_VERIFICATION', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'FAILED'], {
    message: 'status must be one of: PENDING_VERIFICATION, PENDING, APPROVED, REJECTED, CANCELLED, REFUNDED, FAILED',
  })
  status?: string;

  @ApiPropertyOptional({ description: 'Pagination cursor (payment ID)' })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiPropertyOptional({ description: 'Max results (default 50, max 100)', default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreatePaymentInstructionDto {
  @ApiProperty({ description: 'Payment method key', example: 'CBE' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  method!: string;

  @ApiProperty({ description: 'Display label', example: 'CBE Birr' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  label!: string;

  @ApiPropertyOptional({ description: 'Account holder name' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  accountHolder?: string;

  @ApiPropertyOptional({ description: 'Account identifier (phone, account number)' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  accountIdentifier?: string;

  @ApiPropertyOptional({ description: 'Transfer instructions text' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  instructions?: string;

  @ApiPropertyOptional({ description: 'Sort order', default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdatePaymentInstructionDto {
  @ApiPropertyOptional({ description: 'Payment method key' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  method?: string;

  @ApiPropertyOptional({ description: 'Display label' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  label?: string;

  @ApiPropertyOptional({ description: 'Account holder name' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  accountHolder?: string;

  @ApiPropertyOptional({ description: 'Account identifier' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  accountIdentifier?: string;

  @ApiPropertyOptional({ description: 'Transfer instructions text' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  instructions?: string;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Active status' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
