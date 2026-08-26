import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RedisThrottlerStorage } from './redis-throttler-storage';
import { AppThrottlerGuard } from './app-throttler.guard';

@Global()
@Module({
  providers: [
    {
      provide: RedisThrottlerStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new RedisThrottlerStorage(config),
    },
    {
      provide: AppThrottlerGuard,
      inject: [Reflector, RedisThrottlerStorage],
      useFactory: (reflector: Reflector, storage: RedisThrottlerStorage) =>
        new AppThrottlerGuard(reflector, storage),
    },
  ],
  exports: [RedisThrottlerStorage, AppThrottlerGuard],
})
export class RateLimitModule {}
