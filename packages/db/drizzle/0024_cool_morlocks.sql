ALTER TABLE `TT_PO_HEADER` ADD `SOURCE` enum('LOCAL','SAP') DEFAULT 'LOCAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `TT_PO_LINE` ADD `ORDERED_QTY` int;--> statement-breakpoint
ALTER TABLE `TT_PO_LINE` ADD `BALANCE_VERIFIED` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `TT_PO_LINE` ADD `IS_ACTIVE` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `TT_PO_LINE` ADD `SAP_PLANT_NO` varchar(4);--> statement-breakpoint
ALTER TABLE `TT_PO_LINE` ADD `SAP_UOM` varchar(8);--> statement-breakpoint
INSERT IGNORE INTO `TM_PERMISSION` (`ROLE_ID`, `ACTION`)
SELECT `ID`, 'sap.po.sync' FROM `TM_ROLE` WHERE `NAME` IN ('admin', 'ppic');
