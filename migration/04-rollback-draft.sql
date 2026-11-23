-- ROLLBACK PLAN (requires coordinated website/Edge Function rollback).
-- Stop writes and pause cron before rollback.
-- This file is intentionally non-executable until routine bodies are restored from
-- the pre-cutover pg_get_functiondef snapshot and all dependencies are validated.
BEGIN;
SET LOCAL lock_timeout='15s';
ALTER MATERIALIZED VIEW zulu.zulu_videos_search SET SCHEMA public;
ALTER MATERIALIZED VIEW zulu.zulu_video_stats SET SCHEMA public;
ALTER VIEW zulu.zulu_videos_with_actors SET SCHEMA public;
ALTER VIEW zulu.zulu_video_counts SET SCHEMA public;
ALTER VIEW zulu.zulu_distinct_actors SET SCHEMA public;
ALTER TABLE zulu.zulu_videos SET SCHEMA public;
ALTER TABLE zulu.zulu_video_views SET SCHEMA public;
ALTER TABLE zulu.zulu_users SET SCHEMA public;
ALTER TABLE zulu.zulu_refresh_queue SET SCHEMA public;
ALTER TABLE zulu.zulu_ingestions SET SCHEMA public;
ALTER TABLE zulu.zulu_duplicate_reviews SET SCHEMA public;
ALTER TABLE zulu.zulu_actors SET SCHEMA public;
ALTER FUNCTION zulu.zulu_catalogue_integrity() SET SCHEMA public;
ALTER FUNCTION zulu.zulu_consolidate_duplicate(bigint,bigint,text) SET SCHEMA public;
ALTER PROCEDURE zulu.zulu_process_refresh() SET SCHEMA public;
ALTER FUNCTION zulu.zulu_recovery_is_editor() SET SCHEMA public;
ALTER FUNCTION zulu.zulu_refresh_videos_search() SET SCHEMA public;
ALTER FUNCTION zulu.zulu_request_refresh() SET SCHEMA public;
-- Restore original function bodies, cron command, API schema exposure and grants.
-- COMMIT only after original routine definitions and cron are restored.
ROLLBACK;
