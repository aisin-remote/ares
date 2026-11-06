# Pemetaan integrasi MM → ARES berdasarkan kode VB

Ditinjau 2 November 2026. Sumber: `D:/fabian/00_Project/AI Project/MM/VB for GR.zip` (empat `Form1.vb`) dan berkas `create_*.sql`/master sloc di folder MM, dibandingkan dengan kode ARES. Ini hasil pemeriksaan kode, bukan kontrak SAP yang sudah disahkan atau bukti uji ke SAP. Program VB tidak dijalankan dan database tidak diubah. Workbook contoh data belum dianalisis.

## 1. Kesimpulan untuk implementasi

Jika ARES akan memakai jalur penerimaan yang ditunjukkan VB, tujuan kirim GR adalah **`TT_PURCHASE_RECEIPT_H` dan `TT_PURCHASE_RECEIPT_L`**. PO SAP yang dibaca sebagai referensi adalah **`TT_PO_HEADER` dan `TT_PO_LINE`**. Nama serupa di database ARES tidak berarti struktur kolomnya sama.

Kode VB memakai database **`DB_AIS`**, dan DDL penerimaan/PO yang disertakan juga memakai `DB_AIS.dbo`. Ini belum membuktikan tabel di **`A_DB_STG.dbo`** sudah dibaca program tersebut. Perlu dipastikan apakah staging diteruskan ke DB_AIS, atau VB/SAP akan diarahkan ke staging baru.

```text
Master dan PO MM/SAP → sinkronisasi → master dan PO lokal ARES
Receiving selesai di ARES → TT_SAP_OUTBOX ARES
                         → TT_PURCHASE_RECEIPT_H/L di DB yang disepakati
                         → program penghubung → fungsi SAP
Hasil SAP → pembacaan hasil oleh ARES → status Berhasil / Gagal
```

## 2. Tabel yang dibaca ARES

Baris master/PO berikut adalah usulan pemetaan berdasarkan DDL dan kebutuhan ARES. Arsip VB ini berisi pengirim GR, bukan program pengunduh master/PO dari SAP, sehingga asal dan jadwal pembaruan setiap tabel masih perlu dikonfirmasi.

| Tabel sumber MM | Data yang diambil | Tujuan/pemakaian ARES |
|---|---|---|
| `TM_VENDOR` | `CHR_SUPPLIER_ID`, `CHR_SUPPLIER_NAME`, alamat, flag hapus | `TM_VENDOR.SAP_VENDOR_NO`, nama/alamat dan status supplier. Email akun tetap dikelola Admin/PPIC; tabel ini tidak menyediakan email. |
| `TM_PARTS` | `CHR_PART_NO`, `CHR_PART_NAME`, `CHR_PART_UOM`, flag hapus | `TM_PARTS.SAP_MATERIAL_NO`, nomor tampilan, nama, UOM, status part. Nomor tampilan berdash harus dipetakan terpisah dari material SAP. |
| `TM_VENDOR_PARTS` | pasangan `CHR_SUPPLIER_ID` dan `CHR_PART_NO` | Relasi supplier–part di ARES, setelah kedua master tersedia. Tabel sumber ini tidak menyediakan jumlah per box. |
| `TT_PO_HEADER` | `CHR_PO_NO`, `CHR_SUPPLIER_ID`, `CHR_DOCUMENT_TYPE`, status/hapus/tutup | Cache PO ARES: `SAP_PO_NO` dan referensi supplier. Aturan PO aktif ditentukan setelah arti flag jelas. |
| `TT_PO_LINE` | `CHR_PO_NO`, `CHR_PO_LINENO`, `CHR_PART_NO`, `CHR_PLANT_NO`, `CHR_SLOC`, `CHR_QTY`, `CHR_UNIT` | Item PO dan kecocokan material/plant/UOM. **Belum boleh langsung mengisi `OPEN_QTY` dari `CHR_QTY`** sebelum dipastikan itu sisa PO, bukan jumlah awal. |
| `TM_KANBAN` | part, vendor/work center, back number, jumlah per box, box, rak, sloc | Kandidat pelengkap master vendor part. Bukan untuk menyalin kartu transaksi `TM_KANBAN` ARES. `CHR_WC_VENDOR` perlu dicocokkan ke nomor SAP supplier, tidak diasumsikan sama. |
| `TM_PARTS_SLOC` | pasangan part dan storage location | Referensi lokasi yang diperbolehkan, bila dibutuhkan integrasi. |
| `TM_BOM_SAP` | FG, komponen, level, qty, UOM, phantom, source | Opsional untuk sinkronisasi BOM; pastikan bentuk level dan qty cocok dengan perhitungan konsumsi ARES sebelum impor. |

