import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { PicklistModule } from '../picklist/picklist.module';
import { ReceivingModule } from '../receiving/receiving.module';
import { DocumentService } from './document.service';
import { DocumentController, ReceiptDocumentController } from './document.controller';
import { DocumentWorker } from './document.worker';

@Module({
  // PicklistModule dipakai untuk menandai DOWNLOADED saat supplier mengunduh
  // (F-29): penulisan status picklist tetap milik service picklist, bukan
  // ditulis langsung dari modul dokumen.
  imports: [QueueModule, PicklistModule, ReceivingModule],
  controllers: [DocumentController, ReceiptDocumentController],
  providers: [DocumentService, DocumentWorker],
  exports: [DocumentService],
})
export class DocumentModule {}
