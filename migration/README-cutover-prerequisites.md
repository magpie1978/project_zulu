# Zulu schema cutover prerequisites

**Status: not deployed.** Do not merge or run draft SQL as-is.

## Data API exposure (manual dashboard check)

In the Supabase dashboard for project `eukgodthgusongsbhdwg`, open **Project Settings → Data API** (the label may appear as **API Settings**). Under **Exposed schemas**, ensure `zulu` is included alongside any existing exposed schemas. Do not remove `public`: other applications share this project.

Confirm using a request with `Accept-Profile: zulu` after the schema has been populated. A SQL query of `current_setting('pgrst.db_schemas', true)` returned NULL and does not establish the configured exposed schemas.

## Database permissions

The existing Zulu tables have RLS enabled, with policies on `zulu_videos`, `zulu_actors`, and `zulu_video_views`. Moving objects preserves their existing table grants and RLS policies, but roles additionally need USAGE on the destination schema.

The migration should include:
```sql
GRANT USAGE ON SCHEMA zulu TO authenticated, service_role;
```
Only grant `anon` schema usage if explicitly required and reviewed. Review view security and EXECUTE grants before exposing RPCs. Existing broad table privileges should be audited rather than expanded.

## Function dependencies

- Six `zulu_*` routines must move and have hard-coded `public.zulu_*` references rewritten.
- `public.check_pornflix_login` and `public.check_zulu_login` should remain public compatibility RPCs, with their `zulu_users` references schema-qualified.
- `public.refresh_zulu_videos_search` should remain a public compatibility RPC with its materialized-view reference rewritten.
- `zulu_recovery_is_editor()` refers to missing `public.zulu_recovery_editors`. Preserve it pending explicit decision; do not grant it new permissions or rely on it during migration.
- Cron job `refresh-zulu-videos-search-on-change` currently calls `public.zulu_process_refresh()`; change to `zulu.zulu_process_refresh()` at cutover.

## Cutover sequence

1. Verify a fresh backup and restore and capture baseline row counts.
2. Finish and review a **single executable transactional migration** combining object moves, routine definitions, grants, and cron updates. The current SQL files are drafts, not ready to execute.
3. Verify API schema exposure; deploy website and Edge Functions during approved downtime.
4. Apply the migration and run SQL/API smoke tests.
5. Restore service only after upload, catalogue, playback, login, administration, and cron checks pass.
6. If verification fails, roll back application deployments and database changes together.

## References

- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/api/using-custom-schemas
