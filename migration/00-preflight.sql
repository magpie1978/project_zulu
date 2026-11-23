-- Safe, read-only pre-cutover checks.
SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname LIKE 'zulu_%' AND n.nspname IN ('public','zulu') ORDER BY c.relname;
SELECT c.relname,c.relrowsecurity,(SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) policy_count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'zulu_%' AND c.relkind='r';
SELECT 'videos' AS relation,count(*) FROM public.zulu_videos UNION ALL SELECT 'actors',count(*) FROM public.zulu_actors UNION ALL SELECT 'ingestions',count(*) FROM public.zulu_ingestions UNION ALL SELECT 'views',count(*) FROM public.zulu_video_views UNION ALL SELECT 'duplicate_reviews',count(*) FROM public.zulu_duplicate_reviews;
SELECT has_schema_privilege('authenticated','zulu','USAGE') authenticated_usage,has_schema_privilege('service_role','zulu','USAGE') service_role_usage;
SELECT jobid,jobname,schedule,command FROM cron.job WHERE command LIKE '%zulu%';
SELECT to_regclass('public.zulu_recovery_editors') recovery_editors_table;