**Implementasi 3 November 2026 (tombol "Master dari SAP" di layar SAP, job `sap-sync-master`):** supplier dan part yang dipakai `TM_VENDOR_PARTS` staging atau sudah ada di ARES disinkron berdasarkan `CHR_SUPPLIER_ID` / `CHR_PART_NO`; nama, alamat, UOM, dan flag hapus ikut SAP, nomor tampilan part dari `CHR_PART_NO_DASH`. Vendor part hanya dibuat bila belum ada, dengan qty per box/back number/tipe box/rak dari `TM_KANBAN` (`CHR_WC_VENDOR` = kode supplier) lalu `TM_PARTS`; tanpa keduanya dilewati dan dilaporkan. Supplier baru masuk tanpa pabrik dan jadwal cutoff. Vendor part yang hilang dari staging tidak dinonaktifkan.

Catatan transformasi:

- Buang spasi pengisi kolom `char`, tetapi pertahankan nol di depan nomor supplier/material/PO. Item numerik seperti `10` dipetakan konsisten dengan item SAP `00010` di ARES.
- `CHR_QTY` bertipe teks; validasi format angka dan satuannya. Jangan mengubah nilai tidak valid menjadi nol diam-diam.
- **Keputusan pemilik proyek 3 November 2026 (F-44):** PO ditarik tiap tanggal tarik (default 24, diubah Admin/PPIC di layar SAP) untuk order bulan berikutnya. PO yang `CHR_CREATE_DATE`-nya di bulan M berlaku bulan M+1 (menggantikan aturan lama "bulan tanggal dibuat"). Order Sheet memakai PO bulan tanggal kirimnya. `CHR_QTY` disimpan sebagai qty PO (`OPEN_QTY` = `ORDERED_QTY`), dan sisa per item = qty PO − pesanan ARES yang tidak batal (termasuk yang sudah diterima; kekurangan kirim dihitung di recovery). GR di luar ARES (MIGO manual) tidak ikut terhitung.
- Data trial (3 November 2026): 23 baris `TT_PO_LINE` berisi `CHR_QTY` bulat (10, 500, 1.000, 10.000) dan tidak satu pun direferensikan oleh `TT_PURCHASE_RECEIPT_L` (28 nomor PO receipt tidak ada di `TT_PO_LINE`), jadi belum bisa dibuktikan apakah `CHR_QTY` sudah dikurangi GR. Bentuknya mengarah ke qty awal PO. Bila benar, sisa PO = qty PO − GR bersih (101 dikurangi pembatalan 102) dari **semua** jalur GR di SAP, bukan hanya receipt ARES; GR manual (MIGO) tidak tercatat di ARES. Tanyakan ke tim SAP apakah staging bisa menyediakan qty sudah GR / sisa per item (mis. dari riwayat PO SAP).
- PPIC menetapkan PO bulanan (2026-11-02): berlaku awal sampai akhir bulan; partial/recovery lintas bulan memakai PO bulan pengiriman lanjutan, dengan base nomor Order Sheet tetap. ARES memeriksa `VALID_FROM`/`VALID_TO` sebagai periode bulanan dan menolak periode kosong/lintas bulan. DDL PO ini tidak menyediakan kolom periode yang setara: sumber bulan PO dari SAP masih perlu dikonfirmasi; jangan memakai tanggal dibuat/sinkronisasi sebagai pengganti tanpa kesepakatan.
- Master sumber memiliki beberapa kandidat jumlah per box (`TM_PARTS`, `TM_KANBAN`). Tetapkan sumber utama agar sinkronisasi tidak menimpa pengaturan supplier/kemasan secara keliru.
- Sinkron supplier tidak boleh membatasi PPIC memesan berdasarkan plant supplier. Plant order tetap mengikuti plant Aisin yang membuat order.

