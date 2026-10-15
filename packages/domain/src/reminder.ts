import type { PicklistStatus } from '@ares/contracts';

export type ReminderKind = 'NOT_DOWNLOADED' | 'NOT_CONFIRMED';

/** F-08: menentukan pengingat yang sudah jatuh tempo dan belum pernah dipicu. */
export function dueReminderKinds(
  picklist: {
    status: PicklistStatus;
    createdAt: Date;
    arrivalAt: Date;
    downloadWarningHours: number;
    confirmWarningHours: number;
    downloadedAt: Date | null;
    shippedAt: Date | null;
    downloadReminderAt: Date | null;
    confirmReminderAt: Date | null;
  },
  now: Date,
): ReminderKind[] {
  if (!['ISSUED', 'DOWNLOADED'].includes(picklist.status) || picklist.shippedAt) return [];
  const due: ReminderKind[] = [];
  if (
    !picklist.downloadedAt &&
    !picklist.downloadReminderAt &&
    now.getTime() >= picklist.createdAt.getTime() + picklist.downloadWarningHours * 3_600_000
  ) due.push('NOT_DOWNLOADED');
  if (
    !picklist.confirmReminderAt &&
    now.getTime() >= picklist.arrivalAt.getTime() - picklist.confirmWarningHours * 3_600_000
  ) due.push('NOT_CONFIRMED');
  return due;
}
