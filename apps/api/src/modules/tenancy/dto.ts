import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  IsInt,
  IsNumber,
  Min,
  Max,
  IsIn,
  IsDefined,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsString()
  email!: string;

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one uppercase, one lowercase, and one digit',
  })
  password!: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  displayName!: string;
}

export class LoginDto {
  @ApiProperty({ example: '0911 234 567', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsNotEmpty()
  @IsString()
  password!: string;

  /** TEMPORARY compatibility field during the phone-first migration. */
  @ApiProperty({ required: false, deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;
}

export class UpdateTenantDto {
  @ApiProperty({ example: 'My Restaurant' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class CreateBranchDto {
  @ApiProperty({ example: 'Main Branch' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'main' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug must be lowercase alphanumeric with hyphens' })
  slug!: string;
}

export class UpdateBranchDto {
  @ApiProperty({ example: 'Main Branch', required: false })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiProperty({ example: true, required: false })
  isActive?: boolean;
}

export class InviteMemberDto {
  @ApiProperty({
    example: '0911 234 567',
    description: 'Ethiopian mobile number (0911234567, 911234567, or +251911234567)',
  })
  @IsString()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ example: 'CASHIER', enum: ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF'] })
  @IsString()
  role!: string;

  @ApiProperty({ example: ['branch-id-1'], required: false })
  branchIds?: string[];
}

export class UpdateMembershipDto {
  @ApiProperty({
    example: 'MANAGER',
    enum: ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF'],
    required: false,
  })
  @IsString()
  role?: string;

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'SUSPENDED', 'REVOKED'], required: false })
  @IsString()
  status?: string;
}

export class ReplaceBranchAssignmentsDto {
  @ApiProperty({ example: ['branch-id-1', 'branch-id-2'] })
  branchIds!: string[];
}

export class SetFeatureDto {
  @ApiProperty({ example: true })
  enabled!: boolean;
}

export class LogoCropDto {
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0) @Max(1) x!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0) @Max(1) y!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0.01) @Max(1) width!: number;
  @ApiProperty({ minimum: 0, maximum: 1 }) @IsNumber() @Min(0.01) @Max(1) height!: number;
  @ApiPropertyOptional({ enum: [0, 90, 180, 270] })
  @IsIn([0, 90, 180, 270])
  @IsOptional()
  rotation?: number;
}

export class CreateLogoUploadDto {
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: string;

  @ApiProperty({ minimum: 1, maximum: 10485760 })
  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  sizeBytes!: number;
  @ApiProperty({ description: 'Lowercase SHA-256 hex digest' })
  @Matches(/^[a-f0-9]{64}$/)
  sha256!: string;
  @ApiProperty() @IsDefined() @ValidateNested() @Type(() => LogoCropDto) crop!: LogoCropDto;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class FinalizeLogoDto {
  @ApiProperty() @IsString() mediaObjectId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}

export class RemoveLogoDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
}
