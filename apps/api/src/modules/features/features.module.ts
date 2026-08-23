import { Module } from '@nestjs/common';
import { FeatureResolver } from './feature-resolver.service';
import { FeatureEnabledGuard } from './feature-enabled.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FeatureResolver, FeatureEnabledGuard],
  exports: [FeatureResolver, FeatureEnabledGuard],
})
export class FeaturesModule {}
