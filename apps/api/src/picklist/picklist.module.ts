import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SequenceService } from '../common/sequence.service';
import { PicklistService } from './picklist.service';
import { PicklistController } from './picklist.controller';

@Module({
  imports: [QueueModule],
  controllers: [PicklistController],
  providers: [PicklistService, SequenceService],
  exports: [PicklistService],
})
export class PicklistModule {}
