import { Module } from '@nestjs/common';
import { SequenceService } from '../common/sequence.service';
import { ReceivingService } from './receiving.service';
import { ReceivingController } from './receiving.controller';

@Module({
  controllers: [ReceivingController],
  providers: [ReceivingService, SequenceService],
  exports: [ReceivingService],
})
export class ReceivingModule {}
