import { Module } from '@nestjs/common';
import { OutboxProcessor } from './outbox.processor';
import { KitchenModule } from '../kitchen/kitchen.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, KitchenModule],
  providers: [OutboxProcessor],
  exports: [OutboxProcessor],
})
export class OutboxModule {}
