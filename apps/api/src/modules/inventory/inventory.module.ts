import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FeaturesModule } from '../features/features.module';
import { InventoryController } from './inventory.controller';
import { RecipesController } from './recipes.controller';
import { InventoryItemsService } from './inventory-items.service';
import { InventoryBatchesService } from './inventory-batches.service';
import { InventoryMovementsService } from './inventory-movements.service';
import { RecipesService } from './recipes.service';
import { InventoryDeductionService } from './inventory-deduction.service';

@Module({
  imports: [PrismaModule, FeaturesModule],
  controllers: [InventoryController, RecipesController],
  providers: [
    InventoryItemsService,
    InventoryBatchesService,
    InventoryMovementsService,
    RecipesService,
    InventoryDeductionService,
  ],
  exports: [
    InventoryItemsService,
    InventoryBatchesService,
    InventoryMovementsService,
    RecipesService,
    InventoryDeductionService,
  ],
})
export class InventoryModule {}
