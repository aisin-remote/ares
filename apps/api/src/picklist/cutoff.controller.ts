import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../auth/permissions.guard';
import { CutoffService } from './cutoff.service';

@Controller('cutoff')
export class CutoffController {
  constructor(private readonly cutoff: CutoffService) {}

  /** F-16: trigger manual operasional; proses berat tetap berjalan di BullMQ. */
  @Post('run')
  @RequirePermission('queue.write')
  run(@Req() req: Request) {
    const principal = req.principal;
    if (principal?.kind !== 'user' || principal.plantId == null) {
      throw new BadRequestException('Akun user harus terikat ke pabrik');
    }
    return this.cutoff.enqueue({ userId: principal.sub, plantId: principal.plantId });
  }
}
