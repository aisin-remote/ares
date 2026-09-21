import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENTITY_DEFS, isMasterEntity, type MasterEntity } from '@ares/contracts';
import { RequirePermission } from '../auth/permissions.guard';
import { MasterService, type MasterActor } from './master.service';

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

function positive(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

/** F-01–F-09: satu endpoint untuk semua entitas master dan setting. */
@Controller('master')
export class MasterController {
  constructor(private readonly master: MasterService) {}

  @Get('meta')
  @RequirePermission('master.read')
  meta() {
    return ENTITY_DEFS;
  }

  @Get(':entity/options')
  @RequirePermission('master.read')
  options(@Param('entity') entity: string) {
    return this.master.options(entity);
  }

  @Get(':entity')
  @RequirePermission('master.read')
  list(
    @Param('entity') entity: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('dir') dir?: string,
  ) {
    return this.master.list(entityOf(entity), {
      page: positive(page, 1, 1_000_000),
      perPage: positive(perPage, 25, 200),
      q: q?.trim() || undefined,
      sort,
      dir: dir === 'desc' ? 'desc' : 'asc',
    });
  }

  @Get(':entity/:id')
  @RequirePermission('master.read')
  get(@Param('entity') entity: string, @Param('id', ParseIntPipe) id: number) {
    return this.master.get(entityOf(entity), id);
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
