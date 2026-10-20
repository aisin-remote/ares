import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { eq, or, and, type Database } from '@ares/db';
import { authChallenges, users, roles, devices, permissions } from '@ares/db';
import type {
  LoginInput,
  LoginAttemptResponse,
  LoginResponse,
  LoginOtpInput,
  DeviceLoginInput,
  DeviceLoginResponse,
  AuthSessionResponse,
} from '@ares/contracts';
import { InjectDb } from '../db/db.module';
import { QueueService } from '../queue/queue.service';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { generateEmailOtp, hashEmailOtp, maskEmail, verifyEmailOtp } from './email-otp';
import type { UserPrincipal, DevicePrincipal, Principal } from './auth.types';

interface LoginUser {
  id: number;
  npk: string;
  name: string;
  email: string | null;
  passwordHash: string | null;
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

  async login(input: LoginInput, requestIp?: string): Promise<LoginAttemptResponse> {
    const rows = await this.db
      .select({
        id: users.id,
        npk: users.npk,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
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

    if (user.roleName === 'supplier') {
      const email = user.email?.trim().toLowerCase();
      if (!email || !user.vendorId || input.npk.trim().toLowerCase() !== email) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Supplier harus masuk memakai email yang didaftarkan PPIC atau Admin',
        });
      }

      const challengeId = randomUUID();
      const code = generateEmailOtp();
      const expiresInMinutes = 5;
      await this.db.transaction(async (tx) => {
        await tx.delete(authChallenges).where(eq(authChallenges.email, email));
        await tx.insert(authChallenges).values({
          id: challengeId,
          vendorId: user.vendorId!,
          purpose: 'LOGIN_EMAIL_OTP',
          name: user.name,
          email,
          codeHash: hashEmailOtp(challengeId, code),
          expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
          requestIp: requestIp?.slice(0, 45) || null,
        });
      });

      try {
        await this.queue.add(
          QUEUES.NOTIFICATION,
          JOBS.SEND_LOGIN_OTP,
          { email, name: user.name, code, expiresInMinutes },
          { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
        );
      } catch (error) {
        await this.db.delete(authChallenges).where(eq(authChallenges.id, challengeId));
        this.logger.error(`gagal mengantrekan OTP login: ${String(error)}`);
        throw new ServiceUnavailableException('Kode OTP belum bisa dikirim. Silakan coba lagi.');
      }

      return {
        mfaRequired: true,
        mfaToken: await this.jwt.signAsync(
          { kind: 'mfa', purpose: 'LOGIN_EMAIL_OTP', sub: user.id, challengeId },
          { expiresIn: '5m' },
        ),
        emailHint: maskEmail(email),
        demoOtpCode: demoOtpAutofillEnabled() ? code : undefined,
      };
    }

    return this.issueLoginToken(user);
  }

  async loginOtp(input: LoginOtpInput): Promise<LoginResponse> {
    let token: {
      kind?: string;
      purpose?: string;
      sub?: number;
      challengeId?: string;
    } | null = null;
    try {
      token = await this.jwt.verifyAsync(input.mfaToken);
    } catch {
      token = null;
    }
    if (
      token?.kind !== 'mfa' ||
      token.purpose !== 'LOGIN_EMAIL_OTP' ||
      !Number.isInteger(token.sub) ||
      !token.challengeId
    ) {
      throw new UnauthorizedException('Kode OTP salah atau sesi verifikasi kedaluwarsa');
    }

    const result = await this.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(authChallenges)
        .where(eq(authChallenges.id, token!.challengeId!))
        .limit(1)
        .for('update');
      const unusable =
        !challenge ||
        challenge.purpose !== 'LOGIN_EMAIL_OTP' ||
        challenge.consumedAt !== null ||
        challenge.expiresAt.getTime() <= Date.now() ||
        challenge.attempts >= 5;
      if (unusable) return null;

      const [user] = await tx
        .select({
          id: users.id,
          npk: users.npk,
          name: users.name,
          email: users.email,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
          plantId: users.plantId,
          vendorId: users.vendorId,
          roleName: roles.name,
        })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.id, token!.sub!))
        .limit(1);

      let codeOk = false;
      try {
        codeOk = verifyEmailOtp(challenge.id, input.otpCode, challenge.codeHash);
      } catch {
        codeOk = false;
      }
      const userOk =
        user?.isActive &&
        user.roleName === 'supplier' &&
        user.email?.toLowerCase() === challenge.email.toLowerCase() &&
        user.vendorId === challenge.vendorId;
      if (!codeOk || !userOk) {
        const attempts = challenge.attempts + 1;
        await tx
          .update(authChallenges)
          .set({ attempts, consumedAt: attempts >= 5 ? new Date() : null })
          .where(eq(authChallenges.id, challenge.id));
        return null;
      }

      await tx
        .update(authChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(authChallenges.id, challenge.id));
      return user;
    });

    if (!result) throw new UnauthorizedException('Kode OTP salah atau sesi verifikasi kedaluwarsa');

    return this.issueLoginToken(result);
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

function demoOtpAutofillEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return ['true', '1', 'yes', 'y', 'on'].includes(
    (process.env.DEMO_OTP_AUTOFILL ?? '').trim().toLowerCase(),
  );
}
