import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { basename, extname } from 'node:path';
import {
  issueManualPicklistSchema,
  cancelPicklistSchema,
  confirmShipmentSchema,
  overrideShipmentSchema,
  picklistListQuerySchema,
  type IssueManualPicklistInput,
  type CancelPicklistInput,
  type ConfirmShipmentInput,
  type OverrideShipmentInput,
  type PicklistListQuery,
} from '@ares/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../auth/permissions.guard';
import { PicklistService, type Actor } from './picklist.service';

interface UploadedExcel {
  buffer: Buffer;
  originalname: string;
}

const MAX_UPLOAD = 2 * 1024 * 1024;

/**
 * Batas data pemanggil: id vendor untuk akun supplier, null untuk akun
 * internal. Nilainya HANYA dari token — tidak pernah dari query string.
 */
function scopeOf(req: Request): number | null {
  const p = req.principal;
  if (p?.kind !== 'user') throw new BadRequestException('Aksi ini hanya untuk akun user');
  return p.vendorId ?? null;
}

function plantOf(req: Request): number {
  const p = req.principal;
  if (p?.kind !== 'user' || p.plantId == null)
    throw new BadRequestException('Akun belum terikat ke pabrik');
  return p.plantId;
}

/** Aksi picklist hanya untuk user (bukan device) yang terikat pabrik. */
function actorOf(req: Request): Actor {
  const p = req.principal;
  if (p?.kind !== 'user') throw new BadRequestException('Aksi ini hanya untuk akun user');
  if (p.plantId == null) throw new BadRequestException('Akun belum terikat ke pabrik');
  return { userId: p.sub, plantId: p.plantId };
}

@Controller('picklists')
export class PicklistController {
  constructor(private readonly picklists: PicklistService) {}

  @Get()
  @RequirePermission('picklist.read')
  list(
    @Query(new ZodValidationPipe(picklistListQuerySchema)) q: PicklistListQuery,
    @Req() req: Request,
  ) {
    return this.picklists.list(q, scopeOf(req), plantOf(req));
  }

  @Get(':id')
  @RequirePermission('picklist.read')
  async get(@Param('id') reference: string, @Req() req: Request) {
    const scope = scopeOf(req);
    const plantId = plantOf(req);
    return this.picklists.get(await this.picklists.resolveId(reference, scope, plantId), scope, plantId);
  }

  /** F-17 order manual. */
  @Post('import')
  @RequirePermission('picklist.issue')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  importManual(@UploadedFile() file: UploadedExcel | undefined, @Req() req: Request) {
    if (!file?.buffer?.length) throw new BadRequestException('Pilih berkas Excel (.xlsx) dulu');
    const safeName = basename(file.originalname).slice(0, 128);
    if (extname(safeName).toLowerCase() !== '.xlsx' || file.buffer.subarray(0, 4).toString('hex') !== '504b0304') {
      throw new BadRequestException('Berkas harus berupa Excel .xlsx yang valid');
    }
    return this.picklists.importManualExcel(file.buffer, actorOf(req));
  }

  /** F-17 order manual. */
  @Post()
  @RequirePermission('picklist.issue')
  issue(
    @Body(new ZodValidationPipe(issueManualPicklistSchema)) body: IssueManualPicklistInput,
    @Req() req: Request,
  ) {
    return this.picklists.issueManual(body, actorOf(req));
  }

  /**
   * F-30 konfirmasi kirim — hanya akun supplier; vendor-nya dari token,
   * bukan dari body, jadi supplier tidak bisa mengonfirmasi order orang lain.
   */
  @Post(':id/confirm-shipment')
  @RequirePermission('picklist.ship')
  async confirmShipment(
    @Param('id') reference: string,
    @Body(new ZodValidationPipe(confirmShipmentSchema)) body: ConfirmShipmentInput,
    @Req() req: Request,
  ) {
    const vendorId = scopeOf(req);
    if (vendorId == null)
      throw new BadRequestException('Konfirmasi kirim hanya untuk akun supplier');
    const id = await this.picklists.resolveId(reference, vendorId, plantOf(req));
    return this.picklists.confirmShipment(id, body, {
      vendorId,
      userId: actorOf(req).userId,
      plantId: plantOf(req),
    });
  }

  /** 6.3.4: koreksi jumlah kirim oleh PPIC sebelum sesi scan dibuka. */
  @Post(':id/override-shipment')
  @RequirePermission('picklist.override')
  async overrideShipment(
    @Param('id') reference: string,
    @Body(new ZodValidationPipe(overrideShipmentSchema)) body: OverrideShipmentInput,
    @Req() req: Request,
  ) {
    const actor = actorOf(req);
    return this.picklists.overrideShipment(
      await this.picklists.resolveId(reference, null, actor.plantId), body, actor,
    );
  }

  /** F-20 pembatalan sebelum SHIPPED. */
  @Post(':id/cancel')
  @RequirePermission('picklist.cancel')
  async cancel(
    @Param('id') reference: string,
    @Body(new ZodValidationPipe(cancelPicklistSchema)) body: CancelPicklistInput,
    @Req() req: Request,
  ) {
    const actor = actorOf(req);
    const scope = scopeOf(req);
    return this.picklists.cancel(
      await this.picklists.resolveId(reference, scope, actor.plantId), body.reason, actor, scope,
    );
  }
}
