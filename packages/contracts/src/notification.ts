export const PICKLIST_NOTICE_KINDS = [
  'PICKLIST_ISSUED', 'PICKLIST_REVISED', 'REMINDER_NOT_DOWNLOADED', 'REMINDER_NOT_CONFIRMED',
] as const;
export type PicklistNoticeKind = (typeof PICKLIST_NOTICE_KINDS)[number];

export const EMAIL_DELIVERY_STATUSES = ['QUEUED', 'PROCESSING', 'ACCEPTED', 'FAILED', 'SKIPPED'] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
