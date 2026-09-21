import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { NotifyService } from './notify.service';
import { NotifyWorker } from './notify.worker';

@Module({
  imports: [QueueModule],
  providers: [NotifyService, NotifyWorker],
  exports: [NotifyService],
})
export class NotifyModule {}
