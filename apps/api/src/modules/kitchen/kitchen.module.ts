import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KitchenStationsService } from './kitchen-stations.service';
import { KitchenTicketsService } from './kitchen-tickets.service';
import { KitchenStationsController } from './kitchen-stations.controller';
import { KitchenTicketsController } from './kitchen-tickets.controller';
import { KdsGateway } from './kds.gateway';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [PrismaModule, FeaturesModule],
  controllers: [KitchenStationsController, KitchenTicketsController],
  providers: [
    KitchenStationsService,
    KitchenTicketsService,
    KdsGateway,
  ],
  exports: [KitchenStationsService, KitchenTicketsService, KdsGateway],
})
export class KitchenModule {}
