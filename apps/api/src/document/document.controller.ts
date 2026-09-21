import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  StreamableFile,
} from '@nestjs/common';
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
  picklist(@Param('id', ParseIntPipe) id: number, @Req() req: Request): Promise<StreamableFile> {
    return this.stream(id, 'picklist', req);
  }

  @Get(':id/kanban.pdf')
  @RequirePermission('picklist.read')
  kanban(@Param('id', ParseIntPipe) id: number, @Req() req: Request): Promise<StreamableFile> {
    return this.stream(id, 'kanban', req);
  }

  private async stream(id: number, kind: DocKind, req: Request): Promise<StreamableFile> {
    const scope = scopeOf(req);
    const { path, fileName } = await this.documents.fileFor(id, kind, scope);

    /*
     * F-29: unduhan pertama SUPPLIER yang menandai DOWNLOADED, bukan unduhan
     * PPIC. PPIC memang rutin membuka PDF untuk mengecek isinya, dan kalau itu
     * ikut menandai, kolom "belum diunduh supplier" di dashboard portal
     * langsung kosong padahal suppliernya belum melihat apa pun.
     */
    if (scope !== null) await this.picklists.markDownloaded(id, scope);

    return new StreamableFile(createReadStream(path), {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