## 3. Tabel yang diisi ARES untuk GR

**Diisi otomatis setelah penerimaan selesai, melalui worker outbox; bukan saat Order Sheet baru diterbitkan.** Kedua tabel harus lengkap dalam satu transaksi database agar program VB tidak mengambil header tanpa detail.

### Header: `TT_PURCHASE_RECEIPT_H`

Kunci DDL: `(CHR_PDS_NO, INT_PDS_PROCSEQ)`.

| Kolom MM | Usulan sumber/aturan ARES | Bukti atau batasan |
|---|---|---|
| `CHR_PDS_NO` | Nomor Order Sheet tampilan lengkap 12 digit `PYYMMDDNNNRR` | VB mengirimnya sebagai `ZPDS` dan `ZREF_DOC_NO`. Harus mempertahankan aturan 7/8/9 dan RR milik ARES. |
| `INT_PDS_PROCSEQ` | Nomor proses/recovery menurut kontrak integrasi | VB mengirim sebagai `ZRECOVERY`; **belum terbukti identik dengan RR ARES**. Default header DDL 1, default detail 0; harus diisi eksplisit dan konsisten. |
| `CHR_REQ_DATE` | Tanggal posting GR ARES, format `yyyyMMdd`, setelah disepakati | VB memakai kolom ini sebagai `ZPSTNG_DATE`; jangan otomatis menyalin tanggal delivery dari nomor Order Sheet. |
| `CHR_CREATE_DATE` | Tanggal dokumen yang disepakati, format `yyyyMMdd` | VB receipt biasa mengambil ini untuk `ZDOC_DATE`. |
| `CHR_PONO_R3` | Nomor PO SAP terkait | Header dan detail sama-sama punya kolom ini. Lihat catatan multi-PO di bawah. |
| `CHR_SUPPLIER_ID`, `CHR_SUPPLIER_NAME` | Nomor SAP supplier dan nama supplier | Ada di DDL, bukan kolom yang langsung dikirim oleh jalur receipt biasa dalam VB ini. |
| `CHR_UPLOAD` | `'0'` saat GR lengkap dan siap diambil | Seleksi pertama receipt biasa hanya mengambil nilai `'0'`. Ini adalah syarat terbukti, bukan definisi semua status flag. |
| `CHR_FLG_DEL` | `'0'` untuk GR baru; `'1'` sebagai permintaan pembatalan jika alur cancel dipakai | Jalur cancel memeriksa nilai `'1'` bersama nomor/tahun dokumen SAP asli. |
| `CHR_REMARKS` | Referensi receipt/catatan yang disepakati, maksimal 30 karakter | VB mengirim sebagai `ZREMARKS`. Tidak membuktikan kolom ini dipakai SAP untuk pencegahan duplikat. |
| Tanggal/jam dan user lain | Metadata ARES sesuai kontrak | Tidak semua kolom ini dibaca langsung oleh VB. |

### Detail: `TT_PURCHASE_RECEIPT_L`

Kunci DDL: `(CHR_PDS_NO, INT_PDS_PROCSEQ, INT_PDS_LINENO, CHR_PART_NO)`.

