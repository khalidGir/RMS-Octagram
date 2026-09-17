import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KitchenStationsService } from './kitchen-stations.service';
import { KitchenTicketsService } from './kitchen-tickets.service';
import { KitchenRoutingService } from './kitchen-routing.service';
import { FulfillmentStatusService } from './fulfillment-status.service';
import { KitchensService } from './kitchens.service';
import { RoutesService } from './routes.service';
import { FulfillmentPolicyService } from './fulfillment-policy.service';
import { KdsDevicesService } from './kds-devices.service';
import { ServiceNotificationService } from './service-notification.service';
import { ExpoService } from './expo.service';
import { WaiterService } from './waiter.service';
import { FulfillmentEscalationService } from './fulfillment-escalation.service';
import { KitchenStationsController } from './kitchen-stations.controller';
import { KitchenTicketsController } from './kitchen-tickets.controller';
import { KitchensController } from './kitchens.controller';
import { RoutesController } from './routes.controller';
import { FulfillmentPolicyController } from './fulfillment-policy.controller';
import { KdsDevicesController } from './kds-devices.controller';
import { ExpoController } from './expo.controller';
import { WaiterController } from './waiter.controller';
import { ServiceNotificationsController } from './service-notifications.controller';
import { KdsGateway } from './kds.gateway';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [PrismaModule, FeaturesModule],
  controllers: [
    KitchenStationsController,
    KitchenTicketsController,
    KitchensController,
    RoutesController,
    FulfillmentPolicyController,
    KdsDevicesController,
    ExpoController,
    WaiterController,
    ServiceNotificationsController,
  ],
  providers: [
    KitchenStationsService,
    KitchenTicketsService,
    KitchenRoutingService,
    FulfillmentStatusService,
    KitchensService,
    RoutesService,
    FulfillmentPolicyService,
    KdsDevicesService,
    ServiceNotificationService,
    ExpoService,
    WaiterService,
    FulfillmentEscalationService,
    KdsGateway,
  ],
  exports: [
    KitchenStationsService,
    KitchenTicketsService,
    KitchenRoutingService,
    FulfillmentStatusService,
    KitchensService,
    RoutesService,
    FulfillmentPolicyService,
    KdsDevicesService,
    ServiceNotificationService,
    ExpoService,
    WaiterService,
    FulfillmentEscalationService,
    KdsGateway,
  ],
})
export class KitchenModule {}
