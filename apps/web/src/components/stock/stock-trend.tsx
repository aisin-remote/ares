import { Activity, TrendingUp } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';

/**
 * Grafik tren Stok WH (F-41): saldo akhir hari dan arus masuk/keluar harian.
 *
 * SVG murni di server — tanpa pustaka grafik. Tooltip memakai `<title>` bawaan
 * browser pada kolom per hari.
 * ponytail: tooltip native muncul lambat dan tanpa gaya; ganti dengan tooltip
 * klien bila PPIC butuh membaca angka sambil menggeser kursor.
 */
export interface StockDay {
  tanggal: string;
  masuk: number;
  keluar: number;
  saldo: number;
}

const W = 640;
const H = 220;
const PAD = { left: 52, right: 12, top: 12, bottom: 28 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

const angka = (n: number) => n.toLocaleString('id-ID');
const tglLabel = (t: string) =>
  new Date(`${t}T12:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Skala y "rapi": batas dibulatkan ke kelipatan 1/2/5 × 10ⁿ, 4 garis bantu. */
function skalaY(min: number, max: number) {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max, lo + 1);
  const kasar = (hi - lo) / 4;
  const p = 10 ** Math.floor(Math.log10(kasar));
  // Pcs selalu bulat: langkah minimal 1.
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * p).find((s) => s >= kasar)!);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(v);
  return { ticks, y: (v: number) => PAD.top + plotH - ((v - a) / (b - a)) * plotH };
}

function Kerangka({
  data,
  ticks,
  y,
  children,
  label,
}: {
  data: StockDay[];
  ticks: number[];
  y: (v: number) => number;
  children: React.ReactNode;
  label: string;
}) {
  const kolom = plotW / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
            className={t === 0 ? 'stroke-line-strong' : 'stroke-line'}
            strokeWidth={1}
          />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px] tabular">
            {angka(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) =>
        i % 7 === (data.length - 1) % 7 ? (
          <text
            key={d.tanggal}
            x={PAD.left + kolom * (i + 0.5)}
            y={H - 8}
            textAnchor="middle"
            className="fill-ink-muted text-[11px]"
          >
            {tglLabel(d.tanggal)}
          </text>
        ) : null,
      )}
      {children}
      {/* Area sentuh per hari, lebih lebar dari tandanya. */}
      {data.map((d, i) => (
        <rect
          key={d.tanggal}
          x={PAD.left + kolom * i}
          y={PAD.top}
          width={kolom}
          height={plotH}
          className="fill-transparent hover:fill-ink/5"
        >
          <title>
            {`${tglLabel(d.tanggal)} · masuk ${angka(d.masuk)} · keluar ${angka(d.keluar)} · saldo ${angka(d.saldo)} pcs`}
          </title>
        </rect>
      ))}
    </svg>
  );
}

export function StockTrend({ data }: { data: StockDay[] }) {
  const kolom = plotW / data.length;
  const x = (i: number) => PAD.left + kolom * (i + 0.5);

  const saldo = skalaY(Math.min(...data.map((d) => d.saldo)), Math.max(...data.map((d) => d.saldo)));
  const garis = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${saldo.y(d.saldo)}`).join('');
  const area = `${garis}L${x(data.length - 1)},${saldo.y(0)}L${x(0)},${saldo.y(0)}Z`;
  const akhir = data.at(-1)!;

  const arus = skalaY(-Math.max(...data.map((d) => d.keluar)), Math.max(...data.map((d) => d.masuk)));
  const lebar = Math.max(2, kolom - 4);
  const totalMasuk = data.reduce((s, d) => s + d.masuk, 0);
  const totalKeluar = data.reduce((s, d) => s + d.keluar, 0);

  return (
    <div className="mb-5 grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader
          icon={TrendingUp}
          title="Tren stok"
          subtitle={`Saldo akhir hari, ${data.length} hari terakhir · sekarang ${angka(akhir.saldo)} pcs`}
        />
        <div className="px-4 pb-4">
          <Kerangka data={data} ticks={saldo.ticks} y={saldo.y} label="Tren stok harian">
            <path d={area} className="fill-live/10" />
            <path d={garis} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-live" />
            <circle cx={x(data.length - 1)} cy={saldo.y(akhir.saldo)} r={4} strokeWidth={2} className="fill-live stroke-card" />
          </Kerangka>
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={Activity}
          title="Arus masuk & keluar"
          subtitle={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-live" aria-hidden />
                Masuk {angka(totalMasuk)} pcs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-ink-muted" aria-hidden />
                Keluar {angka(totalKeluar)} pcs
              </span>
            </span>
          }
        />
        <div className="px-4 pb-4">
          <Kerangka data={data} ticks={arus.ticks} y={arus.y} label="Arus stok masuk dan keluar per hari">
            {data.map((d, i) => (
              <g key={d.tanggal}>
                {d.masuk > 0 ? (
                  <rect
                    x={x(i) - lebar / 2}
                    y={arus.y(d.masuk)}
                    width={lebar}
                    height={Math.max(1, arus.y(0) - arus.y(d.masuk) - 1)}
                    rx={2}
                    className="fill-live"
                  />
                ) : null}
                {d.keluar > 0 ? (
                  <rect
                    x={x(i) - lebar / 2}
                    y={arus.y(0) + 1}
                    width={lebar}
                    height={Math.max(1, arus.y(-d.keluar) - arus.y(0) - 1)}
                    rx={2}
                    className="fill-ink-muted"
                  />
                ) : null}
              </g>
            ))}
          </Kerangka>
        </div>
      </Card>
    </div>
  );
}
