import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { PicklistModule } from '../picklist/picklist.module';
import { SequenceService } from '../common/sequence.service';
import { ReceivingService } from './receiving.service';
import { ReceivingController } from './receiving.controller';

@Module({
  imports: [QueueModule, PicklistModule],
  controllers: [ReceivingController],
  providers: [ReceivingService, SequenceService],
  exports: [ReceivingService],
})
export class ReceivingModule {}
