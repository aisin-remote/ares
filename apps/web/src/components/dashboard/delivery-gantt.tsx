'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import type { PicklistStatus } from '@ares/contracts';
import { orderSheetDisplayNo } from '@ares/domain';
import { Card, CardBody, CardDivider, CardHeader } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';
import { SelectSearch } from '@/components/ui/select-search';

interface Schedule {
  key: string;
  kind: 'PLANNED' | 'ACTUAL';
  id: number | string;
  picklistNo: string | null;
  revision: number;
  vendorName: string;
  status: PicklistStatus | null;
  arrivalAt: Date;
  endAt: Date;
  boxOrdered: number | null;
  truckStation: string | null;
}

const dateLabel = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeLabel = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const currentTimeLabel = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const LAYOUT = {
  plotLeft: 210,
  plotRight: 24,
  plotTop: 64,
  lane: 26,
  bar: 20,
  barGap: 6,
  groupPad: 10,
  minGroup: 38,
  bottom: 30,
} as const;

const tone = (status: PicklistStatus) => status === 'COMPLETE'
  ? 'fill-ok/20 stroke-ok'
  : status === 'PARTIAL'
    ? 'fill-warn/20 stroke-warn'
    : 'fill-surface stroke-line-strong';

function assignLanes(rows: Schedule[]) {
  const laneEnds: number[] = [];
  const positioned = rows.map((row) => {
    let lane = laneEnds.findIndex((end) => end <= row.arrivalAt.getTime());
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = row.endAt.getTime();
    return { row, lane };
  });
  return { positioned, laneCount: laneEnds.length };
}

