import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupportContextService } from './support-context.service';
import { SupportContextController } from './support-context.controller';
import { SupportModeGuard } from './support-mode.guard';

@Module({
  controllers: [SupportContextController],
  providers: [
    SupportContextService,
    SupportModeGuard,
    { provide: APP_GUARD, useClass: SupportModeGuard },
  ],
  exports: [SupportContextService, SupportModeGuard],
})
export class SupportContextModule {}
