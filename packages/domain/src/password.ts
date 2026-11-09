/**
 * Masa berlaku password.
 *
 * Semua akun wajib mengganti password tiap 90 hari. Admin dikecualikan supaya
 * pintu darurat tidak ikut terkunci saat tidak ada yang bisa login.
 */

export const PASSWORD_MAX_AGE_DAYS = 90;

/** Peran yang tidak pernah dipaksa ganti password. */
export const PASSWORD_EXEMPT_ROLES = ['admin'];

export interface PasswordAgeInput {
  /** Nama peran dari TM_ROLE; null untuk akun tanpa peran. */
  role: string | null;
  /** TM_USER.PASSWORD_CHANGED_AT; null berarti belum pernah tercatat. */
  changedAt: Date | null;
  now?: Date;
  maxAgeDays?: number;
}

/**
 * Password sudah lewat masa berlaku dan harus diganti sebelum sesi terbit.
 *
 * `changedAt` kosong dihitung kedaluwarsa: akun lama yang tidak punya catatan
 * lebih baik diminta ganti sekali daripada dibiarkan memakai password lama
 * tanpa batas.
 */
export function passwordExpired({
  role,
  changedAt,
  now = new Date(),
  maxAgeDays = PASSWORD_MAX_AGE_DAYS,
}: PasswordAgeInput): boolean {
  if (role && PASSWORD_EXEMPT_ROLES.includes(role)) return false;
  if (!changedAt) return true;
  const ageDays = (now.getTime() - changedAt.getTime()) / 86_400_000;
  return ageDays >= maxAgeDays;
}

/** Sisa hari sebelum password wajib diganti; negatif berarti sudah lewat. */
export function passwordDaysLeft({
  changedAt,
  now = new Date(),
  maxAgeDays = PASSWORD_MAX_AGE_DAYS,
}: Omit<PasswordAgeInput, 'role'>): number {
  if (!changedAt) return 0;
  const ageDays = (now.getTime() - changedAt.getTime()) / 86_400_000;
  return Math.ceil(maxAgeDays - ageDays);
}
