import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { SapOutboxService } from './sap-outbox.service';
import { SapWriterService } from './sap-writer.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../auth/permissions.guard';

function userIdOf(req: Request): number {
  if (req.principal?.kind !== 'user') throw new BadRequestException('Aksi ini hanya untuk user');
  return req.principal.sub;
}

const retrySchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'Pilih minimal satu dokumen'),
});
type RetryInput = z.infer<typeof retrySchema>;

@Controller('sap')
export class SapController {
  constructor(
    private readonly outbox: SapOutboxService,
    private readonly writer: SapWriterService,
  ) {}

  /** Ringkasan antrean, untuk kartu di layar pemantauan. */
  @Get('summary')
  @RequirePermission('outbox.read')
  async summary() {
    return {
      ...(await this.outbox.summary()),
      pengirimanAktif: this.writer.aktif,
      gateway: this.writer.mode,
    };
  }

  @Get('outbox')
  @RequirePermission('outbox.read')
  list(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
  ) {
    return this.outbox.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
      status,
    });
  }

  /** Mengumpulkan sekarang juga, tanpa menunggu putaran berikutnya. */
  @Post('collect')
  @RequirePermission('outbox.collect')
  async collect() {
    const hasil = await this.outbox.collect();
    const lepas = await this.outbox.releaseHeld();
    const kirim = await this.writer.flush();
    return { ...hasil, ...lepas, ...kirim };
  }

  @Post('retry')
  @RequirePermission('outbox.retry')
  async retry(@Body(new ZodValidationPipe(retrySchema)) body: RetryInput, @Req() req: Request) {
    const hasil = await this.outbox.retry(body.ids, userIdOf(req));
    const kirim = await this.writer.flush(body.ids);
    return { ...hasil, ...kirim };
  }

  @Post('hold')
  @RequirePermission('outbox.hold')
  hold(@Body(new ZodValidationPipe(retrySchema)) body: RetryInput, @Req() req: Request) {
    return this.outbox.hold(body.ids, userIdOf(req));
  }
}
