import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, devices, eq, roles, users, type Database } from '@ares/db';
import type { Request } from 'express';
import type { Principal } from './auth.types';
import { InjectDb } from '../db/db.module';

export const IS_PUBLIC = 'isPublic';
/** Menandai endpoint yang boleh diakses tanpa token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('Token tidak ditemukan');

    try {
      const verified = await this.jwt.verifyAsync<Principal | { kind?: string }>(token);
      if (verified.kind !== 'user' && verified.kind !== 'device') {
        throw new UnauthorizedException('Token tidak dapat dipakai sebagai sesi');
      }
      let principal = verified as Principal;
      if (principal.kind === 'device') {
        const [active] = await this.db
          .select({ id: devices.id, code: devices.code, plantId: devices.plantId })
          .from(devices)
          .where(
            and(
              eq(devices.id, principal.sub),
              eq(devices.code, principal.code),
              eq(devices.isActive, true),
            ),
          )
          .limit(1);
        if (!active) throw new UnauthorizedException('Device sudah tidak aktif');
        principal = {
          kind: 'device',
          sub: active.id,
          code: active.code,
          plantId: active.plantId ?? null,
        };
      } else {
        const [active] = await this.db
          .select({
            id: users.id,
            npk: users.npk,
            name: users.name,
            role: roles.name,
            plantId: users.plantId,
            vendorId: users.vendorId,
          })
          .from(users)
          .leftJoin(roles, eq(users.roleId, roles.id))
          .where(
            and(
              eq(users.id, principal.sub),
              eq(users.npk, principal.npk),
              eq(users.isActive, true),
            ),
          )
          .limit(1);
        if (!active) throw new UnauthorizedException('Akun sudah tidak aktif');
        principal = {
          kind: 'user',
          sub: active.id,
          npk: active.npk,
          name: active.name,
          role: active.role ?? null,
          plantId: active.plantId ?? null,
          vendorId: active.vendorId ?? null,
        };
      }
      req.principal = principal;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }
  }
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}
