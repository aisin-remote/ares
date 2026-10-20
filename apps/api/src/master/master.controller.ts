import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ENTITY_DEFS,
  isMasterEntity,
  VENDOR_PART_SELF_FIELDS,
  type MasterEntity,
} from '@ares/contracts';
import { RequirePermission } from '../auth/permissions.guard';
import { MasterService, type MasterActor } from './master.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES, JOBS } from '../queue/queue.constants';

function entityOf(value: string): MasterEntity {
  if (!isMasterEntity(value))
    throw new BadRequestException(`Entitas master "${value}" tidak dikenal`);
  return value;
}

function actorOf(req: Request): MasterActor {
  const principal = req.principal;
  if (principal?.kind !== 'user' || !principal.role)
    throw new BadRequestException('Aksi master hanya untuk akun pengguna');
  return { userId: principal.sub, role: principal.role };
}

/** Akun supplier: vendorId diambil dari token, tidak pernah dari body. */
function vendorActorOf(req: Request): MasterActor & { vendorId: number } {
  const principal = req.principal;
  if (principal?.kind !== 'user' || !principal.role)
    throw new BadRequestException('Aksi ini hanya untuk akun pengguna');
  if (principal.vendorId == null)
    throw new BadRequestException('Hanya akun supplier yang bisa mengubah vendor part-nya sendiri');
  return { userId: principal.sub, role: principal.role, vendorId: principal.vendorId };
}

function positive(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/** F-01–F-09: satu endpoint untuk semua entitas master dan setting. */
@Controller('master')
export class MasterController {
  constructor(
    private readonly master: MasterService,
    private readonly queue: QueueService,
  ) {}

  @Get('meta')
  @RequirePermission('master.read')
  meta() {
    return ENTITY_DEFS;
  }

  @Put('orderStandards/bulk')
  @RequirePermission('master.write')
  saveOrderStandards(@Body() body: unknown, @Req() req: Request) {
    return this.master.saveOrderStandards(body, actorOf(req));
  }

  /**
   * Supplier memperbarui atribut kemasan vendor part miliknya (back number,
   * rak, tipe box). Berlaku seketika; PPIC dikabari lewat antrean supaya
   * SMTP yang lambat tidak menahan permintaan (aturan repo 2).
   */
  @Patch('vendorParts/:id/kemasan')
  @RequirePermission('vendorPart.self')
  async updateVendorPartSelf(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const actor = vendorActorOf(req);
    const { row, before } = await this.master.updateVendorPartSelf(id, body, actor);
    const changes = VENDOR_PART_SELF_FIELDS.filter(
      (field) => String(before[field.name] ?? '') !== String(row[field.name] ?? ''),
    ).map((field) => ({
      field: field.name,
      label: field.label,
      before: String(before[field.name] ?? ''),
      after: String(row[field.name] ?? ''),
    }));
    if (changes.length > 0) {
      // Gagal mengantre tidak boleh membatalkan perubahan yang sudah tersimpan;
      // jejaknya tetap ada di TT_AUDIT_LOG.
      await this.queue
        .add(QUEUES.NOTIFICATION, JOBS.NOTIFY_VENDOR_PART, {
          vendorPartId: id,
          userId: actor.userId,
          changes,
        })
        .catch(() => undefined);
    }
    return { ...row, changes };
  }

  @Get(':entity/options')
  @RequirePermission('master.read')
  options(@Param('entity') entity: string, @Req() req: Request) {
    return this.master.options(entity, actorOf(req));
  }

  @Get(':entity')
  @RequirePermission('master.read')
  list(
    @Param('entity') entity: string,
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    return this.master.list(
      entityOf(entity),
      {
        page: positive(page, 1, 1_000_000),
        perPage: positive(perPage, 25, 200),
        q: q?.trim() || undefined,
        sort,
        dir: dir === 'desc' ? 'desc' : 'asc',
      },
      actorOf(req),
    );
  }

  @Get(':entity/:id')
  @RequirePermission('master.read')
  get(@Param('entity') entity: string, @Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.master.get(entityOf(entity), id, actorOf(req));
  }

  @Post(':entity')
  @RequirePermission('master.write')
  create(@Param('entity') entity: string, @Body() body: unknown, @Req() req: Request) {
    return this.master.create(entityOf(entity), body, actorOf(req));
  }

  @Patch(':entity/:id')
  @RequirePermission('master.write')
  update(
    @Param('entity') entity: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.master.update(entityOf(entity), id, body, actorOf(req));
  }

  @Patch(':entity/:id/active')
  @RequirePermission('master.write')
  setActive(
    @Param('entity') entity: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isActive?: unknown },
    @Req() req: Request,
  ) {
    if (typeof body?.isActive !== 'boolean')
      throw new BadRequestException('Status aktif harus true atau false');
    return this.master.setActive(entityOf(entity), id, body.isActive, actorOf(req));
  }
}
