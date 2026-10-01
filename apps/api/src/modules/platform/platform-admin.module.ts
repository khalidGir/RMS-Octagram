import { Module } from '@nestjs/common';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { FeaturesModule } from '../features/features.module';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
  imports: [PrismaModule, AuthModule, AuditModule, FeaturesModule, TenancyModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
