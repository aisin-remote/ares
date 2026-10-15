import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { basename, extname } from 'node:path';
import { RequirePermission } from '../auth/permissions.guard';
import { BomService } from './bom.service';
import type { MasterActor } from './master.service';

/** Bentuk berkas dari multer; cukup ini, tanpa @types/multer. */
interface UploadedExcel {
  buffer: Buffer;
  originalname: string;
  size: number;
}

const MAX_UPLOAD = 2 * 1024 * 1024;

function actorOf(req: Request): MasterActor {
  const principal = req.principal;
  if (principal?.kind !== 'user' || !principal.role)
    throw new BadRequestException('Aksi master hanya untuk akun pengguna');
  return { userId: principal.sub, role: principal.role };
}

/**
 * F-03 di luar CRUD generik: upload Excel dan penguraian BOM.
 * Didaftarkan sebelum MasterController supaya `master/bom/import` tidak
 * tertangkap rute generik `:entity/:id`.
 */
@Controller('master/bom')
export class BomController {
  constructor(private readonly bom: BomService) {}

  @Post('import')
  @RequirePermission('master.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  import(@UploadedFile() file: UploadedExcel | undefined, @Req() req: Request) {
    if (!file?.buffer?.length) throw new BadRequestException('Pilih berkas Excel (.xlsx) dulu');
    const safeName = basename(file.originalname).slice(0, 128);
    if (
      extname(safeName).toLowerCase() !== '.xlsx' ||
      file.buffer.subarray(0, 4).toString('hex') !== '504b0304'
    ) {
      throw new BadRequestException('Berkas harus berupa Excel .xlsx yang valid');
    }
    return this.bom.importExcel(file.buffer, safeName, actorOf(req));
  }

  /** Penguraian sampai raw material: ?partId=&qty=&onDate=YYYY-MM-DD. */
  @Get('explode')
  @RequirePermission('master.read')
  explode(
    @Query('partId') partId?: string,
    @Query('qty') qty?: string,
    @Query('onDate') onDate?: string,
  ) {
    const id = Number(partId);
    const n = qty === undefined || qty === '' ? 1 : Number(qty);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('partId wajib diisi');
    if (!Number.isFinite(n) || n <= 0) throw new BadRequestException('qty harus lebih dari 0');
    if (onDate && !/^\d{4}-\d{2}-\d{2}$/.test(onDate))
      throw new BadRequestException('onDate harus YYYY-MM-DD');
    return this.bom.explode(id, n, onDate || undefined);
  }
}
