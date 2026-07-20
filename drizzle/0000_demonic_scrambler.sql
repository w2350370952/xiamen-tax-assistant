CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`date` text NOT NULL,
	`weekday` text NOT NULL,
	`period` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`course_name` text NOT NULL,
	`teacher` text DEFAULT '' NOT NULL,
	`class_name` text DEFAULT '' NOT NULL,
	`classroom` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`course_type` text DEFAULT 'other' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `courses_version_date_idx` ON `courses` (`version_id`,`date`);--> statement-breakpoint
CREATE TABLE `draft_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`date` text NOT NULL,
	`weekday` text NOT NULL,
	`period` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`course_name` text NOT NULL,
	`teacher` text DEFAULT '' NOT NULL,
	`class_name` text DEFAULT '' NOT NULL,
	`classroom` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`course_type` text DEFAULT 'other' NOT NULL,
	`source_page` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `draft_courses_upload_date_idx` ON `draft_courses` (`upload_id`,`date`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`status` text NOT NULL,
	`r2_key` text DEFAULT '' NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`published_version_id` text
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`updated_at` text NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`source_filename` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_label_unique` ON `versions` (`label`);