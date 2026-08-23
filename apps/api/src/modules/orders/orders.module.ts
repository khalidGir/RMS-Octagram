import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersService } from './orders.service';
import { BranchOrderCounterService } from './branch-order-counter.service';
import { IdempotencyService } from './idempotency.service';
import { PriceCalculatorService } from './price-calculator.service';
import { OrdersController } from './orders.controller';
import { PublicOrdersController } from './public-orders.controller';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [PrismaModule, FeaturesModule],
  controllers: [OrdersController, PublicOrdersController],
  providers: [
    OrdersService,
    BranchOrderCounterService,
    IdempotencyService,
    PriceCalculatorService,
  ],
  exports: [OrdersService, IdempotencyService],
})
export class OrdersModule {}
