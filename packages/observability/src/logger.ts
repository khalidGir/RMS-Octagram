import pino from 'pino';

export function createLogger(context: string) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    base: { context },
  });
}

export type Logger = ReturnType<typeof createLogger>;