| Kolom MM | Usulan sumber/aturan ARES | Bukti atau batasan |
|---|---|---|
| `CHR_PDS_NO`, `INT_PDS_PROCSEQ` | Sama persis dengan header | Digunakan untuk join oleh receipt biasa. |
| `INT_PDS_LINENO` | Nomor baris unik dalam dokumen | Bagian dari primary key; berbeda dari nomor item PO. |
| `CHR_PART_NO` | Material SAP dari part ARES | Dikirim sebagai `ZMATERIAL`. |
| `INT_RECQTY` | Jumlah aktual diterima dalam satuan yang sesuai PO | Dikirim sebagai `ZENTRY_QNT`. Untuk part PC, gunakan pcs aktual, bukan jumlah kanban/box. |
| `INT_SUM_RECQTY` | Jumlah akumulasi sesuai definisi SAP | Dikirim sebagai `ZSUMENTRY_QNT`, tetapi rumus pembentukannya tidak ada di VB. Jangan diasumsikan selalu sama dengan `INT_RECQTY`. |
| `CHR_PONO_R3` | PO SAP pada baris order ARES | Dikirim sebagai `ZPO_NUMBER`; nomor order ARES bukan nomor PO SAP. |
| `CHR_PONO_LINE_R3` | Item PO SAP pada baris order ARES | Dikirim sebagai `ZPO_ITEM`. |
| `CHR_SER_NO`, `CHR_BATCH_NO`, `CHR_INV_NO`, `CHR_BACK_NO` | Serial, batch, invoice, back number sesuai kebutuhan material | Semua dibaca VB. Kebutuhan wajib/kosong dan sumbernya belum dipastikan; jangan membuat nilai fiktif. |
| `CHR_RECEIPT_BOX`, `CHR_RECEIPT_PART` | Informasi box/pcs tambahan jika diwajibkan sistem lama | Ada di DDL tetapi tidak dipakai langsung untuk `ZENTRY_QNT` di VB receipt biasa. |

Jumlah pada DDL bertipe `float`, tetapi variabel VB receipt bertipe `Integer`. UOM dan material yang memakai angka desimal perlu diuji/ditangani khusus. ARES saat ini juga memvalidasi qty GR sebagai bilangan bulat positif.

## 4. Hasil SAP yang perlu dibaca kembali

Pada header tersedia:

- `CHR_RPTNO_R3` dan `CHR_RPTNO_R3_Y`: nomor dan tahun material document asli, benar-benar dibaca jalur cancel.
- `CHR_RPTNO_R3_DEL` dan `CHR_RPTNO_R3_DEL_Y`: kandidat hasil dokumen pembatalan; kekosongannya menjadi syarat pemilihan cancel.
- `CHR_ERROR_FLAG_R3`, `CHR_ERROR_MSG_R3`, `CHR_UPLOAD`, `CHR_FLG_INS_R3`: kolom status/error yang ada di DDL.

**VB yang diberikan tidak memperlihatkan kode yang memperbarui hasil sukses/error ini.** VB memanggil fungsi SAP kustom, sehingga kode ABAP atau proses penulis balik hasil masih diperlukan untuk memastikan siapa yang mengisi kolom, nilai flag sukses/gagal, dan kapan hasil dinyatakan final.

Setelah insert staging berhasil, status ARES baru **STAGED**, belum **POSTED/Berhasil di SAP**. Perlu pembaca hasil dan penyimpanan nomor **serta tahun** dokumen SAP. Antarmuka gateway ARES saat ini baru menyediakan `sapDocNumber`, belum kolom tahun tersendiri.

## 5. Pembatalan

`VB_RDS_CANCEL/rds cancel/Form1.vb` baris 42–78 memanggil `ZZBAPI_GOODSMVT_CANCEL` apabila:

1. `CHR_FLG_DEL = '1'`.
2. Nomor dan tahun material document asli sudah berisi nilai bukan spasi.
3. Kedua kolom dokumen pembatalan masih spasi atau keduanya NULL.

Yang dikirim: PDS, recovery/procseq, PO, nomor material document, tahun material document, dan tanggal posting pembatalan.

Tidak ada literal movement type `102` pada pemanggilan cancel ini. ARES memiliki outbox `GR_REVERSAL` dengan movement `102`; adaptornya perlu menerjemahkan permintaan tersebut ke kontrak cancel yang disepakati, bukan langsung membuat receipt 101 baru.

Join cancel hanya memakai PDS dan PO, tidak memasukkan `INT_PDS_PROCSEQ`, lalu memanggil SAP per hasil join detail. Pada beberapa baris/recovery ada risiko pemanggilan berulang atau baris tercampur; ini perlu diperbaiki/ditangani oleh penghubung sebelum dipakai ARES. Jangan menganggap fungsi SAP sudah idempoten tanpa melihat implementasinya.

## 6. Tabel lain: tidak wajib diisi untuk jalur GR ini

