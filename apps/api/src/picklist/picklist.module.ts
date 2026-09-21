import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SequenceService } from '../common/sequence.service';
import { PicklistService } from './picklist.service';
import { PicklistController } from './picklist.controller';
import { CutoffController } from './cutoff.controller';
import { CutoffService } from './cutoff.service';
import { CutoffWorker } from './cutoff.worker';

@Module({
  imports: [QueueModule],
  controllers: [PicklistController, CutoffController],
  providers: [PicklistService, SequenceService, CutoffService, CutoffWorker],
  exports: [PicklistService, CutoffService],
})
export class PicklistModule {}
