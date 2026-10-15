# Keamanan produksi ARES

Dokumen ini adalah pagar minimum sebelum ARES dibuka dari internet. Keamanan
bukan keadaan sekali jadi: patch, pemantauan, backup, dan uji pemulihan tetap
harus dijalankan selama sistem dipakai.

## Arsitektur yang diizinkan

```text
Internet / jaringan supplier
          |
       HTTPS 443
          |
   Nginx/Caddy + rate limit
      |              |
 Next.js :3000    Nest API :3001
      |              |
 user DB SELECT   user DB aplikasi
      \              /
     MySQL + Valkey (loopback/private network saja)
```

- Hanya reverse proxy yang boleh menerima trafik publik. Port 3000, 3001,
  3306, dan 6379 tidak boleh terbuka di firewall publik.
- `API_HOST=127.0.0.1`. Next.js, API, MySQL, dan Valkey dijalankan sebagai user
  Linux non-root yang berbeda dari user SSH administrator.
- TLS wajib. `WEB_ORIGIN` harus origin HTTPS yang persis, tanpa wildcard.
- ARES saat ini satu pabrik per instalasi. Tabel MES dan antrean order belum
  memiliki `PLANT_ID`; jangan memakai satu database untuk beberapa pabrik.

Contoh reverse proxy ada di [`deploy/nginx/ares.conf`](../deploy/nginx/ares.conf).

## Secret dan akun awal

1. Buat `.env` di server dengan permission `0600`; jangan commit atau kirim
   lewat chat/tiket.
2. Buat `JWT_SECRET` dan `TOTP_ENCRYPTION_KEY` yang berbeda, masing-masing
   dengan `openssl rand -base64 48`. Buat password admin awal acak minimal 15
   karakter. `NODE_ENV=production` menolak secret contoh atau kunci TOTP yang
   tidak diisi.
3. Isi `ADMIN_INITIAL_PASSWORD` hanya saat seed pertama. Setelah admin bisa
   login, hapus variabel itu dari `.env` dan ganti password dari layar user.
4. Token display dibuat acak minimal 32 karakter, dipakai sekali untuk pairing,
   lalu dihapus dari `.env`. Nonaktifkan device di database bila perangkat hilang.
5. Putar `JWT_SECRET`, token MES, SMTP, SAP, dan password database setelah
   dugaan kebocoran. Mengganti `JWT_SECRET` langsung mencabut seluruh sesi.
   Simpan cadangan `TOTP_ENCRYPTION_KEY` di penyimpanan secret yang aman.
   Jangan menggantinya tanpa proses daftar ulang Google Authenticator karena
   secret akun supplier yang lama tidak akan bisa dibaca.

Jangan memakai `SEED_DEMO=on`, `SAP_GATEWAY=fake`, atau `MES_GATEWAY=fake` pada
produksi nyata.

## Hak database

Gunakan tiga akun MySQL:

- `ares_migrate`: DDL, hanya dipakai saat migrasi lalu kredensialnya dilepas;
- `ares_api`: SELECT/INSERT/UPDATE/DELETE pada schema ARES;
- `ares_web`: SELECT saja, dipasang pada `WEB_DATABASE_URL`.

Jangan beri `GRANT OPTION`, `FILE`, `PROCESS`, `SUPER`, atau akses ke schema
lain. Karena `TM_USER` memuat hash password, berikan `ares_web` hak SELECT per
kolom untuk tabel itu dan hak SELECT tabel untuk tabel lain. Contoh:

```sql
CREATE USER 'ares_api'@'127.0.0.1' IDENTIFIED BY '<acak-panjang>';
CREATE USER 'ares_web'@'127.0.0.1' IDENTIFIED BY '<acak-panjang-lain>';
GRANT SELECT, INSERT, UPDATE, DELETE ON ares.* TO 'ares_api'@'127.0.0.1';

-- Untuk setiap tabel selain TM_USER:
GRANT SELECT ON ares.<NAMA_TABEL> TO 'ares_web'@'127.0.0.1';
GRANT SELECT (ID,NPK,NAME,EMAIL,ROLE_ID,PLANT_ID,VENDOR_ID,IS_ACTIVE,CREATED_AT,UPDATED_AT)
  ON ares.TM_USER TO 'ares_web'@'127.0.0.1';
```

Gunakan host private yang tepat bila database berada di mesin terpisah. Wajibkan
TLS MySQL pada koneksi lintas host. Backup dienkripsi, disimpan di lokasi lain,
dan restore diuji berkala. Akses backup mengikuti hak administrator database.

