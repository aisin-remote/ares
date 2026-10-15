/**
 * Penulis ZIP seadanya: satu arsip berisi beberapa berkas, metode `store`
 * (tanpa kompresi).
 *
 * Sengaja tidak menambah dependensi (aturan repo 12). Isi arsipnya PDF dan CSV
 * kecil — PDF sudah terkompresi di dalamnya, jadi deflate hanya menambah CPU
 * di request tanpa mengecilkan apa pun yang berarti. Formatnya format ZIP
 * baku: local header + central directory + EOCD, dibuka Windows Explorer,
 * 7-Zip, maupun macOS tanpa perlakuan khusus.
 *
 * Batasnya: tidak ada ZIP64, jadi arsip dan tiap berkasnya harus < 4 GB —
 * jauh di atas ukuran dokumen satu Order Sheet. Kalau suatu saat perlu
 * mengemas ratusan order sekaligus, ganti dengan pustaka yang mendukung
 * ZIP64 dan streaming.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Jam MS-DOS: detik dibulatkan ke kelipatan dua, tahun dihitung dari 1980. */
function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (Math.floor(at.getSeconds() / 2) & 0x1f),
    date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function buildZip(entries: readonly ZipEntry[], at = new Date()): Buffer {
  const { time, date } = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versi minimum
    local.writeUInt16LE(0x0800, 6); // nama berkas UTF-8
    local.writeUInt16LE(0, 8); // metode: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // versi pembuat
    central.writeUInt16LE(20, 6); // versi minimum
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // komentar
    central.writeUInt16LE(0, 34); // nomor disk
    central.writeUInt16LE(0, 36); // atribut internal
    central.writeUInt32LE(0, 38); // atribut eksternal
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + entry.data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // nomor disk
  end.writeUInt16LE(0, 6); // disk awal direktori
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // komentar arsip

  return Buffer.concat([...locals, directory, end]);
}
