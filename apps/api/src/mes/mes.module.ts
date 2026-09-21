import { Module } from '@nestjs/common';
import { DB } from '../db/db.module';
import type { Database } from '@ares/db';
import { ConsumptionController, ConsumptionCorrectionController, MesController, OrderQueueController } from './mes.controller';
import { ConsumptionService } from './consumption.service';
import { FakeMesGateway, HttpMesGateway, MES_GATEWAY } from './mes.gateway';
import { MesSyncService } from './mes-sync.service';
import { MesWorker } from './mes.worker';
import { QueueControlService } from './queue-control.service';

@Module({
  controllers: [ConsumptionController, ConsumptionCorrectionController, MesController, OrderQueueController],
  providers: [
    ConsumptionService,
    MesSyncService,
    MesWorker,
    QueueControlService,
    {
      provide: MES_GATEWAY,
      inject: [DB],
      useFactory: (db: Database) =>
        process.env.MES_GATEWAY === 'http' ? new HttpMesGateway() : new FakeMesGateway(db),
    },
  ],
  exports: [ConsumptionService, MesSyncService],
})
export class MesModule {}
