import { ScanLine } from 'lucide-react';
import { Card } from '../ui/card';
import { OpenSessionForm } from './open-session-form';

export function WarehouseReceiving() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight">Receiving</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Scan Delivery Sheet untuk mulai menerima barang.
        </p>
      </div>
      <Card className="p-4">
        <h2 className="mb-1 flex items-center gap-2 text-[16px] font-bold">
          <ScanLine className="size-5" aria-hidden /> Buka sesi scan
        </h2>
        <p className="mb-4 text-[13px] text-ink-muted">Arahkan barcode Delivery Sheet ke scanner.</p>
        <OpenSessionForm handheld />
      </Card>
    </div>
  );
}
