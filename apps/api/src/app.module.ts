import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { PicklistModule } from './picklist/picklist.module';
import { ReceivingModule } from './receiving/receiving.module';
import { NotifyModule } from './notify/notify.module';
import { StockModule } from './stock/stock.module';
import { DocumentModule } from './document/document.module';
import { SapModule } from './sap/sap.module';
import { MasterModule } from './master/master.module';
import { HealthController } from './health/health.controller';
import { loadEnv } from './config/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // .env tunggal di root repo, dipakai bersama api dan web.
      envFilePath: ['../../.env'],
      validate: loadEnv,
    }),
    DbModule,
    QueueModule,
    RealtimeModule,
    AuthModule,
    SapModule,
    MasterModule,
    PicklistModule,
    ReceivingModule,
    NotifyModule,
    StockModule,
    DocumentModule,
  ],
  controllers: [HealthController],
  providers: [
    // Semua endpoint butuh token kecuali yang ditandai @Public().
    // Default aman: endpoint baru tidak akan tidak sengaja terbuka.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Setelah JWT: hak per aksi dari TM_PERMISSION untuk endpoint ber-@RequirePermission.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
