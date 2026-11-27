ALTER TABLE `TM_VENDOR_PARTS` ADD `USES_KANBAN` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `TT_PICKLIST_L` ADD `USES_KANBAN` boolean DEFAULT true NOT NULL;
--> statement-breakpoint
INSERT INTO TM_PERMISSION (ROLE_ID, ACTION)
SELECT r.ID, a.action FROM TM_ROLE r
JOIN (SELECT 'receipt.manual' AS action UNION ALL SELECT 'receipt.open' UNION ALL SELECT 'receipt.close') a
WHERE r.NAME IN ('ppic', 'admin')
AND NOT EXISTS (SELECT 1 FROM TM_PERMISSION p WHERE p.ROLE_ID = r.ID AND p.ACTION = a.action);
