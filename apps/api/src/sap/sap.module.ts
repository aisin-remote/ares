import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SapOutboxService } from './sap-outbox.service';
import { SapWriterService } from './sap-writer.service';
import { SapController } from './sap.controller';
import { SapWorker } from './sap.worker';
import { FakeSapGateway, MssqlStagingGateway, SAP_GATEWAY } from './sap.gateway';

@Module({
  imports: [QueueModule],
  controllers: [SapController],
  providers: [
    SapOutboxService,
    SapWriterService,
    SapWorker,
    {
      provide: SAP_GATEWAY,
      useFactory: () =>
        process.env.SAP_GATEWAY === 'mssql'
          ? new MssqlStagingGateway()
          : new FakeSapGateway(),
    },
  ],
  exports: [SapOutboxService],
})
export class SapModule {}
