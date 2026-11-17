CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_idx` ON `accounts` (`userId`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mix_items` (
	`id` text PRIMARY KEY NOT NULL,
	`mixId` text NOT NULL,
	`soundId` text NOT NULL,
	`position` integer NOT NULL,
	`mode` text NOT NULL,
	`volume` real NOT NULL,
	`intervalMinSec` real NOT NULL,
	`intervalMaxSec` real NOT NULL,
	`volumeVariation` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`mixId`) REFERENCES `mixes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`soundId`) REFERENCES `sounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mix_items_position_idx` ON `mix_items` (`mixId`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `mix_items_sound_idx` ON `mix_items` (`mixId`,`soundId`);--> statement-breakpoint
CREATE INDEX `mix_items_by_sound_idx` ON `mix_items` (`soundId`);--> statement-breakpoint
CREATE TABLE `mixes` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`illustrationType` text DEFAULT 'none' NOT NULL,
	`iconId` text,
	`iconSvg` text,
	`imageKey` text,
	`imageBytes` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mixes_owner_idx` ON `mixes` (`ownerId`);--> statement-breakpoint
CREATE TABLE `scene_mixes` (
	`sceneId` text NOT NULL,
	`mixId` text NOT NULL,
	PRIMARY KEY(`sceneId`, `mixId`),
	FOREIGN KEY (`sceneId`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mixId`) REFERENCES `mixes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_mixes_by_mix_idx` ON `scene_mixes` (`mixId`);--> statement-breakpoint
CREATE TABLE `scene_sounds` (
	`sceneId` text NOT NULL,
	`soundId` text NOT NULL,
	PRIMARY KEY(`sceneId`, `soundId`),
	FOREIGN KEY (`sceneId`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`soundId`) REFERENCES `sounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scene_sounds_by_sound_idx` ON `scene_sounds` (`soundId`);--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`illustrationType` text DEFAULT 'none' NOT NULL,
	`iconId` text,
	`iconSvg` text,
	`imageKey` text,
	`imageBytes` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenes_owner_idx` ON `scenes` (`ownerId`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`impersonatedBy` text,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`userId`);--> statement-breakpoint
CREATE TABLE `sounds` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`fileKey` text NOT NULL,
	`mimeType` text NOT NULL,
	`sizeBytes` integer NOT NULL,
	`durationSec` real NOT NULL,
	`defaultMode` text NOT NULL,
	`defaultVolume` real NOT NULL,
	`loopStartSec` real,
	`loopEndSec` real,
	`intervalMinSec` real NOT NULL,
	`intervalMaxSec` real NOT NULL,
	`volumeVariation` real DEFAULT 0 NOT NULL,
	`illustrationType` text DEFAULT 'none' NOT NULL,
	`iconId` text,
	`iconSvg` text,
	`imageKey` text,
	`imageBytes` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sounds_owner_idx` ON `sounds` (`ownerId`);--> statement-breakpoint
CREATE TABLE `storage_snapshots` (
	`day` text PRIMARY KEY NOT NULL,
	`audioBytes` integer NOT NULL,
	`imageBytes` integer NOT NULL,
	`databaseBytes` integer NOT NULL,
	`freeBytes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`banReason` text,
	`banExpires` integer,
	`lastActiveAt` integer,
	`limitStorageBytes` integer,
	`limitAudioFileBytes` integer,
	`limitAudioDurationSec` integer,
	`limitImageFileBytes` integer,
	`limitMixItems` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);