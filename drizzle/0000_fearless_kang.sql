CREATE TABLE `model_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`protocol` text NOT NULL,
	`model_id` text NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`api_key` text DEFAULT '' NOT NULL,
	`reasoning_passback` integer DEFAULT false NOT NULL,
	`passback_mode` text DEFAULT 'passthrough' NOT NULL,
	`passback_field` text DEFAULT '' NOT NULL,
	`thinking_enabled` integer DEFAULT false NOT NULL,
	`effort_levels` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
