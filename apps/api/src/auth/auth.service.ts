import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { eq, or, and, type Database } from '@ares/db';
import { auditLogs, authChallenges, users, roles, devices, permissions, vendors } from '@ares/db';
import type {
  LoginInput,
  LoginAttemptResponse,
  LoginResponse,
  LoginTotpInput,
  DeviceLoginInput,
  DeviceLoginResponse,
  AuthSessionResponse,
  SupplierRegistrationRequestInput,
  SupplierRegistrationRequestResponse,
  SupplierRegistrationVerifyInput,
  SupplierRegistrationVerifyResponse,
} from '@ares/contracts';
import { InjectDb } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { qrPng } from '../document/pdf-runtime';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  totpUri,
  verifyTotp,
} from './totp';
import type { UserPrincipal, DevicePrincipal, Principal } from './auth.types';

interface LoginUser {
  id: number;
  npk: string;
  name: string;
  passwordHash: string | null;
  totpSecretEncrypted: string | null;
  isActive: boolean;
  plantId: number | null;
  vendorId: number | null;
  roleName: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Hash valid agar akun yang tidak ada tetap membayar biaya bcrypt yang sama. */
  private readonly dummyHash = bcrypt.hashSync(
    '__ares_invalid_password__',
    Number(process.env.BCRYPT_ROUNDS ?? 12),
  );

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly queue: QueueService,
  ) {}

  async requestSupplierRegistration(
    input: SupplierRegistrationRequestInput,
    requestIp?: string,
  ): Promise<SupplierRegistrationRequestResponse> {
    const challengeId = randomUUID();
    const secret = generateTotpSecret();
    const uri = totpUri(secret, input.email.trim().toLowerCase());
    const genericResponse = {
      challengeId,
      qrDataUrl: `data:image/png;base64,${(await qrPng(uri)).toString('base64')}`,
      setupKey: secret,
      message: 'Pindai QR dengan Google Authenticator, lalu masukkan kode 6 digit.',
    };
    const email = input.email.trim().toLowerCase();
    const [vendorRows, userRows] = await Promise.all([
      this.db
        .select({
          id: vendors.id,
          name: vendors.name,
          plantId: vendors.plantId,
          email: vendors.email,
        })
        .from(vendors)
        .where(and(eq(vendors.sapVendorNo, input.vendorCode.trim()), eq(vendors.isActive, true)))
        .limit(1),
      this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1),
    ]);
    const vendor = vendorRows[0];

    // Respons sengaja sama agar endpoint tidak bisa dipakai untuk menebak kode
    // supplier atau email yang sudah terdaftar.
    if (!vendor || userRows[0]) return genericResponse;

    const expiresInMinutes = 10;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

    await this.db.transaction(async (tx) => {
      // Satu email hanya memerlukan challenge terbaru; menghapus yang lama
      // juga membatasi penyimpanan data pribadi yang sudah tidak berguna.
      await tx.delete(authChallenges).where(eq(authChallenges.email, email));
      await tx.insert(authChallenges).values({
        id: challengeId,
        vendorId: vendor.id,
        purpose: 'SUPPLIER_REGISTRATION',
        name: input.name.trim(),
        email,
        totpSecretEncrypted: encryptTotpSecret(secret),
        expiresAt,
        requestIp: requestIp?.slice(0, 45) || null,
      });
    });
    return genericResponse;
  }

  async verifySupplierRegistration(
    input: SupplierRegistrationVerifyInput,
  ): Promise<SupplierRegistrationVerifyResponse> {
    // Dihitung sebelum membuka lock database agar transaksi tetap singkat.
    const passwordHash = await bcrypt.hash(input.password, Number(process.env.BCRYPT_ROUNDS ?? 12));
    const result = await this.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(authChallenges)
        .where(eq(authChallenges.id, input.challengeId))
        .limit(1)
        .for('update');
      const unusable =
        !challenge ||
        challenge.purpose !== 'SUPPLIER_REGISTRATION' ||
        challenge.consumedAt !== null ||
        challenge.expiresAt.getTime() <= Date.now() ||
        challenge.attempts >= 5;
      if (unusable) return { kind: 'INVALID' as const };

      let authenticatorValid = false;
      try {
        authenticatorValid = verifyTotp(
          decryptTotpSecret(challenge.totpSecretEncrypted),
          input.code,
        );
      } catch {
        authenticatorValid = false;
      }
      if (!authenticatorValid) {
        const attempts = challenge.attempts + 1;
        await tx
          .update(authChallenges)
          .set({ attempts, consumedAt: attempts >= 5 ? new Date() : null })
          .where(eq(authChallenges.id, challenge.id));
        // Kembalikan hasil biasa agar transaksi commit dan hitungan percobaan
        // tidak ikut rollback bersama exception.
        return { kind: 'INVALID' as const };
      }

      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, challenge.email))
        .limit(1)
        .for('update');
      if (existing) throw new ConflictException('Email sudah terdaftar. Silakan masuk.');

      const [supplierRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, 'supplier'))
        .limit(1);
      const [vendor] = await tx
        .select({
          id: vendors.id,
          name: vendors.name,
          code: vendors.sapVendorNo,
          plantId: vendors.plantId,
        })
        .from(vendors)
        .where(and(eq(vendors.id, challenge.vendorId), eq(vendors.isActive, true)))
        .limit(1);
      if (!supplierRole || !vendor) {
        throw new BadRequestException('Supplier tidak lagi aktif. Hubungi PPIC.');
      }

      const userId = (
        await tx
          .insert(users)
          .values({
            npk: `SUP-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
            name: challenge.name,
            email: challenge.email,
            passwordHash,
            totpSecretEncrypted: challenge.totpSecretEncrypted,
            roleId: supplierRole.id,
            plantId: vendor.plantId,
            vendorId: vendor.id,
            isActive: false,
          })
          .$returningId()
      )[0]!.id;
      await tx.delete(authChallenges).where(eq(authChallenges.id, challenge.id));
      await tx.insert(auditLogs).values({
        entity: 'users',
        entityId: String(userId),
        action: 'SELF_REGISTER_PENDING',
        userId,
        before: null,
        after: {
          name: challenge.name,
          email: challenge.email,
          role: 'supplier',
          vendorId: vendor.id,
          isActive: false,
        },
      });
      return {
        kind: 'SUCCESS' as const,
        email: challenge.email,
        name: challenge.name,
        vendorName: vendor.name,
        vendorCode: vendor.code ?? '',
      };
    });

    if (result.kind === 'INVALID') {
      throw new BadRequestException('Kode Authenticator tidak valid atau sesi sudah kedaluwarsa');
    }

    void this.queue
      .add(
        QUEUES.NOTIFICATION,
        JOBS.NOTIFY_SUPPLIER_REGISTRATION,
        {
          kind: 'SUPPLIER_REGISTRATION_PENDING',
          email: result.email,
          name: result.name,
          vendorName: result.vendorName,
          vendorCode: result.vendorCode,
        },
        { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
      )
      .catch((error) =>
        this.logger.warn(`gagal mengantrekan pemberitahuan PPIC: ${String(error)}`),
      );

    return {
      status: 'PENDING_APPROVAL',
      message: 'Google Authenticator terhubung. Akun menunggu persetujuan PPIC atau Admin.',
    };
  }

  async login(input: LoginInput): Promise<LoginAttemptResponse> {
    const rows = await this.db
      .select({
        id: users.id,
        npk: users.npk,
        name: users.name,
        passwordHash: users.passwordHash,
        totpSecretEncrypted: users.totpSecretEncrypted,
        isActive: users.isActive,
        plantId: users.plantId,
        vendorId: users.vendorId,
        roleName: roles.name,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      // Akun supplier masuk dengan email, akun internal dengan NPK. Satu
      // kolom identitas saja akan memaksa halaman login kedua (PRD §10.2
      // hanya meminta labelnya yang berbeda).
      .where(or(eq(users.npk, input.npk), eq(users.email, input.npk)))
      .limit(1);

    const user = rows[0];

    // Tetap jalankan bcrypt walau user tidak ada, supaya waktu respons tidak
    // membocorkan NPK mana yang terdaftar.
    const hash = user?.passwordHash ?? this.dummyHash;
    const passwordOk = await bcrypt.compare(input.password, hash);

    if (!user || !user.passwordHash || !passwordOk || !user.isActive) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'NPK/email atau password salah',
      });
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    if (bcrypt.getRounds(user.passwordHash) < rounds) {
      await this.db
        .update(users)
        .set({ passwordHash: await bcrypt.hash(input.password, rounds) })
        .where(eq(users.id, user.id));
    }

    if (user.totpSecretEncrypted) {
      return {
        mfaRequired: true,
        mfaToken: await this.jwt.signAsync(
          { kind: 'mfa', purpose: 'LOGIN_TOTP', sub: user.id },
          { expiresIn: '5m' },
        ),
      };
    }

    return this.issueLoginToken(user);
  }

  async loginTotp(input: LoginTotpInput): Promise<LoginResponse> {
    let challenge: { kind?: string; purpose?: string; sub?: number } | null = null;
    try {
      challenge = await this.jwt.verifyAsync(input.mfaToken);
    } catch {
      challenge = null;
    }
    if (
      challenge?.kind !== 'mfa' ||
      challenge.purpose !== 'LOGIN_TOTP' ||
      !Number.isInteger(challenge.sub)
    ) {
      throw new UnauthorizedException('Kode Authenticator salah atau sesi verifikasi kedaluwarsa');
    }

    const [user] = await this.db
      .select({
        id: users.id,
        npk: users.npk,
        name: users.name,
        passwordHash: users.passwordHash,
        totpSecretEncrypted: users.totpSecretEncrypted,
        isActive: users.isActive,
        plantId: users.plantId,
        vendorId: users.vendorId,
        roleName: roles.name,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, challenge.sub!))
      .limit(1);

    let authenticatorOk = false;
    if (user?.totpSecretEncrypted) {
      try {
        authenticatorOk = verifyTotp(decryptTotpSecret(user.totpSecretEncrypted), input.totpCode);
      } catch {
        authenticatorOk = false;
      }
    }
    if (!user || !user.passwordHash || !user.isActive || !authenticatorOk) {
      throw new UnauthorizedException('Kode Authenticator salah atau sesi verifikasi kedaluwarsa');
    }

    return this.issueLoginToken(user);
  }

  private async issueLoginToken(user: LoginUser): Promise<LoginResponse> {
    const principal: UserPrincipal = {
      kind: 'user',
      sub: user.id,
      npk: user.npk,
      name: user.name,
      role: user.roleName ?? null,
      plantId: user.plantId ?? null,
      vendorId: user.vendorId ?? null,
    };

    return {
      accessToken: await this.jwt.signAsync(principal, {
        expiresIn: (process.env.JWT_EXPIRES_IN ?? '8h') as JwtSignOptions['expiresIn'],
      }),
      user: {
        id: user.id,
        npk: user.npk,
        name: user.name,
        role: user.roleName ?? null,
        plantId: user.plantId ?? null,
        vendorId: user.vendorId ?? null,
      },
    };
  }

  /**
   * Login terminal lapangan.
   *
   * Token device berumur panjang karena scanner tidak bisa diminta login tiap
   * shift. Konsekuensinya token harus bisa dicabut: kolom `is_active` pada
   * devices dicek setiap kali, bukan hanya saat penerbitan token.
   */
  async deviceLogin(input: DeviceLoginInput): Promise<DeviceLoginResponse> {
    const rows = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.code, input.deviceCode), eq(devices.isActive, true)))
      .limit(1);

    const device = rows[0];
    const hash = device?.tokenHash ?? this.dummyHash;
    const tokenOk = await bcrypt.compare(input.token, hash);

    if (!device || !tokenOk) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Device tidak dikenal atau token salah',
      });
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const updates: { tokenHash?: string; lastSeenAt: string } = {
      lastSeenAt: new Date().toISOString(),
    };
    if (device.tokenHash && bcrypt.getRounds(device.tokenHash) < rounds)
      updates.tokenHash = await bcrypt.hash(input.token, rounds);
    await this.db.update(devices).set(updates).where(eq(devices.id, device.id));

    const principal: DevicePrincipal = {
      kind: 'device',
      sub: device.id,
      code: device.code,
      plantId: device.plantId ?? null,
    };

    return {
      accessToken: await this.signDevice(principal),
      device: { code: device.code, name: device.name, kind: device.kind },
    };
  }

  /** Perpanjang sesi perangkat yang masih aktif tanpa menyimpan token mentah. */
  async renewDevice(deviceId: number): Promise<{ accessToken: string }> {
    const rows = await this.db
      .select({ id: devices.id, code: devices.code, plantId: devices.plantId })
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.isActive, true)))
      .limit(1);
    const device = rows[0];
    if (!device) throw new UnauthorizedException('Device sudah tidak aktif');

    return {
      accessToken: await this.signDevice({
        kind: 'device',
        sub: device.id,
        code: device.code,
        plantId: device.plantId ?? null,
      }),
    };
  }

  /** Identitas kanonik untuk web; klaim JWT sudah dicocokkan DB oleh guard. */
  async session(principal: Principal): Promise<AuthSessionResponse> {
    if (principal.kind === 'user') {
      const rows = principal.role
        ? await this.db
            .select({ action: permissions.action })
            .from(permissions)
            .innerJoin(roles, eq(permissions.roleId, roles.id))
            .where(eq(roles.name, principal.role))
        : [];
      return { ...principal, permissions: rows.map((row) => row.action) };
    }
    const [device] = await this.db
      .select({ name: devices.name, kind: devices.kind })
      .from(devices)
      .where(eq(devices.id, principal.sub))
      .limit(1);
    if (!device) throw new UnauthorizedException('Device tidak ditemukan');
    return { ...principal, name: device.name, deviceKind: device.kind };
  }

  private signDevice(principal: DevicePrincipal): Promise<string> {
    return this.jwt.signAsync(principal, {
      expiresIn: (process.env.DEVICE_JWT_EXPIRES_IN ?? '365d') as JwtSignOptions['expiresIn'],
    });
  }
}
