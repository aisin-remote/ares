import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Secret 160 bit yang kompatibel dengan Google Authenticator. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpUri(secret: string, account: string, issuer = 'ARES'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Kode berubah tiap 30 detik; dipisah agar vektor RFC dan alur API bisa diuji. */
export function totpCode(secret: string, at = new Date()): string {
  const counter = BigInt(Math.floor(at.getTime() / 1000 / 30));
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(input).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const number = (
    ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff)
  ) % 1_000_000;
  return String(number).padStart(6, '0');
}

/** Toleransi satu langkah sebelum/sesudah untuk selisih jam perangkat. */
export function verifyTotp(secret: string, code: string, at = new Date()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const actual = Buffer.from(code);
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totpCode(secret, new Date(at.getTime() + offset)));
    if (timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

/** Secret TOTP harus bisa dibaca saat login, jadi disimpan terenkripsi AES-GCM. */
export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptTotpSecret(value: string): string {
  const [version, iv, tag, encrypted] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Format secret TOTP tidak valid');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptionKey(): Buffer {
  const source = process.env.TOTP_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET;
  if (!source) throw new Error('TOTP_ENCRYPTION_KEY atau JWT_SECRET belum dikonfigurasi');
  return createHash('sha256').update(source).digest();
}

function base32Encode(input: Buffer): string {
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    output += BASE32[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = '';
  for (const char of input.replace(/=+$/u, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Secret TOTP bukan base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
