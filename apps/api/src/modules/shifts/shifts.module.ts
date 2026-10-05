import { Module } from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { CashShiftController } from './cash-shift.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BusinessDayModule } from '../business-day/business-day.module';

@Module({
  imports: [PrismaModule, BusinessDayModule],
  controllers: [CashShiftController],
  providers: [CashShiftService],
  exports: [CashShiftService],
})
export class ShiftsModule {}
