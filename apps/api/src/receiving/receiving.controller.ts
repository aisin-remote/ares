import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  openReceiptSchema,
  scanReceiptSchema,
  closeReceiptSchema,
  cancelReceiptSchema,
  type OpenReceiptInput,
  type ScanReceiptInput,
  type CloseReceiptInput,
  type CancelReceiptInput,
} from '@ares/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../auth/permissions.guard';
import type { Actor } from '../picklist/picklist.service';
import { ReceivingService } from './receiving.service';

/** Sesi scan dijalankan operator gudang yang login (keyboard-wedge di browser, PRD §9). */
function actorOf(req: Request): Actor {
  const p = req.principal;
  if (p?.kind !== 'user') throw new BadRequestException('Aksi ini hanya untuk akun user');
  if (p.plantId == null) throw new BadRequestException('Akun belum terikat ke pabrik');
  return { userId: p.sub, plantId: p.plantId };
}

@Controller('receipts')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  /** F-34: scan barcode picklist → sesi OPEN (atau lanjutkan yang ada). */
  @Post('open')
  @RequirePermission('receipt.open')
  open(
    @Body(new ZodValidationPipe(openReceiptSchema)) body: OpenReceiptInput,
    @Req() req: Request,
  ) {
    return this.receiving.open(body.code, actorOf(req));
  }

  /** F-35: progres per line. */
  @Get(':id')
  @RequirePermission('receipt.read')
  async get(@Param('id') reference: string, @Req() req: Request) {
    const actor = actorOf(req);
    return this.receiving.get(await this.receiving.resolveId(reference, actor.plantId), actor.plantId);
  }

  /** F-36/F-38: satu scan kanban; `clientRef` dikembalikan apa adanya. */
  @Post(':id/scan')
  @RequirePermission('receipt.scan')
  async scan(
    @Param('id') reference: string,
    @Body(new ZodValidationPipe(scanReceiptSchema)) body: ScanReceiptInput,
    @Req() req: Request,
  ) {
    const actor = actorOf(req);
    const out = await this.receiving.scan(
      await this.receiving.resolveId(reference, actor.plantId), body.code, actor,
    );
    return { ...out, clientRef: body.clientRef ?? null };
  }

  /** F-37: tutup sesi; alasan wajib bila ada yang kurang (6.5.2). */
  @Post(':id/close')
  @RequirePermission('receipt.close')
  async close(
    @Param('id') reference: string,
    @Body(new ZodValidationPipe(closeReceiptSchema)) body: CloseReceiptInput,
    @Req() req: Request,
  ) {
    const actor = actorOf(req);
    return this.receiving.close(
      await this.receiving.resolveId(reference, actor.plantId), body.reason, actor,
    );
  }

  /** F-40: PPIC membatalkan receipt; GR yang sudah keluar menghasilkan reversal 102. */
  @Post(':id/cancel')
  @RequirePermission('receipt.cancel')
  async cancel(
    @Param('id') reference: string,
    @Body(new ZodValidationPipe(cancelReceiptSchema)) body: CancelReceiptInput,
    @Req() req: Request,
  ) {
    const actor = actorOf(req);
    return this.receiving.cancel(
      await this.receiving.resolveId(reference, actor.plantId), body.reason, actor,
    );
  }
}
