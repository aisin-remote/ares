import { BadRequestException, Controller, Get, Param, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { createReadStream } from 'node:fs';
import { RequirePermission } from '../auth/permissions.guard';
import { PicklistService } from '../picklist/picklist.service';
import { DocumentService } from './document.service';
import type { DocKind } from './document.types';

/** Batas data pemanggil; hanya dari token, tidak pernah dari URL. */
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

/**
 * Unduh PDF picklist dan kanban (F-26).
 *
 * Berkasnya dibaca dari disk apa adanya — tidak ada render di dalam request
 * (F-27, aturan repo 2). Kalau worker belum selesai, endpoint membalas 404
 * dengan pesan yang bisa ditampilkan layar, bukan menggantung menunggu.
 */
@Controller('picklists')
export class DocumentController {
  constructor(
    private readonly documents: DocumentService,
    private readonly picklists: PicklistService,
  ) {}

  @Get(':id/pdf')
  @RequirePermission('picklist.read')
  picklist(@Param('id') reference: string, @Req() req: Request): Promise<StreamableFile> {
    return this.stream(reference, 'picklist', req);
  }

  @Get(':id/kanban.pdf')
  @RequirePermission('picklist.read')
  kanban(@Param('id') reference: string, @Req() req: Request): Promise<StreamableFile> {
    return this.stream(reference, 'kanban', req);
  }

  @Get(':id/order-sheet.csv')
  @RequirePermission('picklist.read')
  csv(@Param('id') reference: string, @Req() req: Request): Promise<StreamableFile> {
    return this.stream(reference, 'csv', req);
  }

  /** F-26: ketiga dokumen sekaligus, supaya supplier cukup sekali unduh. */
  @Get(':id/dokumen.zip')
  @RequirePermission('picklist.read')
  async bundle(@Param('id') reference: string, @Req() req: Request): Promise<StreamableFile> {
    const scope = scopeOf(req);
    const plantId = plantOf(req);
    const id = await this.picklists.resolveId(reference, scope, plantId);
    const { data, fileName } = await this.documents.bundle(id, scope, plantId);
    if (scope !== null) await this.picklists.markDownloaded(id, scope, plantId);
    return new StreamableFile(data, {
      type: 'application/zip',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  private async stream(reference: string, kind: DocKind, req: Request): Promise<StreamableFile> {
    const scope = scopeOf(req);
    const plantId = plantOf(req);
    const id = await this.picklists.resolveId(reference, scope, plantId);
    const { path, fileName } = await this.documents.fileFor(id, kind, scope, plantId);

    /*
     * F-29: unduhan pertama SUPPLIER yang menandai DOWNLOADED, bukan unduhan
     * PPIC. PPIC memang rutin membuka PDF untuk mengecek isinya, dan kalau itu
     * ikut menandai, kolom "belum diunduh supplier" di dashboard portal
     * langsung kosong padahal suppliernya belum melihat apa pun.
     */
    if (scope !== null) await this.picklists.markDownloaded(id, scope, plantId);

    return new StreamableFile(createReadStream(path), {
      type: kind === 'csv' ? 'text/csv; charset=utf-16le' : 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
