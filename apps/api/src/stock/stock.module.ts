import { Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockSnapshotService } from './stock-snapshot.service';
import { StockWorker } from './stock.worker';
import { StockController } from './stock.controller';

@Module({
  controllers: [StockController],
  providers: [StockService, StockSnapshotService, StockWorker],
  exports: [StockSnapshotService],
})
export class StockModule {}
