import pino from 'pino';
import { redactSensitive } from './redactor';

export function createLogger(context: string) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    base: { context },
    redact: {
      paths: [
        'password',
        'passwordHash',
        'accessToken',
        'refreshToken',
        'paymentToken',
        'trackingToken',
        'qrToken',
        'invitationToken',
        'authorization',
        'cookie',
        'signature',
        'secret',
        'secretHash',
        'selectorHash',
        'token',
      ],
      censor: '[REDACTED]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
