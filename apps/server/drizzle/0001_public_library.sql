CREATE TABLE `images` (
	`key` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`bytes` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `images_owner_idx` ON `images` (`ownerId`);--> statement-breakpoint
CREATE TABLE `library_mixes` (
	`userId` text NOT NULL,
	`mixId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `mixId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mixId`) REFERENCES `mixes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_mixes_by_mix_idx` ON `library_mixes` (`mixId`);--> statement-breakpoint
CREATE TABLE `library_sounds` (
	`userId` text NOT NULL,
	`soundId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `soundId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`soundId`) REFERENCES `sounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `library_sounds_by_sound_idx` ON `library_sounds` (`soundId`);--> statement-breakpoint
CREATE TABLE `mix_volumes` (
	`userId` text NOT NULL,
	`mixId` text NOT NULL,
	`soundId` text NOT NULL,
	`volume` real NOT NULL,
	PRIMARY KEY(`userId`, `mixId`, `soundId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mixId`) REFERENCES `mixes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`soundId`) REFERENCES `sounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mix_volumes_by_mix_idx` ON `mix_volumes` (`mixId`);--> statement-breakpoint
CREATE INDEX `mix_volumes_by_sound_idx` ON `mix_volumes` (`soundId`);--> statement-breakpoint
CREATE TABLE `sound_volumes` (
	`userId` text NOT NULL,
	`soundId` text NOT NULL,
	`volume` real NOT NULL,
	PRIMARY KEY(`userId`, `soundId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`soundId`) REFERENCES `sounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sound_volumes_by_sound_idx` ON `sound_volumes` (`soundId`);--> statement-breakpoint
ALTER TABLE `mixes` ADD `description` text;--> statement-breakpoint
ALTER TABLE `mixes` ADD `isPublic` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `mixes_public_idx` ON `mixes` (`isPublic`);--> statement-breakpoint
ALTER TABLE `sounds` ADD `description` text;--> statement-breakpoint
ALTER TABLE `sounds` ADD `license` text;--> statement-breakpoint
ALTER TABLE `sounds` ADD `isPublic` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `sounds_public_idx` ON `sounds` (`isPublic`);