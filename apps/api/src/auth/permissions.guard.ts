import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { and, eq, permissions, roles, type Database } from '@ares/db';
import { InjectDb } from '../db/db.module';

export const PERMISSION_KEY = 'permission';
/** Endpoint hanya untuk peran yang punya aksi ini di TM_PERMISSION (PRD §2, aturan 10). */
export const RequirePermission = (action: string) => SetMetadata(PERMISSION_KEY, action);

/**
 * Dijalankan setelah JwtAuthGuard (urutan APP_GUARD). Hak dibaca dari DB per
 * request — satu query berindeks; cache menyusul kalau terukur perlu.
 * Token device tidak punya peran, jadi tidak pernah lolos aksi berizin.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return true;

    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (principal?.kind !== 'user' || !principal.role) {
      throw new ForbiddenException(`Tidak punya hak ${action}`);
    }

    const [row] = await this.db
      .select({ id: permissions.id })
      .from(permissions)
      .innerJoin(roles, eq(permissions.roleId, roles.id))
      .where(and(eq(roles.name, principal.role), eq(permissions.action, action)))
      .limit(1);
    if (!row) throw new ForbiddenException(`Peran ${principal.role} tidak punya hak ${action}`);
    return true;
  }
}