/** Logika dashboard receiving lama: window 120 menit mulai dari jam kedatangan. */
export function DeliveryGantt({
  schedules,
  start,
  end,
  startDate,
  endDate,
  interactive = true,
  plants,
  selectedPlant,
}: {
  schedules: Schedule[];
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
  interactive?: boolean;
  plants?: Array<{ value: string; label: string }>;
  selectedPlant?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const plantFormRef = useRef<HTMLFormElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(true);
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  const span = end.getTime() - start.getTime();
  const dayCount = Math.max(1, Math.round(span / 86_400_000));
  const days = Array.from({ length: dayCount }, (_, index) =>
    new Date(start.getTime() + index * 86_400_000));
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const updateClock = () => setNow(new Date());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const element = chartAreaRef.current;
    if (!element) return;
    const updateSize = () => setAreaSize({
      width: element.clientWidth,
      height: element.clientHeight,
    });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isFullscreen, filterOpen, schedules.length]);
  useEffect(() => {
    const updateFullscreen = () => {
      const full = document.fullscreenElement === containerRef.current;
      setIsFullscreen(full);
      // Fullscreen: lipat filter supaya chart dapat ruang vertikal lebih besar.
      setFilterOpen(!full);
    };
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current?.requestFullscreen();
  };
  const grouped = new Map<string, Schedule[]>();
  for (const row of schedules) grouped.set(row.vendorName, [...(grouped.get(row.vendorName) ?? []), row]);
  const groups = [...grouped].map(([vendorName, rows]) => ({ vendorName, rows }));
  const chartWidth = isFullscreen && areaSize.width > 0
    ? areaSize.width
    : Math.max(areaSize.width, 220 + days.length * 72);

  const naturalBody = groups.reduce((sum, group) => {
    const { laneCount } = assignLanes(group.rows);
    return sum + Math.max(LAYOUT.minGroup, laneCount * LAYOUT.lane + LAYOUT.groupPad);
  }, 0);
  const naturalHeight = Math.max(360, LAYOUT.plotTop + naturalBody + LAYOUT.bottom);
  // Fullscreen: padatkan spasi vertikal proporsional (bukan stretch SVG) supaya tidak gepeng.
  let scale = 1;
  const needsScroll = !isFullscreen;
  if (isFullscreen && areaSize.height > 0) {
    scale = Math.min(1, areaSize.height / naturalHeight);
  }
  const plotLeft = LAYOUT.plotLeft;
  const plotTop = LAYOUT.plotTop * scale;
  const laneH = LAYOUT.lane * scale;
  // Fullscreen memadatkan jarak antarsupplier, tetapi tinggi bar dan teks tetap
  // dijaga agar terbaca dari monitor yang berjarak beberapa meter.
  const barH = Math.max(isFullscreen ? 16 : 0, LAYOUT.bar * scale);
  const barGap = LAYOUT.barGap * scale;
  const groupPad = LAYOUT.groupPad * scale;
  const minGroup = LAYOUT.minGroup * scale;
  const bottom = LAYOUT.bottom * scale;
  const plotWidth = chartWidth - plotLeft - LAYOUT.plotRight;
  const labelFs = Math.max(isFullscreen ? 13 : 0, 12 * scale);
  const headerFs = Math.max(isFullscreen ? 11 : 0, 11 * scale);
  const dayFs = Math.max(isFullscreen ? 10 : 0, 10 * scale);
  const barFs = Math.max(isFullscreen ? 9 : 0, 9 * scale);
  const axisLabelY = isFullscreen ? 10 : plotTop * 0.62;
  const nowBadgeWidth = isFullscreen ? 72 : 62 * scale;
  const nowBadgeHeight = isFullscreen ? 16 : 20 * scale;
  const nowBadgeY = isFullscreen ? 14 : 4 * scale;
  const nowBadgeTextY = isFullscreen ? 25 : 18 * scale;
  const nowBadgeHalf = nowBadgeWidth / 2;

  let nextTop = plotTop;
  const chartGroups = groups.map((group) => {
    const lanes = assignLanes(group.rows);
    const height = Math.max(minGroup, lanes.laneCount * laneH + groupPad);
    const result = { ...group, ...lanes, top: nextTop, height };
    nextTop += height;
    return result;
  });
  const contentHeight = Math.max(360 * scale, nextTop + bottom);
  const chartHeight = isFullscreen && areaSize.height > 0 && !needsScroll
    ? areaSize.height
    : contentHeight;
  const nowX = now === null ? null
    : plotLeft + ((now.getTime() - start.getTime()) / span) * plotWidth;

  return <div ref={containerRef} className={cn(
    isFullscreen ? 'h-screen w-screen max-w-full overflow-hidden bg-shell p-3' : 'mt-5',
  )}>
    <Card className={cn('overflow-hidden', isFullscreen && 'flex h-full min-h-0 w-full min-w-0 max-w-full flex-col')}>
    <CardHeader icon={CalendarRange} title="Jadwal pengiriman supplier"
      subtitle={isFullscreen ? undefined : 'Jadwal rutin dari truck station dan pengiriman aktual dari Order Sheet'}
      className={cn('flex-wrap', isFullscreen && 'shrink-0 px-5 py-3')}
      actions={<>
        {plants?.length ? <form ref={plantFormRef} method="get" className="w-[150px]">
          <input type="hidden" name="start_date" value={startDate} />
          <input type="hidden" name="end_date" value={endDate} />
          <SelectSearch name="plant" ariaLabel="Filter plant" options={plants}
            value={selectedPlant} required
            onValueChange={(plant) => {
              // Nilai baru ditulis langsung ke input tersembunyi: requestSubmit
              // berjalan sebelum React sempat merender ulang formulir ini.
              const form = plantFormRef.current;
              const field = form?.elements.namedItem('plant');
              if (!form || !(field instanceof HTMLInputElement)) return;
              field.value = plant;
              form.requestSubmit();
            }} />
        </form> : null}
        {interactive ? <button type="button" onClick={() => void toggleFullscreen()}
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-line bg-surface px-4 text-[12px] font-semibold text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          aria-label={isFullscreen ? 'Keluar dari fullscreen' : 'Tampilkan jadwal secara fullscreen'}>
          {isFullscreen ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          {isFullscreen ? 'Keluar' : 'Fullscreen'}
        </button> : null}
      </>} />
    <CardDivider />
    {!isFullscreen ? <div className="shrink-0 border-b border-line">
      <button type="button" onClick={() => setFilterOpen((open) => !open)}
        className={cn(
          'flex w-full items-center gap-3 px-5 text-left transition-colors hover:bg-surface/60',
          filterOpen ? 'py-2.5' : 'py-3',
        )}
        aria-expanded={filterOpen}
        aria-controls="delivery-gantt-filter">
        <span className="text-[12px] font-semibold text-ink-soft">Filter tanggal</span>
        {!filterOpen ? <span className="text-[12px] tabular-nums text-ink-muted">
          {startDate} – {endDate}
        </span> : null}
        <span className="ml-auto inline-flex size-8 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted">
          {filterOpen
            ? <ChevronUp className="size-4" aria-hidden />
            : <ChevronDown className="size-4" aria-hidden />}
        </span>
      </button>
      {filterOpen ? <div id="delivery-gantt-filter">
        <CardBody className={cn('pt-1 pb-4', isFullscreen && 'py-3')}>
          <form method="get" className="flex flex-wrap items-end gap-3">
          {selectedPlant && selectedPlant !== 'ALL'
            ? <input type="hidden" name="plant" value={selectedPlant} />
            : null}
          <label className="grid gap-1.5 text-[12px] font-semibold text-ink-muted">
            Tanggal mulai
            <input type="date" name="start_date" defaultValue={startDate}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium text-ink outline-none focus:border-line-strong" />
          </label>
          <label className="grid gap-1.5 text-[12px] font-semibold text-ink-muted">
            Tanggal akhir
            <input type="date" name="end_date" defaultValue={endDate}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium text-ink outline-none focus:border-line-strong" />
          </label>
          <button type="submit" className="h-10 rounded-full bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-soft">
            Tampilkan
          </button>
          </form>
        </CardBody>
      </div> : null}
    </div> : null}
    {groups.length === 0 ? <CardBody>
      <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-[14px] text-ink-muted">
        Belum ada jadwal pengiriman pada rentang tanggal ini.
      </p>
    </CardBody> : <div ref={chartAreaRef} className={cn(
      isFullscreen
        ? cn('min-h-0 w-full min-w-0 flex-1', needsScroll ? 'scroll-slim overflow-auto' : 'overflow-hidden')
        : 'scroll-slim w-full overflow-x-auto',
    )}>
      <svg
        width={chartWidth}
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="xMinYMin meet"
        role="img" aria-labelledby="delivery-chart-title"
        className={cn('block bg-card', isFullscreen && !needsScroll && 'h-full w-full')}>
        <title id="delivery-chart-title">Grafik rentang jadwal pengiriman supplier</title>
        <defs>
          <clipPath id="delivery-chart-plot">
            <rect x={plotLeft} y={0} width={plotWidth} height={chartHeight} />
          </clipPath>
        </defs>

        <rect x={plotLeft} y={plotTop} width={plotWidth} height={Math.max(0, chartHeight - plotTop - 20 * scale)}
          className="fill-surface/25" />
        <text x={24} y={axisLabelY} fill="currentColor"
          className="fill-ink-muted font-semibold uppercase tracking-wider"
          style={{ fontSize: headerFs }}>
          Supplier
        </text>

        <g clipPath="url(#delivery-chart-plot)">
          {days.map((currentDay, index) => {
            const x = plotLeft + (index / dayCount) * plotWidth;
            const nextX = plotLeft + ((index + 1) / dayCount) * plotWidth;
            return <g key={currentDay.toISOString()}>
              <line x1={x} x2={x} y1={plotTop - 10 * scale} y2={chartHeight - 20 * scale}
                className="stroke-line" strokeDasharray="4 4" />
              <text x={(x + nextX) / 2} y={axisLabelY} textAnchor="middle" fill="currentColor"
                className="fill-ink-muted font-semibold uppercase tracking-wide"
                style={{ fontSize: dayFs }}>
                {dateLabel.format(currentDay)}
              </text>
            </g>;
          })}
          <line x1={plotLeft + plotWidth} x2={plotLeft + plotWidth}
            y1={plotTop - 10 * scale} y2={chartHeight - 20 * scale}
            className="stroke-line" strokeDasharray="4 4" />

          {chartGroups.map((group) => <line key={`line:${group.vendorName}`}
            x1={plotLeft} x2={plotLeft + plotWidth} y1={group.top + group.height}
            y2={group.top + group.height} className="stroke-line/70" />)}

          {chartGroups.flatMap((group) => group.positioned.map(({ row, lane }) => {
            const clippedStart = Math.max(start.getTime(), row.arrivalAt.getTime());
            const clippedEnd = Math.min(end.getTime(), row.endAt.getTime());
            const x = plotLeft + ((clippedStart - start.getTime()) / span) * plotWidth;
            const width = Math.max(isFullscreen ? 20 : 18 * scale, ((clippedEnd - clippedStart) / span) * plotWidth);
            const y = group.top + barGap + lane * laneH;
            const number = row.picklistNo == null ? null : orderSheetDisplayNo(row.picklistNo, row.revision);
            const title = row.kind === 'PLANNED'
              ? `${group.vendorName} · ${row.truckStation} · ${timeLabel.format(row.arrivalAt)}–${timeLabel.format(row.endAt)}`
              : `${group.vendorName} · ${number} · tiba ${timeLabel.format(row.arrivalAt)} · window sampai ${timeLabel.format(row.endAt)}`;
            const bar = <g>
              <title>{title}</title>
              <rect x={x} y={y} width={width} height={barH} rx={Math.max(2, 5 * scale)}
                strokeWidth={Math.max(1, 1.5 * scale)}
                strokeDasharray={row.kind === 'PLANNED' ? `${5 * scale} ${3 * scale}` : undefined}
                className={cn(
                  'transition-opacity hover:opacity-70',
                  row.kind === 'PLANNED' ? 'fill-accent/40 stroke-ink-soft' : tone(row.status!),
                )} />
              {width >= 70 * scale ? <text x={x + 8 * scale} y={y + barH * 0.68}
                fill="currentColor"
                className="pointer-events-none fill-ink-soft font-semibold"
                style={{ fontSize: barFs }}>
                {row.kind === 'PLANNED' ? row.truckStation : number}
              </text> : null}
            </g>;
            return interactive && row.kind === 'ACTUAL'
              ? <a key={row.key} href={`/picklist/${row.id}`} aria-label={title}>{bar}</a>
              : <g key={row.key}>{bar}</g>;
          }))}

          {now !== null && nowX !== null && nowX > plotLeft && nowX < plotLeft + plotWidth ? <g>
            <line x1={nowX} x2={nowX} y1={isFullscreen ? nowBadgeY : plotTop - 26 * scale} y2={chartHeight - 20 * scale}
              className="stroke-ng" strokeWidth={Math.max(1.5, 2 * scale)} />
            <rect x={Math.max(plotLeft, Math.min(nowX - nowBadgeHalf, plotLeft + plotWidth - nowBadgeWidth))}
              y={nowBadgeY} width={nowBadgeWidth} height={nowBadgeHeight}
              rx={isFullscreen ? 4 : 5 * scale} className="fill-ng" />
            <text x={Math.max(plotLeft + nowBadgeHalf, Math.min(nowX, plotLeft + plotWidth - nowBadgeHalf))}
              y={nowBadgeTextY} textAnchor="middle" fill="currentColor"
              className="fill-white font-bold tabular-nums"
              style={{ fontSize: isFullscreen ? 9 : dayFs }}>
              {currentTimeLabel.format(now)}
            </text>
          </g> : null}
        </g>

        <line x1={plotLeft} x2={plotLeft} y1={plotTop - 10 * scale} y2={chartHeight - 20 * scale}
          className="stroke-line-strong" />
        {chartGroups.map((group) => <g key={`label:${group.vendorName}`}>
          <title>{group.vendorName}</title>
          <text x={24} y={group.top + group.height / 2 + labelFs * 0.35}
            fill="currentColor" className="fill-ink font-semibold"
            style={{ fontSize: labelFs }}>
            {group.vendorName.length > 25 ? `${group.vendorName.slice(0, 24)}…` : group.vendorName}
          </text>
        </g>)}
      </svg>
    </div>}
    <CardDivider />
    <CardBody className={cn('flex flex-wrap gap-x-5 gap-y-2 py-3', isFullscreen && 'shrink-0 py-2')}>
      <span className="inline-flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="size-2.5 rounded-full border border-dashed border-accent/60 bg-accent/10" /> Jadwal rutin
      </span>
      <span className="inline-flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="size-2.5 rounded-full border border-line-strong bg-surface" /> Sudah order
      </span>
      <span className="inline-flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="size-2.5 rounded-full border border-warn/50 bg-warn/15" /> Diterima sebagian
      </span>
      <span className="inline-flex items-center gap-2 text-[11px] text-ink-muted">
        <span className="size-2.5 rounded-full border border-ok/50 bg-ok/15" /> Diterima semua
      </span>
    </CardBody>
    </Card>
  </div>;
}
