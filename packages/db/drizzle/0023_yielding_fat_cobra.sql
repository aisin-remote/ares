-- Cutoff tanpa jam (F-04, 6.2; keputusan pemilik proyek 2026-10-23): satu jadwal
-- per supplier, dan antrean OPEN dipindah ke 00:00 WIB hari cutoff-nya supaya PPIC
-- bisa menerbitkan Order Sheet sejak pagi.
SET time_zone = '+00:00';--> statement-breakpoint
-- 1. Sisakan satu jadwal per supplier: yang aktif dulu, lalu jam cutoff paling pagi.
DELETE c FROM `TM_VENDOR_CUTOFF` c
JOIN `TM_VENDOR_CUTOFF` k ON k.`VENDOR_ID` = c.`VENDOR_ID` AND (
  k.`IS_ACTIVE` > c.`IS_ACTIVE`
  OR (k.`IS_ACTIVE` = c.`IS_ACTIVE` AND (
    k.`CUTOFF_TIME` < c.`CUTOFF_TIME`
    OR (k.`CUTOFF_TIME` = c.`CUTOFF_TIME` AND k.`ID` < c.`ID`)
  ))
);--> statement-breakpoint
-- 2. Antrean OPEN → 00:00 WIB hari cutoff. Beberapa jam cutoff di hari yang sama
--    digabung ke baris ber-ID terkecil; konsumsi dan koreksi ikut dipindah.
CREATE TABLE `_ARES_QUEUE_DAY` AS
SELECT `ID`, `VENDOR_PART_ID`,
  CONVERT_TZ(DATE(CONVERT_TZ(`CUTOFF_AT`, '+00:00', '+07:00')), '+07:00', '+00:00') AS `DAY_AT`
FROM `TT_ORDER_QUEUE` WHERE `STATUS` = 'OPEN';--> statement-breakpoint
CREATE TABLE `_ARES_QUEUE_KEEP` AS
SELECT `VENDOR_PART_ID`, `DAY_AT`, MIN(`ID`) AS `KEEP_ID`
FROM `_ARES_QUEUE_DAY` GROUP BY `VENDOR_PART_ID`, `DAY_AT`;--> statement-breakpoint
CREATE TABLE `_ARES_QUEUE_MAP` AS
SELECT d.`ID`, k.`KEEP_ID`, k.`DAY_AT`
FROM `_ARES_QUEUE_DAY` d
JOIN `_ARES_QUEUE_KEEP` k ON k.`VENDOR_PART_ID` = d.`VENDOR_PART_ID` AND k.`DAY_AT` = d.`DAY_AT`;--> statement-breakpoint
CREATE TABLE `_ARES_QUEUE_SUM` AS
SELECT m.`KEEP_ID`, m.`DAY_AT`, SUM(q.`PCS`) AS `PCS`, SUM(q.`CARRY_OVER_PCS`) AS `CARRY_OVER_PCS`, MAX(q.`HOLD`) AS `HOLD`
FROM `_ARES_QUEUE_MAP` m JOIN `TT_ORDER_QUEUE` q ON q.`ID` = m.`ID`
GROUP BY m.`KEEP_ID`, m.`DAY_AT`;--> statement-breakpoint
UPDATE `TT_CONSUMPTION` c JOIN `_ARES_QUEUE_MAP` m ON m.`ID` = c.`QUEUE_ID`
SET c.`QUEUE_ID` = m.`KEEP_ID` WHERE m.`ID` <> m.`KEEP_ID`;--> statement-breakpoint
UPDATE `TT_QUEUE_ADJUSTMENT` a JOIN `_ARES_QUEUE_MAP` m ON m.`ID` = a.`QUEUE_ID`
SET a.`QUEUE_ID` = m.`KEEP_ID` WHERE m.`ID` <> m.`KEEP_ID`;--> statement-breakpoint
DELETE q FROM `TT_ORDER_QUEUE` q JOIN `_ARES_QUEUE_MAP` m ON m.`ID` = q.`ID`
WHERE m.`ID` <> m.`KEEP_ID`;--> statement-breakpoint
UPDATE `TT_ORDER_QUEUE` q JOIN `_ARES_QUEUE_SUM` s ON s.`KEEP_ID` = q.`ID`
SET q.`CUTOFF_AT` = s.`DAY_AT`, q.`PCS` = s.`PCS`, q.`CARRY_OVER_PCS` = s.`CARRY_OVER_PCS`,
  q.`HOLD` = s.`HOLD`, q.`BLOCKED_REASON` = NULL, q.`BLOCKED_AT` = NULL;--> statement-breakpoint
DROP TABLE `_ARES_QUEUE_DAY`, `_ARES_QUEUE_KEEP`, `_ARES_QUEUE_MAP`, `_ARES_QUEUE_SUM`;--> statement-breakpoint
-- 3. Unique baru dibuat dulu: index lama ikut melayani FK VENDOR_ID.
ALTER TABLE `TM_VENDOR_CUTOFF` ADD CONSTRAINT `TM_VENDOR_CUTOFF_VENDOR_UNIQUE` UNIQUE(`VENDOR_ID`);--> statement-breakpoint
ALTER TABLE `TM_VENDOR_CUTOFF` DROP INDEX `TM_VENDOR_CUTOFF_VENDOR_TIME_UNIQUE`;--> statement-breakpoint
ALTER TABLE `TM_VENDOR_CUTOFF` DROP COLUMN `CUTOFF_TIME`;
