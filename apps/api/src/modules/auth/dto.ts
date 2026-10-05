import { IsString, IsNotEmpty, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: '0911 234 567',
    required: false,
    description: 'Ethiopian mobile number (0911234567, 911234567, or +251911234567)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiProperty({ example: 'StrongP@ss1' })
  @IsNotEmpty()
  @IsString()
  password!: string;

  /**
   * TEMPORARY compatibility field during the phone-first migration.
   * Remove together with AuthService's email lookup once staging has been
   * verified (see DECISIONS.md / docs/STAGING_DEPLOYMENT.md).
   */
  @ApiProperty({ required: false, deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(254)
  email?: string;
}

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
