import { BadRequestException, Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { SapOutboxService } from './sap-outbox.service';
import { SapWriterService } from './sap-writer.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../auth/permissions.guard';
import { QueueService } from '../queue/queue.service';
import { JOBS, QUEUES } from '../queue/queue.constants';

function actorOf(req: Request): { userId: number; plantId: number } {
  if (req.principal?.kind !== 'user') throw new BadRequestException('Aksi ini hanya untuk user');
  if (req.principal.plantId == null) throw new BadRequestException('Akun belum terikat ke pabrik');
  return { userId: req.principal.sub, plantId: req.principal.plantId };
}

const retrySchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'Pilih minimal satu dokumen'),
});
type RetryInput = z.infer<typeof retrySchema>;

const statusSchema = z.enum([
  'ALL', 'PENDING', 'PROCESSING', 'STAGED', 'POSTED', 'FAILED', 'HELD', 'SKIPPED',
]);
const docTypeSchema = z.enum(['ALL', 'GR', 'GR_REVERSAL']);

function filter<T extends z.ZodTypeAny>(schema: T, value: string | undefined, label: string) {
  if (!value) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(`${label} tidak valid`);
  return result.data as z.infer<T>;
}

function day(value: string | undefined, end = false): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Format tanggal tidak valid');
  const [year, month, date] = value.split('-').map(Number);
  if (month! < 1 || month! > 12 || date! < 1 || date! > new Date(Date.UTC(year!, month!, 0)).getUTCDate())
    throw new BadRequestException('Tanggal tidak valid');
  const result = new Date(`${value}T00:00:00+07:00`);
  if (end) result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

@Controller('sap')
export class SapController {
  constructor(
    private readonly outbox: SapOutboxService,
    private readonly writer: SapWriterService,
    private readonly queue: QueueService,
  ) {}

  /** Ringkasan antrean, untuk kartu di layar pemantauan. */
  @Get('summary')
  @RequirePermission('outbox.read')
  async summary(@Req() req: Request) {
    const { plantId } = actorOf(req);
    return {
      ...(await this.outbox.summary(plantId)),
      pengirimanAktif: this.writer.aktif,
      gateway: this.writer.mode,
    };
  }

  @Get('outbox')
  @RequirePermission('outbox.read')
  list(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
    @Query('docType') docType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.outbox.list({
      page: Math.max(1, Number(page) || 1),
      perPage: Math.min(100, Math.max(1, Number(perPage) || 25)),
      status: filter(statusSchema, status, 'Status'),
      docType: filter(docTypeSchema, docType, 'Jenis dokumen'),
      from: day(from),
      toExclusive: day(to, true),
    }, actorOf(req).plantId);
  }

  /** Mengumpulkan sekarang juga, tanpa menunggu putaran berikutnya. */
  @Post('collect')
  @RequirePermission('outbox.collect')
  async collect(@Req() req: Request) {
    const { plantId } = actorOf(req);
    const hasil = await this.outbox.collect(plantId);
    const lepas = await this.outbox.releaseHeld(plantId);
    await this.queue.add(QUEUES.SAP, JOBS.FLUSH_SAP_OUTBOX, { plantId });
    return { ...hasil, ...lepas, dijadwalkan: true };
  }

  @Post('retry')
  @RequirePermission('outbox.retry')
  async retry(@Body(new ZodValidationPipe(retrySchema)) body: RetryInput, @Req() req: Request) {
    const actor = actorOf(req);
    const hasil = await this.outbox.retry(body.ids, actor.userId, actor.plantId);
    if (hasil.diulang > 0)
      await this.queue.add(QUEUES.SAP, JOBS.FLUSH_SAP_OUTBOX, {
        ids: body.ids,
        plantId: actor.plantId,
      });
    return { ...hasil, dijadwalkan: hasil.diulang > 0 };
  }

  @Post('hold')
  @RequirePermission('outbox.hold')
  hold(@Body(new ZodValidationPipe(retrySchema)) body: RetryInput, @Req() req: Request) {
    const actor = actorOf(req);
    return this.outbox.hold(body.ids, actor.userId, actor.plantId);
  }
}
