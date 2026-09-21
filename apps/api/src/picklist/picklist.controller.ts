import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  issueManualPicklistSchema,
  cancelPicklistSchema,
  confirmShipmentSchema,
  picklistListQuerySchema,
  type IssueManualPicklistInput,
  type CancelPicklistInput,
  type ConfirmShipmentInput,
  type PicklistListQuery,
} from '@ares/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermission } from '../auth/permissions.guard';
import { PicklistService, type Actor } from './picklist.service';

/**
 * Batas data pemanggil: id vendor untuk akun supplier, null untuk akun
 * internal. Nilainya HANYA dari token — tidak pernah dari query string.
 */
function scopeOf(req: Request): number | null {
  const p = req.principal;
  if (p?.kind !== 'user') throw new BadRequestException('Aksi ini hanya untuk akun user');
  return p.vendorId ?? null;
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
    return this.picklists.list(q, scopeOf(req));
  }

  @Get(':id')
  @RequirePermission('picklist.read')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.picklists.get(id, scopeOf(req));
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
  confirmShipment(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(confirmShipmentSchema)) body: ConfirmShipmentInput,
    @Req() req: Request,
  ) {
    const vendorId = scopeOf(req);
    if (vendorId == null)
      throw new BadRequestException('Konfirmasi kirim hanya untuk akun supplier');
    return this.picklists.confirmShipment(id, body, { vendorId, userId: actorOf(req).userId });
  }

  /** F-20 pembatalan sebelum SHIPPED. */
  @Post(':id/cancel')
  @RequirePermission('picklist.cancel')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(cancelPicklistSchema)) body: CancelPicklistInput,
    @Req() req: Request,
  ) {
    return this.picklists.cancel(id, body.reason, actorOf(req), scopeOf(req));
  }
}
