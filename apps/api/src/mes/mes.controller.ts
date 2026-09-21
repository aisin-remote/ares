import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Req, UnprocessableEntityException } from '@nestjs/common';
import type { Request } from 'express';
import { fakeProductionResultSchema, productionResultSchema, queueAdjustmentSchema, queueHoldSchema, reverseConsumptionSchema, type FakeProductionResultInput, type ProductionResultInput, type QueueAdjustmentInput, type QueueHoldInput, type ReverseConsumptionInput } from '@ares/contracts';
import { RequirePermission } from '../auth/permissions.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConsumptionService } from './consumption.service';
import { MesSyncService } from './mes-sync.service';
import { QueueControlService } from './queue-control.service';

function actorOf(req: Request): { userId: number; plantId: number } {
  const principal = req.principal;
  if (principal?.kind !== 'user' || principal.plantId == null) {
    throw new BadRequestException('Akun user harus terikat ke pabrik');
  }
  return { userId: principal.sub, plantId: principal.plantId };
}

@Controller('consumption')
export class ConsumptionController {
  constructor(private readonly consumption: ConsumptionService) {}

  /** F-10: jalur push alternatif memakai kontrak yang sama dengan gateway MES. */
  @Post()
  @RequirePermission('consumption.push')
  async create(
    @Body(new ZodValidationPipe(productionResultSchema)) body: ProductionResultInput,
    @Req() req: Request,
  ) {
    const result = await this.consumption.ingest(body, actorOf(req));
    if (result.status === 'FAILED') throw new UnprocessableEntityException(result.error);
    return result;
  }
}

@Controller('mes')
export class MesController {
  constructor(private readonly mes: MesSyncService) {}

  @Get('status')
  @RequirePermission('mes.read')
  status() {
    return this.mes.status();
  }

  @Post('sync')
  @RequirePermission('mes.write')
  sync() {
    return this.mes.enqueue();
  }

  @Post('fake')
  @RequirePermission('mes.write')
  addFake(@Body(new ZodValidationPipe(fakeProductionResultSchema)) body: FakeProductionResultInput) {
    return this.mes.addFake(body);
  }
}

@Controller('order-queues')
export class OrderQueueController {
  constructor(private readonly controls: QueueControlService) {}

  @Post(':id/adjust')
  @RequirePermission('queue.write')
  adjust(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(queueAdjustmentSchema)) body: QueueAdjustmentInput, @Req() req: Request) {
    return this.controls.adjust(id, body, actorOf(req));
  }

  @Post(':id/hold')
  @RequirePermission('queue.write')
  hold(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(queueHoldSchema)) body: QueueHoldInput, @Req() req: Request) {
    return this.controls.setHold(id, body, actorOf(req));
  }
}

@Controller('consumption')
export class ConsumptionCorrectionController {
  constructor(private readonly controls: QueueControlService) {}

  @Post(':id/reverse')
  @RequirePermission('queue.write')
  reverse(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(reverseConsumptionSchema)) body: ReverseConsumptionInput, @Req() req: Request) {
    return this.controls.reverseConsumption(id, body.reason, actorOf(req));
  }
}
