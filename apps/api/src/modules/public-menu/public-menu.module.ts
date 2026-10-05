import { Module } from '@nestjs/common';
import { PublicMenuService } from './public-menu.service';
import { PublicContextService } from './public-context.service';
import { PublicMenuController } from './public-menu.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [PrismaModule, CatalogModule],
  controllers: [PublicMenuController],
  providers: [PublicMenuService, PublicContextService],
  exports: [PublicMenuService, PublicContextService],
})
export class PublicMenuModule {}