## Server dan jaringan

- Firewall: buka 443; buka 22 hanya dari VPN/IP admin. Tutup login SSH root dan
  password, gunakan key, Fail2ban, dan pembaruan keamanan otomatis.
- Jalankan proses lewat systemd/container dengan restart policy, filesystem
  sesedikit mungkin writable, dan log yang dirotasi. Direktori PDF hanya boleh
  dibaca user API dan reverse proxy yang membutuhkannya.
- Valkey wajib berada di loopback/private network. Bila lintas host, aktifkan
  ACL, TLS, dan password; jangan pernah mengekspos 6379 ke internet.
- Batasi ukuran request di proxy dan API. Upload BOM dibatasi 2 MiB, format
  `.xlsx`, 20.000 baris, dan 20 kolom.

## Hak aplikasi

- Semua endpoint API tertutup secara default. Endpoint baru wajib memakai
  `@RequirePermission`, `@Authenticated`, atau `@Public` yang disengaja.
- Hak user dibaca ulang dari database pada setiap request. Menonaktifkan user,
  mengubah role, atau menonaktifkan device berlaku pada request berikutnya.
- Supplier selalu dibatasi oleh `vendorId`; picklist, receipt, stok, dokumen,
  dan outbox juga dibatasi `plantId` dari sesi.
- API hanya menerima Bearer token pada header. Token tidak diterima dari query
  string. Browser menyimpan token di cookie HttpOnly, Secure, SameSite=Lax.
- Login dibatasi per akun dan per IP di API, ditambah batas global di proxy.

Tinjau matriks `TM_PERMISSION` setelah seed dan setiap perubahan role. Berikan
`user.write`, `setting.write`, `picklist.override`, `receipt.cancel`, serta hak
SAP hanya kepada petugas yang memang membutuhkannya.

## Operasi rutin

- Pantau 401/403/429, login berulang, lonjakan 5xx, GR gagal, perubahan user,
  pembatalan, override shipment, dan retry outbox. Simpan log terpusat dengan
  retensi yang disetujui perusahaan.
- Jangan log password, token, isi `.env`, header Authorization, atau dump payload
  mentah. Produksi tanpa SMTP juga tidak menulis alamat/isi email ke log.
- Patch OS, Node.js LTS, image MySQL/Valkey, dan dependency npm secara terjadwal.
  Jalankan di CI: `pnpm install --frozen-lockfile`, `pnpm audit --prod`,
  `pnpm typecheck`, `pnpm test`, dan `pnpm build`.
- Probe `/health` hanya memeriksa proses. `/health/ready` memberi HTTP 503 saat
  database atau Valkey gagal dan tidak membocorkan pesan koneksi.

## Respons insiden

1. Putuskan akses publik atau blokir sumber serangan di proxy/firewall.
2. Simpan log dan snapshot untuk investigasi; jangan mengubah bukti lebih dulu.
3. Cabut user/device terdampak dan putar secret terkait.
4. Periksa `TT_AUDIT_LOG`, log reverse proxy, log API, serta perubahan database.
5. Pulihkan dari backup bersih bila integritas data tidak dapat dibuktikan.
6. Catat akar masalah, rentang data terdampak, perbaikan, dan uji regresinya.

## Checklist sebelum go-live

- [ ] Domain HTTPS valid; HTTP dialihkan ke HTTPS.
- [ ] Hanya 22 terbatas dan 443 yang terlihat dari internet.
- [ ] Port aplikasi, MySQL, dan Valkey tidak dapat dijangkau dari internet.
- [ ] Secret/password produksi unik; nilai seed dan demo sudah dibuang.
- [ ] `TOTP_ENCRYPTION_KEY` tersimpan aman dan berbeda dari `JWT_SECRET`.
- [ ] `ares_web` terbukti tidak bisa INSERT/UPDATE/DELETE atau membaca PASSWORD_HASH.
- [ ] Role supplier hanya melihat vendor dan pabriknya sendiri.
- [ ] Backup terenkripsi dan uji restore berhasil.
- [ ] Rate limit login menghasilkan 429 pada percobaan berlebih.
- [ ] Header HSTS, CSP, frame denial, nosniff, dan referrer policy terlihat.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, dan audit dependency lulus.
- [ ] Pemantauan, alert, rotasi log, patching, dan kontak insiden aktif.
