import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateEnv } from '@rms/config';

async function bootstrap() {
  validateEnv(process.env);

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('API_PORT', 3001);
  const corsOrigin = configService.get<string>('API_CORS_ORIGIN', 'http://localhost:3000');

  app.use(helmet());
  app.enableCors({ origin: corsOrigin, credentials: true });
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('RMS API')
    .setDescription('Restaurant Management System REST API')
    .setVersion('0.1.0')
    .addCookieAuth('refresh_token')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);

  Logger.log(`RMS API running on port ${port}`, 'Bootstrap');
  Logger.log(`OpenAPI docs at http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
