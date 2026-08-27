import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateEnv } from '@rms/config';
import { AppThrottlerGuard } from './modules/rate-limit/app-throttler.guard';

async function bootstrap() {
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('API_PORT', 3001);
  const corsOrigin = configService.get<string>('API_CORS_ORIGIN', 'http://localhost:3000');
  const trustProxy = configService.get<number>('TRUST_PROXY', 1);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // Trust proxy (for ALB — single hop)
  const httpAdapter = app.getHttpAdapter();
  const httpApp = httpAdapter.getInstance();
  if (httpApp && typeof httpApp.set === 'function') {
    httpApp.set('trust proxy', trustProxy);
  }

  // Security headers — different config for API JSON vs Swagger
  if (nodeEnv === 'production') {
    app.use(
      helmet({
        contentSecurityPolicy: false, // API returns JSON, not HTML
        crossOriginEmbedderPolicy: false,
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      }),
    );
  } else {
    app.use(helmet({ contentSecurityPolicy: false }));
  }

  // CORS — support comma-separated allowlist
  const allowedOrigins = corsOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowed = allowedOrigins.some((o) => {
        try {
          const allowedUrl = new URL(o);
          const originUrl = new URL(origin);
          return originUrl.hostname === allowedUrl.hostname ||
            originUrl.hostname.endsWith('.' + allowedUrl.hostname);
        } catch {
          return origin === o;
        }
      });

      if (allowed) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global throttler guard
  try {
    const throttlerGuard = app.get(AppThrottlerGuard);
    app.useGlobalGuards(throttlerGuard);
  } catch {
    // Throttler not available — continue without global rate limiting
  }

  // Swagger/OpenAPI
  const config = new DocumentBuilder()
    .setTitle('RMS API')
    .setDescription('Restaurant Management System REST API')
    .setVersion('0.1.0')
    .addCookieAuth('refresh_token')
    .addServer(`http://localhost:${port}`, 'Local Development')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Graceful shutdown
  app.enableShutdownHooks();

  // Handle SIGTERM/SIGINT for graceful drain
  const shutdown = async (signal: string) => {
    Logger.log(`Received ${signal}, starting graceful shutdown...`, 'Bootstrap');

    // Stop accepting new connections
    await app.close();

    Logger.log('Graceful shutdown complete', 'Bootstrap');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen(port);

  Logger.log(`RMS API running on port ${port} [env=${nodeEnv}]`, 'Bootstrap');
  Logger.log(`OpenAPI docs at http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
