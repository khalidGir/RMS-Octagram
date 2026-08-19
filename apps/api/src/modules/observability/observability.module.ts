import { Module, Global } from '@nestjs/common';
import { CorrelationService } from './correlation.service';

@Global()
@Module({
  providers: [CorrelationService],
  exports: [CorrelationService],
})
export class ObservabilityModule {}
