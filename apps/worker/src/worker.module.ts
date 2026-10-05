import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MenuImageProcessor } from './menu-image.processor';
import { MenuImageQueueConsumer } from './menu-image.queue-consumer';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
  ],
  providers: [MenuImageProcessor, MenuImageQueueConsumer],
})
export class WorkerModule {}
