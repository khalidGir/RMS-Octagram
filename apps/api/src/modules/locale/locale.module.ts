import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { LocaleService } from './locale.service';
import { LocaleController } from './locale.controller';
import { MeLocaleController } from './me-locale.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LocaleController, MeLocaleController],
  providers: [LocaleService],
  exports: [LocaleService],
})
export class LocaleModule {}
