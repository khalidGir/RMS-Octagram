import { Module } from '@nestjs/common';
import { S3UploadService } from './s3-upload.service';
import { AwsProofStorage } from './aws-proof-storage.adapter';
import { PaymentInstructionService } from './payment-instruction.service';
import { PaymentService } from './payments.service';
import { PublicPaymentsController } from './public-payments.controller';
import { PaymentsController } from './payments.controller';
import { OrdersModule } from '../orders/orders.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProofStorage } from './proof-storage.interface';
import { FeaturesModule } from '../features/features.module';

@Module({
  imports: [OrdersModule, FeaturesModule, InventoryModule],
  providers: [
    S3UploadService,
    { provide: ProofStorage, useClass: AwsProofStorage },
    PaymentInstructionService,
    PaymentService,
  ],
  controllers: [PublicPaymentsController, PaymentsController],
  exports: [PaymentService, PaymentInstructionService, ProofStorage],
})
export class PaymentsModule {}
