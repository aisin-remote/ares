import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { stockAdjustSchema, type StockAdjustInput } from '@ares/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../auth/permissions.guard';
import { StockService, type StockActor } from './stock.service';
import { StockSnapshotService } from './stock-snapshot.service';

function actorOf(req: Request): StockActor {
  const p = req.principal;
  if (p?.kind !== 'user') throw new BadRequestException('Aksi ini hanya untuk akun user');
  if (p.plantId == null) throw new BadRequestException('Akun belum terikat ke pabrik');
  return { userId: p.sub, plantId: p.plantId };
}

/** F-41 dibaca halaman langsung dari DB; di sini hanya TULIS (F-42). */
@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly snapshot: StockSnapshotService,
  ) {}

  @Post('adjust')
  @RequirePermission('stock.adjust')
  adjust(
    @Body(new ZodValidationPipe(stockAdjustSchema)) body: StockAdjustInput,
    @Req() req: Request,
  ) {
    return this.stock.adjust(body, actorOf(req));
  }

  /**
   * Membekukan ulang saldo stok sekarang juga, tanpa menunggu cron.
   *
   * Dipakai setelah mutasi lama dikoreksi: snapshot adalah turunan, jadi
   * menjalankan ini kembali selalu aman dan hasilnya sama.
   */
  @Post('snapshot')
  @RequirePermission('stock.adjust')
  snapshotNow() {
    return this.snapshot.run();
  }
}