| Tabel | Hasil pemeriksaan |
|---|---|
| `TT_PURCHASE_ORDER_H/L` | Berdasarkan kolomnya menyimpan PDS/order sistem lama. Tidak dibaca empat `Form1.vb` ini. Belum ada bukti wajib diisi untuk GR; fungsi SAP kustom masih mungkin bergantung padanya dan perlu diperiksa. Jangan disamakan dengan `TT_PO_HEADER/LINE`. |
| `TT_GOODS_MOVEMENT_H/L` | Dipakai program ELISA untuk jenis `SUBC`, `RTRN`, `STLT`, `VCLM`, `CKIP`, dengan header `CHR_VALIDATE='X'` dan detail `CHR_UPLOAD='0'`. Jalur berbeda dari receipt PO. DDL pasangan ini tidak disertakan dalam folder MM. |
| `TT_ORDER_COIL_UPLOAD` | Dipakai receipt slitting untuk PO bertipe `ZPOS`, menghitung berat dan batch. DDL tidak tersedia; di luar GR supplier part biasa sampai scope slitting disepakati. |
| `TT_ERR_LOG_INTERFACE` | Ditulis program ELISA/slitting saat error lokal. Bukan tabel untuk membuat GR ARES. DDL tidak disertakan. |
| `TM_VENDOR_STOCK`, `TT_PARTS_SLOC` | Kandidat data stok pembanding. Jangan menimpa buku mutasi stok ARES langsung dari snapshot ini. |
| `TM_PART_SUBCONT` | Referensi subcont, di luar kebutuhan GR supplier biasa. |
| `TM_MATDOC_IP_H/L` | Berdasarkan DDL terkait material document CKD/IP. Tidak dibaca program receipt/cancel ini; belum terbukti sumber hasil GR ARES. |
| `PRD.TT_ELINA_H/L` | Tabel persiapan/kirim kebutuhan produksi; bukan tabel tujuan GR dalam VB ini. |

## 7. Perbedaan yang harus diselesaikan sebelum tersambung

1. **Database — terjawab 3 November 2026:** `A_DB_STG` adalah tabel penghubung milik tim SAP. ARES hanya membaca/menulis `A_DB_STG`; program VB yang memindahkan data antara staging dan SAP asli (`DB_AIS` di kode VB lama akan diarahkan ke staging). ARES tidak pernah memanggil SAP langsung.
2. **Nomor Order Sheet:** receipt biasa hanya memilih `D%` (baris 64–70), slitting hanya `S%` (106–109). Nomor ARES `7/8/9` tidak akan diproses apa adanya. Sesuaikan pemilih dokumen penghubung tanpa mengubah aturan nomor ARES.
3. **Plant dan lokasi:** receipt biasa/slitting mengirim literal `600` dan `WH00`. Kode 7/8/9 pada nomor ARES bukan otomatis kode plant SAP. Perlu pemetaan BODY/UNIT/ELECTRIC yang disepakati.
4. **Recovery dan identitas:** tetapkan hubungan RR, procseq dan delivery sequence. Pada slitting, detail bahkan disaring dengan `INT_PDS_DELNO = RECOVERY` sekaligus `INT_PDS_PROCSEQ = RECOVERY`. Jangan menyalin default DDL tanpa aturan.
5. **Multi-PO:** ARES menyimpan PO per item, sementara header lama hanya punya satu PO. Receipt biasa memakai `SELECT *` join dengan nama kolom berulang, lalu `reader("CHR_PONO_R3")`; jangan mengandalkannya untuk memilih PO detail. Tentukan pemisahan per PO atau perbaiki pemilihan kolom dan kontrak fungsi SAP.
6. **Jumlah:** pastikan arti `CHR_QTY`, rumus `INT_SUM_RECQTY`, satuan dan konversi. Sisa PO tidak tersedia secara tegas dari nama kolom saja.
7. **Hasil SAP dan anti-duplikat:** minta kode/kontrak `ZZBAPI_GOODSMVT_CREATE` dan `ZZBAPI_GOODSMVT_CANCEL`, penulis balik hasil, dan kunci dokumen unik. Jadwal eksekusi VB tidak tampak di sumber ini; `Sleep(500)` bukan interval scheduler.
8. **ARES belum memiliki adaptor nyata:** `MssqlStagingGateway.send()` masih melempar error belum diimplementasikan. Worker SAP yang ada menangani collect/flush outbox; nama job sinkron PO/master ada, tetapi handler sinkron dan pembaca hasil staging belum ditemukan pada jalur SAP saat pemeriksaan.

