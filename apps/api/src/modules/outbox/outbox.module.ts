import { Module } from '@nestjs/common';
import { OutboxProcessor } from './outbox.processor';
import { FulfillmentEventDelivery } from './fulfillment-event-delivery.service';
import { OutboxController } from './outbox.controller';
import { KitchenModule } from '../kitchen/kitchen.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FeaturesModule } from '../features/features.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, KitchenModule, FeaturesModule, AuthModule],
  controllers: [OutboxController],
  providers: [OutboxProcessor, FulfillmentEventDelivery],
  exports: [OutboxProcessor],
})
export class OutboxModule {}
