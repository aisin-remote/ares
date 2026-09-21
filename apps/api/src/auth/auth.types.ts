/** Isi token untuk pengguna manusia. */
export interface UserPrincipal {
  kind: 'user';
  sub: number;
  npk: string;
  name: string;
  role: string | null;
  plantId: number | null;
  /** Terisi untuk akun supplier; null untuk akun internal (lihat TM_USER). */
  vendorId: number | null;
}

/** Isi token untuk terminal/scanner. Sengaja dibedakan dari user. */
export interface DevicePrincipal {
  kind: 'device';
  sub: number;
  code: string;
  plantId: number | null;
}

export type Principal = UserPrincipal | DevicePrincipal;

declare module 'express' {
  interface Request {
    principal?: Principal;
  }
}
