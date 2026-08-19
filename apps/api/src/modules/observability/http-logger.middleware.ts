import { Injectable, type NestMiddleware, Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const { method, originalUrl } = req;
    const correlationId = req.correlationId || 'unknown';

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'log';

      this.logger[level](
        `${method} ${originalUrl} ${statusCode} ${duration}ms [${correlationId}]`,
      );
    });

    next();
  }
}
