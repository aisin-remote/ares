import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// .env tunggal ada di root repo; Next hanya membaca apps/web/.env. Dimuat di
// sini supaya API_URL dkk. sudah ada sebelum modul server mana pun dievaluasi.
// ponytail: process.loadEnvFile = Node >= 20.12, tanpa dotenv.
const rootEnv = join(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Docker on-prem: keluarkan server mandiri, tidak perlu node_modules penuh.
  output: 'standalone',
  outputFileTracingRoot: '../../',
  reactStrictMode: true,
  poweredByHeader: false,
  // mysql2 tidak boleh ikut di-bundle; biarkan di-require saat runtime server.
  serverExternalPackages: ['mysql2'],
  /*
   * Hanya berpengaruh saat `next dev`.
   *
   * Next 16 memblokir permintaan resource dev dari host yang berbeda dengan
   * yang dipakai server. Membuka aplikasi lewat 127.0.0.1 atau lewat IP mesin
   * (dari tablet di lantai produksi, misalnya) membuat chunk klien tidak
   * pernah dimuat: halaman tetap tampil karena dirender di server, tetapi
   * TIDAK terhidrasi — tombol dan formulir diam saja tanpa pesan error apa pun.
   * Gejalanya menyesatkan, jadi host-host ini diizinkan sejak awal.
   */
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ];
    if (process.env.NODE_ENV === 'production') {
      headers.push(
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'", "base-uri 'self'", "form-action 'self'",
            "frame-ancestors 'none'", "object-src 'none'", "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
            "font-src 'self' data:", "connect-src 'self'", "worker-src 'self' blob:",
            'upgrade-insecure-requests',
          ].join('; '),
        },
      );
    }
    return [{ source: '/(.*)', headers }];
  },
};

export default config;
