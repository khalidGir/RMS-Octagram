import { Module } from '@nestjs/common';
import { BusinessDayService } from './business-day.service';
import { BusinessDayController } from './business-day.controller';

@Module({
  controllers: [BusinessDayController],
  providers: [BusinessDayService],
  exports: [BusinessDayService],
})
export class BusinessDayModule {}
