ALTER TABLE "user_devices" ADD COLUMN "refresh_replay_result" varchar;--> statement-breakpoint
ALTER TABLE "user_devices" ADD COLUMN "refresh_replay_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "user_devices_refresh_replay_cleanup_idx" ON "user_devices" USING btree ("refresh_replay_until") WHERE "user_devices"."refresh_replay_result" is not null;