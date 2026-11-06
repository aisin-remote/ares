-- Custom SQL migration file, put your code below! --
INSERT INTO `TM_PERMISSION` (`ROLE_ID`, `ACTION`)
SELECT r.`ID`, 'report.arrival.read' FROM `TM_ROLE` r
WHERE r.`NAME` IN ('admin', 'ppic')
AND NOT EXISTS (SELECT 1 FROM `TM_PERMISSION` p WHERE p.`ROLE_ID` = r.`ID` AND p.`ACTION` = 'report.arrival.read');