Langkah implementasi setelah kontrak jelas: sinkron master/PO → validasi pemetaan → insert header/detail GR idempoten → baca hasil SAP → dukung pembatalan → uji satu receipt dan retry tanpa duplikat. Uji juga multi-item, multi-PO, recovery, jumlah kurang, serta pembatalan.

### Konfigurasi koneksi ARES (2 November 2026)

ARES sekarang menyediakan driver MSSQL dan koneksi lazy dengan nama environment `STAGING_*`, mengikuti pola Avicenna MES. Kredensial disimpan hanya di `.env` lokal yang diabaikan Git. Template tanpa kredensial ada di `.env.example`.

- Pilih `SAP_GATEWAY=mssql` untuk memakai mode staging dan menghentikan penyelesaian simulasi dengan nomor `FAKE-*`.
- `STAGING_PUSH_ENABLED=false` menjaga pengiriman outbox nonaktif. Variabel lama `SAP_MSSQL_ENABLED` tidak lagi dipakai.
- `STAGING_PULL_ENABLED=false` disiapkan sebagai saklar tarik terpisah. Handler sinkron PO/master belum diimplementasikan; mengubahnya ke true belum membuat sinkronisasi berjalan.
- Perintah `pnpm --filter @ares/api staging:check` hanya menjalankan SELECT untuk memeriksa database aktif dan keberadaan delapan tabel utama. Boleh dijalankan saat push/pull false karena tidak mengimpor data atau mengirim GR.
- Koneksi tidak dibuka otomatis saat API start. Perubahan `.env` perlu restart API yang sudah berjalan.
- Koneksi berhasil tidak berarti kontrak kolom/flag telah cocok. Penulisan GR dan pembacaan hasil tetap menunggu implementasi berdasarkan kontrak tersebut.

Hasil uji lokal 2 November 2026: koneksi ke `172.18.3.19:1433`, database `aisinbisa_sap_stagging`, berhasil memakai SQL Server Authentication setelah password diperbaiki. Delapan tabel ditemukan pada schema `dbo`: `TM_VENDOR`, `TM_PARTS`, `TM_VENDOR_PARTS`, `TM_KANBAN`, `TT_PO_HEADER`, `TT_PO_LINE`, `TT_PURCHASE_RECEIPT_H`, dan `TT_PURCHASE_RECEIPT_L`. Pemeriksaan hanya membaca identitas database dan metadata tabel; isi data serta kontrak kolom belum divalidasi melalui tes ini. Push/pull tetap false dan API direstart untuk memuat konfigurasi baru.

Pemeriksaan 3 November 2026 (hanya SELECT metadata): server yang sama memuat **dua** database staging. `aisinbisa_sap_stagging` (dibuat 8 September) berisi data, antara lain 19 `TT_PO_HEADER`, 55 `TT_PURCHASE_RECEIPT_H`, 120 `TT_EKANBAN_ORDER` dengan perubahan terakhir 19 Oktober, serta tiga tabel tambahan (`TM_PES_PART`, `TT_EKANBAN_ORDER`, `PRD.TT_COGI`). `A_DB_STG` (dibuat 18 September) memiliki skema yang sama, tetapi kosong kecuali 13 baris `TT_PRODUCTION_RESULT`. `DB_AIS` tidak ada di server ini. Keputusan pemilik proyek 3 November 2026: **database tujuan ARES adalah `A_DB_STG`**; `aisinbisa_sap_stagging` adalah database trial tim SAP dan tidak dipakai ARES. `.env` lokal sudah dipindah dan `staging:check` terhadap `A_DB_STG` lolos (delapan tabel utama ada). Pada hari yang sama data trial disalin ke `A_DB_STG` atas permintaan pemilik proyek: tiga tabel yang belum ada dibuat (`TM_PES_PART`, `TT_EKANBAN_ORDER`, `PRD.TT_COGI`), tujuh kolom ditambahkan ke `TT_GOODS_MOVEMENT_H/L` (`CHR_PLANT_TO`, `CHR_PGI_DOC/YEAR/STATUS`, `CHR_GR_DOC/YEAR/STATUS`), dan 37 dari 38 tabel kini identik isinya. Pengecualian: `TT_PRODUCTION_RESULT` ID 3–15 tetap berisi data uji Avicenna MES 26 Oktober; 13 baris trial dengan ID yang sama tidak disalin. Data ini adalah data trial, bukan data SAP sungguhan.

