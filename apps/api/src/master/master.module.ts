import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { MasterController } from './master.controller';
import { MasterService } from './master.service';
import { BomController } from './bom.controller';
import { BomService } from './bom.service';

@Module({
  imports: [QueueModule],
  // Urutan controller = urutan rute Express: BomController lebih dulu supaya
  // `master/bom/import` & `master/bom/explode` tidak jatuh ke `:entity/:id`.
  controllers: [BomController, MasterController],
  providers: [MasterService, BomService],
  exports: [BomService],
})
export class MasterModule {}
