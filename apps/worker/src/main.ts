import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { validateWorkerEnv } from '@rms/config';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  validateWorkerEnv(process.env);

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  Logger.log('RMS Worker started', 'Bootstrap');

  process.on('SIGTERM', async () => {
    Logger.log('SIGTERM received, shutting down worker', 'Bootstrap');
    await app.close();
    process.exit(0);
  });
}

bootstrap();
