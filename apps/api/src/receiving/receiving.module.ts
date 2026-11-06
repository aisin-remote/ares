import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SequenceService } from '../common/sequence.service';
import { ReceivingService } from './receiving.service';
import { ReceivingController } from './receiving.controller';

@Module({
  imports: [QueueModule],
  controllers: [ReceivingController],
  providers: [ReceivingService, SequenceService],
  exports: [ReceivingService],
})
export class ReceivingModule {}
