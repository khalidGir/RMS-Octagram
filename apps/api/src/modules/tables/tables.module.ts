import { Module } from '@nestjs/common';
import { TablesService } from './tables.service';
import { DiningSessionService } from './dining-session.service';
import { TablesController } from './tables.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TablesController],
  providers: [TablesService, DiningSessionService],
  exports: [TablesService, DiningSessionService],
})
export class TablesModule {}
