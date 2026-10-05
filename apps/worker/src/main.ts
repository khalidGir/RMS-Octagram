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
  // A Nest application context has no HTTP listener to keep Node alive. When
  // SQS is not configured yet, the queue consumer intentionally idles and the
  // image processor's cleanup timer is unref'd, so the process would exit 0
  // and Docker would restart it forever. Keep the worker process alive until
  // it receives a shutdown signal.
  const keepAlive = setInterval(() => undefined, 60_000);

  process.on('SIGTERM', async () => {
    Logger.log('SIGTERM received, shutting down worker', 'Bootstrap');
    clearInterval(keepAlive);
    await app.close();
    process.exit(0);
  });
}

bootstrap();
