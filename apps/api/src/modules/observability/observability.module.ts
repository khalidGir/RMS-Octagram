import { Module, Global } from '@nestjs/common';
import { CorrelationService } from './correlation.service';
import { ExecutionContext } from './execution-context';

@Global()
@Module({
  providers: [CorrelationService, ExecutionContext],
  exports: [CorrelationService, ExecutionContext],
})
export class ObservabilityModule {}
