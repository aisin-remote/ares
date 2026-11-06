-- F-01/F-02: tarik master supplier, part, dan vendor part dari staging SAP.
INSERT IGNORE INTO `TM_PERMISSION` (`ROLE_ID`, `ACTION`)
SELECT `ID`, 'sap.master.sync' FROM `TM_ROLE` WHERE `NAME` IN ('admin', 'ppic');
