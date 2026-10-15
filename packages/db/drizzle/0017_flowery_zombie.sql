ALTER TABLE `TT_SAP_OUTBOX` ADD `NEXT_ATTEMPT_AT` timestamp;--> statement-breakpoint
ALTER TABLE `TT_SAP_OUTBOX` ADD `LAST_ATTEMPT_AT` timestamp;--> statement-breakpoint
ALTER TABLE `TT_SAP_OUTBOX` ADD `STAGED_AT` timestamp;--> statement-breakpoint
ALTER TABLE `TT_SAP_OUTBOX` ADD `POSTED_AT` timestamp;--> statement-breakpoint
-- Instalasi lama memakai SENT untuk dokumen yang sudah selesai di FakeSapGateway.
-- Perluas enum sementara agar datanya dapat dipindahkan sebelum SENT dihapus.
ALTER TABLE `TT_SAP_OUTBOX` MODIFY COLUMN `STATUS` enum('PENDING','PROCESSING','STAGED','POSTED','SENT','FAILED','HELD','SKIPPED') NOT NULL DEFAULT 'PENDING';--> statement-breakpoint
UPDATE `TT_SAP_OUTBOX`
SET `STATUS` = 'POSTED',
    `POSTED_AT` = COALESCE(`SENT_AT`, `UPDATED_AT`)
WHERE `STATUS` = 'SENT';--> statement-breakpoint
ALTER TABLE `TT_SAP_OUTBOX` MODIFY COLUMN `STATUS` enum('PENDING','PROCESSING','STAGED','POSTED','FAILED','HELD','SKIPPED') NOT NULL DEFAULT 'PENDING';
