ALTER TABLE `TM_VENDOR` MODIFY COLUMN `SAP_VENDOR_NO` varchar(16);--> statement-breakpoint
ALTER TABLE `TM_VENDOR_CUTOFF` ADD `SOURCE_KEY` varchar(191);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `PLANT_ID` bigint unsigned;--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `TRUCK_STATION` varchar(64);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `DELIVERY_CYCLE` varchar(32);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `TRUCK_TYPE` varchar(32);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `DELIVERY_DAYS` varchar(16);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `DELIVERY_DAY_LABEL` varchar(64);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `PALLET_PER_DELIVERY` varchar(64);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `LOADING_OPERATOR` varchar(64);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `LOCATION` varchar(64);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD `SOURCE_KEY` varchar(191);--> statement-breakpoint
ALTER TABLE `TM_VENDOR_CUTOFF` ADD CONSTRAINT `TM_VENDOR_CUTOFF_SOURCE_KEY_UNIQUE` UNIQUE(`SOURCE_KEY`);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD CONSTRAINT `TM_VENDOR_SOURCE_KEY_UNIQUE` UNIQUE(`SOURCE_KEY`);--> statement-breakpoint
ALTER TABLE `TM_VENDOR` ADD CONSTRAINT `TM_VENDOR_PLANT_ID_TM_PLANT_ID_fk` FOREIGN KEY (`PLANT_ID`) REFERENCES `TM_PLANT`(`ID`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `TM_VENDOR_PLANT_IDX` ON `TM_VENDOR` (`PLANT_ID`);