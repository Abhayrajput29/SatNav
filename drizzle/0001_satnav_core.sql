CREATE TABLE `satnav_ai_explanations` (
	`id` varchar(64) NOT NULL,
	`eventId` varchar(191) NOT NULL,
	`action` varchar(32) NOT NULL,
	`model` varchar(128) NOT NULL,
	`content` text NOT NULL,
	`citations` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	CONSTRAINT `satnav_ai_explanations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `satnav_clusters` (
	`id` varchar(191) NOT NULL,
	`category` varchar(32) NOT NULL,
	`title` text NOT NULL,
	`longitude` double,
	`latitude` double,
	`startTime` timestamp,
	`endTime` timestamp,
	`memberCount` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `satnav_clusters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `satnav_event_sources` (
	`id` varchar(64) NOT NULL,
	`eventId` varchar(191) NOT NULL,
	`provider` varchar(16) NOT NULL,
	`providerId` varchar(191) NOT NULL,
	`label` varchar(255) NOT NULL,
	`publisher` varchar(255),
	`url` varchar(2048),
	`attribution` text NOT NULL,
	`publishedAt` timestamp,
	`updatedAt` timestamp,
	`fetchedAt` timestamp NOT NULL,
	`metadata` json,
	CONSTRAINT `satnav_event_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `satnav_events` (
	`id` varchar(191) NOT NULL,
	`clusterId` varchar(191) NOT NULL,
	`provider` varchar(16) NOT NULL,
	`providerId` varchar(191) NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`category` varchar(32) NOT NULL,
	`locationLabel` varchar(512),
	`country` varchar(128),
	`longitude` double,
	`latitude` double,
	`geometry` json,
	`locationPrecision` varchar(20) NOT NULL,
	`status` varchar(20) NOT NULL,
	`verification` varchar(32) NOT NULL,
	`severityLabel` varchar(191),
	`severityValue` double,
	`severityScale` varchar(64),
	`eventStart` timestamp,
	`eventEnd` timestamp,
	`publishedAt` timestamp,
	`providerUpdatedAt` timestamp,
	`fetchedAt` timestamp NOT NULL,
	`sources` json NOT NULL,
	`relatedArticles` json NOT NULL,
	`sourceCount` int NOT NULL DEFAULT 1,
	CONSTRAINT `satnav_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `satnav_provider_event_idx` UNIQUE(`provider`,`providerId`,`id`)
);
--> statement-breakpoint
CREATE TABLE `satnav_provider_status` (
	`provider` varchar(32) NOT NULL,
	`state` varchar(20) NOT NULL,
	`lastAttemptAt` timestamp,
	`lastSuccessAt` timestamp,
	`itemCount` int NOT NULL DEFAULT 0,
	`message` text,
	`coverageNote` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `satnav_provider_status_provider` PRIMARY KEY(`provider`)
);
--> statement-breakpoint
ALTER TABLE `satnav_ai_explanations` ADD CONSTRAINT `satnav_ai_explanations_eventId_satnav_events_id_fk` FOREIGN KEY (`eventId`) REFERENCES `satnav_events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `satnav_event_sources` ADD CONSTRAINT `satnav_event_sources_eventId_satnav_events_id_fk` FOREIGN KEY (`eventId`) REFERENCES `satnav_events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `satnav_events` ADD CONSTRAINT `satnav_events_clusterId_satnav_clusters_id_fk` FOREIGN KEY (`clusterId`) REFERENCES `satnav_clusters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `satnav_ai_event_action_time_idx` ON `satnav_ai_explanations` (`eventId`,`action`,`createdAt`);--> statement-breakpoint
CREATE INDEX `satnav_cluster_category_time_idx` ON `satnav_clusters` (`category`,`startTime`);--> statement-breakpoint
CREATE INDEX `satnav_source_event_idx` ON `satnav_event_sources` (`eventId`);--> statement-breakpoint
CREATE INDEX `satnav_source_provider_idx` ON `satnav_event_sources` (`provider`,`providerId`);--> statement-breakpoint
CREATE INDEX `satnav_event_category_time_idx` ON `satnav_events` (`category`,`eventStart`);--> statement-breakpoint
CREATE INDEX `satnav_event_point_time_idx` ON `satnav_events` (`latitude`,`longitude`,`eventStart`);--> statement-breakpoint
CREATE INDEX `satnav_event_cluster_idx` ON `satnav_events` (`clusterId`);