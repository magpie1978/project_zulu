-- Read-only post-cutover verification. Execute after migration and API configuration.
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind AS kind
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname IN ('zulu_actors','zulu_duplicate_reviews','zulu_ingestions','zulu_refresh_queue','zulu_users','zulu_video_views','zulu_videos','zulu_distinct_actors','zulu_video_counts','zulu_videos_with_actors','zulu_video_stats','zulu_videos_search')
ORDER BY c.relname,n.nspname;

SELECT 'videos' AS object_name,count(*) FROM zulu.zulu_videos
UNION ALL SELECT 'actors',count(*) FROM zulu.zulu_actors
UNION ALL SELECT 'ingestions',count(*) FROM zulu.zulu_ingestions
UNION ALL SELECT 'views',count(*) FROM zulu.zulu_video_views
UNION ALL SELECT 'duplicate_reviews',count(*) FROM zulu.zulu_duplicate_reviews;

SELECT c.relname,c.relrowsecurity,
  (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='zulu' AND c.relkind='r' ORDER BY c.relname;

SELECT n.nspname,p.proname,p.prokind
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='zulu' AND p.proname LIKE 'zulu_%' ORDER BY p.proname;

SELECT jobid,jobname,schedule,command FROM cron.job
WHERE jobname='refresh-zulu-videos-search-on-change';

SELECT has_schema_privilege('authenticated','zulu','USAGE') AS authenticated_schema_usage,
       has_schema_privilege('service_role','zulu','USAGE') AS service_role_schema_usage;

-- External tests (required): REST /rest/v1/ with Accept-Profile: zulu;
-- authenticated catalogue read, view insertion, admin dashboard, video finalisation,
-- delete-video, catalogue repair, and cron refresh. These cannot be validated by SQL alone.
