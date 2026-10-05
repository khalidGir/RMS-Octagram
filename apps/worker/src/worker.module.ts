import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MenuImageProcessor } from './menu-image.processor';
import { MenuImageQueueConsumer } from './menu-image.queue-consumer';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
  ],
  providers: [
    {
      provide: MenuImageProcessor,
      useFactory: (config: ConfigService) => new MenuImageProcessor(config),
      inject: [ConfigService],
    },
    {
      provide: MenuImageQueueConsumer,
      useFactory: (config: ConfigService, processor: MenuImageProcessor) => new MenuImageQueueConsumer(config, processor),
      inject: [ConfigService, MenuImageProcessor],
    },
  ],
})
export class WorkerModule {}
