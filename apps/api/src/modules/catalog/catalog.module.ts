import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { MenuImageService } from './menu-image.service';
import { MenuImageStorageService } from './menu-image-storage.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CatalogController],
  providers: [CatalogService, MenuImageService, MenuImageStorageService],
  exports: [CatalogService, MenuImageService],
})
export class CatalogModule {}