`TT_EKANBAN_ORDER` dan `TT_EKANBAN_CUST` tidak disentuh keempat program VB (source, konfigurasi, dan exe/dll diperiksa 3 November 2026), tidak ada di DDL folder MM, dan tidak ada di workbook sampel. Isi trial `TT_EKANBAN_ORDER` (120 baris) ditulis `CHR_CREATE_PC = 'sap'` pada 19 Oktober: satu customer `0010`, satu PDS, part customer `69201-0K040`, dock `43`. Bentuknya order e-kanban **customer** (sisi penjualan), bukan order ke supplier, sehingga bukan sumber data ARES. Penulisnya kemungkinan interface SAP sendiri; perlu dikonfirmasi ke tim SAP.

Driver memakai `mssql` 11.0.1 agar kompatibel dengan Node 20 lokal. Versi 12.7.2 yang dicoba seperti Avicenna menarik Tedious 20 yang membutuhkan Node 22 dan gagal sebelum autentikasi; versi tersebut tidak dipakai pada hasil akhir ARES.

Autentikasi ARES ditetapkan eksplisit ke `authentication.type = 'default'` (SQL Server Authentication pada Tedious), dengan username/password, tanpa domain NTLM. Penolakan login sebelumnya sudah teratasi setelah pemilik proyek mengoreksi password di konfigurasi Avicenna MES dan password lokal ARES disamakan. Kredensial tidak dicatat dalam dokumentasi.

## 8. Jejak sumber

Nomor baris berikut merujuk isi arsip asli; salinan tinjauan lokal mempertahankan nomor baris dan menyembunyikan connection string.

- `VB_RECEIPT/WindowsApplication9/Form1.vb`: 61–103 (fungsi SAP, tabel, filter, join), 115–157 (kolom dan parameter).
- `VB_RDS_CANCEL/rds cancel/Form1.vb`: 42–78 (fungsi cancel, flag, nomor/tahun dokumen).
- `VB_RECEIPT_SLITTING/WindowsApplication9/Form1.vb`: 106–143 (pemilihan header, tipe PO, detail), 157–208 (coil/batch/berat), 222–246 (GR biasa dalam slitting).
- `VB_GOODS_MOVEMENT_ELISA/WindowsApplication9/Form1.vb`: 72–103 (tabel dan tipe transaksi), 112–150 (parameter pengiriman), 243–246 (log error). Cabang FGDL/DLFG/NOFG/NODL ada di bawahnya, tetapi tidak lolos filter query aktif di file tersebut.
- DDL MM: `create_receive_header.sql`, `create_receive_line.sql`, `create_po_sap_header.sql`, `create_po_sap_line.sql`, dan berkas master yang namanya tercantum pada tabel di atas.
- ARES: `apps/api/src/sap/sap.gateway.ts`, `sap-outbox.service.ts`, `sap-writer.service.ts`, `sap.worker.ts`; `apps/api/src/receiving/receiving.service.ts`; `packages/db/src/schema/master.ts`; `packages/domain/src/sap.ts`.

Tidak menjalankan VB/RFC SAP, tidak menguji database aktif, dan belum membaca kode fungsi SAP kustom. Karena itu nama tabel dan pembacaan yang terlihat di VB dapat dipastikan, tetapi keberhasilan posting, seluruh ketergantungan ABAP, serta kontrak status akhir belum dapat dipastikan.
