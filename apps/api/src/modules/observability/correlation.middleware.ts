import {
  Injectable,
  type NestMiddleware,
  Logger,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { CorrelationService } from './correlation.service';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly correlationService: CorrelationService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      this.correlationService.generateCorrelationId();

    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      this.logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms [${correlationId}]`,
      );
    });

    next();
  }
}
