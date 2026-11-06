CREATE TABLE `TM_SETTING` (
	`ID` bigint unsigned AUTO_INCREMENT NOT NULL,
	`KEY` varchar(64) NOT NULL,
	`VALUE` varchar(255) NOT NULL,
	`CREATED_AT` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`UPDATED_AT` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `TM_SETTING_ID` PRIMARY KEY(`ID`),
	CONSTRAINT `TM_SETTING_KEY_UNIQUE` UNIQUE(`KEY`)
);
--> statement-breakpoint
-- F-44: tarik PO tiap tanggal 24 untuk order bulan berikutnya; Admin/PPIC dapat mengubahnya.
INSERT IGNORE INTO `TM_SETTING` (`KEY`, `VALUE`) VALUES ('PO_PULL_DAY', '24');--> statement-breakpoint
-- Keputusan 2026-11-03: sisa PO dihitung ARES = qty PO − pesanan ARES, jadi PO hasil tarik langsung dapat dipakai.
UPDATE `TT_PO_LINE` l JOIN `TT_PO_HEADER` h ON h.`ID` = l.`PO_ID`
SET l.`OPEN_QTY` = IF(l.`IS_ACTIVE`, COALESCE(l.`ORDERED_QTY`, 0), 0), l.`BALANCE_VERIFIED` = true
WHERE h.`SOURCE` = 'SAP';
