import { Module } from '@nestjs/common';
import { SupportContextService } from './support-context.service';
import { SupportContextController } from './support-context.controller';
import { SupportModeGuard } from './support-mode.guard';

@Module({
  controllers: [SupportContextController],
  providers: [SupportContextService, SupportModeGuard],
  exports: [SupportContextService, SupportModeGuard],
})
export class SupportContextModule {}
