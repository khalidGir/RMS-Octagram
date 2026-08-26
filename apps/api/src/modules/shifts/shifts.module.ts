import { Module } from '@nestjs/common';
import { CashShiftService } from './cash-shift.service';
import { CashShiftController } from './cash-shift.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CashShiftController],
  providers: [CashShiftService],
  exports: [CashShiftService],
})
export class ShiftsModule {}
