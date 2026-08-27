import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TaxConfigService } from './tax-config.service';
import { TaxConfigController } from './tax-config.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TaxConfigController],
  providers: [TaxConfigService],
  exports: [TaxConfigService],
})
export class TaxModule {}
