import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
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
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsString()
  password!: string;
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
  @ApiProperty({ example: 'newstaff@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'CASHIER', enum: ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF'] })
  @IsString()
  role!: string;

  @ApiProperty({ example: ['branch-id-1'], required: false })
  branchIds?: string[];
}

export class UpdateMembershipDto {
  @ApiProperty({ example: 'MANAGER', enum: ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF'], required: false })
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
