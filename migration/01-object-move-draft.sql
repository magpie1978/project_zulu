-- PREPARED ONLY. Do not execute until API schema exposure, grants, frontend,
-- Edge Function deployments, and a fresh restore-verified backup are coordinated.
-- PostgreSQL transaction keeps the object move atomic.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS zulu;

-- Move base tables first; attached indexes and owned sequences follow automatically.
ALTER TABLE public.zulu_actors SET SCHEMA zulu;
ALTER TABLE public.zulu_duplicate_reviews SET SCHEMA zulu;
ALTER TABLE public.zulu_ingestions SET SCHEMA zulu;
ALTER TABLE public.zulu_refresh_queue SET SCHEMA zulu;
ALTER TABLE public.zulu_users SET SCHEMA zulu;
ALTER TABLE public.zulu_video_views SET SCHEMA zulu;
ALTER TABLE public.zulu_videos SET SCHEMA zulu;

-- Move views and materialized views, preserving definitions, ownership and grants.
ALTER VIEW public.zulu_distinct_actors SET SCHEMA zulu;
ALTER VIEW public.zulu_video_counts SET SCHEMA zulu;
ALTER VIEW public.zulu_videos_with_actors SET SCHEMA zulu;
ALTER MATERIALIZED VIEW public.zulu_video_stats SET SCHEMA zulu;
ALTER MATERIALIZED VIEW public.zulu_videos_search SET SCHEMA zulu;

-- Move routines without dropping them (preserves OIDs and dependent triggers).
ALTER FUNCTION public.zulu_catalogue_integrity() SET SCHEMA zulu;
ALTER FUNCTION public.zulu_consolidate_duplicate(bigint,bigint,text) SET SCHEMA zulu;
ALTER PROCEDURE public.zulu_process_refresh() SET SCHEMA zulu;
ALTER FUNCTION public.zulu_recovery_is_editor() SET SCHEMA zulu;
ALTER FUNCTION public.zulu_refresh_videos_search() SET SCHEMA zulu;
ALTER FUNCTION public.zulu_request_refresh() SET SCHEMA zulu;

-- IMPORTANT: function bodies retain textual public.* references after ALTER SCHEMA.
-- Apply the companion routine-body migration in the same transaction.
-- Keep public.check_pornflix_login, public.check_zulu_login and
-- public.refresh_zulu_videos_search as public RPC compatibility endpoints,
-- but rewrite their bodies to reference zulu.*.
-- Supabase Data API exposed schemas must include zulu BEFORE this transaction.
-- GRANT USAGE on zulu schema and appropriate table/view/routine privileges;
-- confirm RLS policies continue to apply.
-- Update pg_cron job 1 to CALL zulu.zulu_process_refresh().
-- Explicit COMMIT withheld until all companion changes are prepared.
ROLLBACK;
