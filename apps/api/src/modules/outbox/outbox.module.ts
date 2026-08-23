import { Module } from '@nestjs/common';
import { OutboxProcessor } from './outbox.processor';
import { KitchenModule } from '../kitchen/kitchen.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [PrismaModule, KitchenModule, FeaturesModule],
  providers: [OutboxProcessor],
  exports: [OutboxProcessor],
})
export class OutboxModule {}
