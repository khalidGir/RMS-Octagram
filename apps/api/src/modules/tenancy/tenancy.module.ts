import { Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { BrandingService } from './branding.service';
import { BrandingStorageService } from './branding-storage.service';
import { TenancyController } from './tenancy.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [PrismaModule, AuthModule, AuditModule, FeaturesModule],
  controllers: [TenancyController],
  providers: [TenancyService, BrandingService, BrandingStorageService],
  exports: [TenancyService],
})
export class TenancyModule {}
