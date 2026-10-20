import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { runCutoffSchema, type RunCutoffInput } from '@ares/contracts';
import { RequirePermission } from '../auth/permissions.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CutoffService } from './cutoff.service';

@Controller('cutoff')
export class CutoffController {
  constructor(private readonly cutoff: CutoffService) {}

  /** F-16: trigger manual operasional; proses berat tetap berjalan di BullMQ. */
  @Post('run')
  @RequirePermission('queue.write')
  run(
    @Body(new ZodValidationPipe(runCutoffSchema)) body: RunCutoffInput,
    @Req() req: Request,
  ) {
    const principal = req.principal;
    if (principal?.kind !== 'user' || principal.plantId == null) {
      throw new BadRequestException('Akun user harus terikat ke pabrik');
    }
    return this.cutoff.enqueue({ userId: principal.sub, plantId: principal.plantId }, body);
  }

  @Get('result/:jobId')
  @RequirePermission('queue.write')
  result(@Param('jobId') jobId: string, @Req() req: Request) {
    const principal = req.principal;
    if (principal?.kind !== 'user' || principal.plantId == null) {
      throw new BadRequestException('Akun user harus terikat ke pabrik');
    }
    return this.cutoff.jobStatus(jobId, {
      userId: principal.sub,
      plantId: principal.plantId,
    });
  }
}
