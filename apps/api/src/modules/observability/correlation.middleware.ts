import {
  Injectable,
  Inject,
  type NestMiddleware,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { CorrelationService } from './correlation.service';
import { ExecutionContext } from './execution-context';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(@Inject(CorrelationService) private readonly correlationService: CorrelationService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      this.correlationService.generateCorrelationId();

    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    // Run the rest of the request within an AsyncLocalStorage context
    const ctx = {
      correlationId,
      tenantId: undefined as string | undefined,
      userId: undefined as string | undefined,
    };

    ExecutionContext.run(ctx, () => {
      next();
    });
  }
}
