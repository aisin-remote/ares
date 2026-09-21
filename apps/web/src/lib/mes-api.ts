import 'server-only';
import { apiFetch } from './api';

export interface MesStatus {
  gateway: 'fake' | 'http';
  enabled: boolean;
  intervalSec: number;
  cursor: string | null;
  syncedAt: string | null;
  failures: number;
  fake: Record<string, number>;
}

export function getMesStatus(): Promise<MesStatus> {
  return apiFetch<MesStatus>('/mes/status');
}
