-- Companion routine body definitions for the Zulu schema migration.
-- Review carefully; apply after ALTER ... SET SCHEMA within the SAME transaction.
-- Generated from live pg_get_functiondef output, retaining function attributes.

CREATE OR REPLACE FUNCTION zulu.zulu_catalogue_integrity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN

  SELECT jsonb_build_object(

    /* ---------------------------------------------------------------
       Duplicate URLs
       --------------------------------------------------------------- */

    'duplicate_urls',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'url', url,
              'occurrences', occurrences,
              'uids', uids,
              'films', films
            )
            ORDER BY occurrences DESC, url
          ),
          '[]'::jsonb
        )
      )
      FROM (
        SELECT
          url,
          COUNT(*) AS occurrences,
          array_agg(uid ORDER BY uid) AS uids,
          array_agg(film ORDER BY uid) AS films
        FROM zulu.zulu_videos
        WHERE url IS NOT NULL
          AND btrim(url) <> ''
        GROUP BY url
        HAVING COUNT(*) > 1
      ) duplicates
    ),


    /* ---------------------------------------------------------------
       Duplicate fingerprints
       --------------------------------------------------------------- */

    'duplicate_fingerprints',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'fingerprint', fingerprint,
              'occurrences', occurrences,
              'uids', uids,
              'films', films
            )
            ORDER BY occurrences DESC, fingerprint
          ),
          '[]'::jsonb
        )
      )
      FROM (
        SELECT
          fingerprint,
          COUNT(*) AS occurrences,
          array_agg(uid ORDER BY uid) AS uids,
          array_agg(film ORDER BY uid) AS films
        FROM zulu.zulu_videos
        WHERE fingerprint IS NOT NULL
          AND btrim(fingerprint) <> ''
        GROUP BY fingerprint
        HAVING COUNT(*) > 1
      ) duplicates
    ),


    /* ---------------------------------------------------------------
       Videos without actors
       --------------------------------------------------------------- */

    'videos_without_actors',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'uid', v.uid,
              'film', v.film,
              'url', v.url
            )
            ORDER BY v.uid DESC
          ),
          '[]'::jsonb
        )
      )
      FROM zulu.zulu_videos v
      WHERE NOT EXISTS (
        SELECT 1
        FROM zulu.zulu_actors a
        WHERE a.uid = v.uid
      )
    ),


    /* ---------------------------------------------------------------
       Missing filesize
       --------------------------------------------------------------- */

    'missing_filesize',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'uid', uid,
              'film', film,
              'url', url
            )
            ORDER BY uid DESC
          ),
          '[]'::jsonb
        )
      )
      FROM zulu.zulu_videos
      WHERE filesize_bytes IS NULL
         OR filesize_bytes <= 0
    ),


    /* ---------------------------------------------------------------
       Missing duration
       --------------------------------------------------------------- */

    'missing_duration',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'uid', uid,
              'film', film,
              'url', url
            )
            ORDER BY uid DESC
          ),
          '[]'::jsonb
        )
      )
      FROM zulu.zulu_videos
      WHERE duration_seconds IS NULL
         OR duration_seconds <= 0
    ),


    /* ---------------------------------------------------------------
       Missing resolution
       --------------------------------------------------------------- */

    'missing_resolution',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'uid', uid,
              'film', film,
              'width', width,
              'height', height,
              'url', url
            )
            ORDER BY uid DESC
          ),
          '[]'::jsonb
        )
      )
      FROM zulu.zulu_videos
      WHERE width IS NULL
         OR height IS NULL
         OR width <= 0
         OR height <= 0
    ),


    /* ---------------------------------------------------------------
       Missing fingerprint
       --------------------------------------------------------------- */

    'missing_fingerprint',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'uid', uid,
              'film', film,
              'url', url
            )
            ORDER BY uid DESC
          ),
          '[]'::jsonb
        )
      )
      FROM zulu.zulu_videos
      WHERE fingerprint IS NULL
         OR btrim(fingerprint) = ''
    ),


    /* ---------------------------------------------------------------
       Non-current media URLs
       --------------------------------------------------------------- */

    'old_media_urls',
    (
      SELECT jsonb_build_object(
        'count',
        COUNT(*),

        'rows',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'uid', uid,
              'film', film,
              'url', url
            )
            ORDER BY uid DESC
          ),
          '[]'::jsonb
        )
      )
      FROM zulu.zulu_videos
      WHERE url IS NOT NULL
        AND btrim(url) <> ''
        AND url NOT LIKE
          'https://media.zulu-orchid-falcon.co.uk/%'
    )

  )
  INTO result;


  RETURN result;

END;
$function$


-- WARNING: legacy zulu_recovery_is_editor references a missing zulu_recovery_editors table.
-- Keep function for compatibility, but calling it will fail until dependency is resolved.
CREATE OR REPLACE FUNCTION zulu.zulu_recovery_is_editor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.zulu_recovery_editors WHERE user_id = (SELECT auth.uid()));
$function$


CREATE OR REPLACE FUNCTION public.check_pornflix_login(input_username text, input_password text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  select exists (
    select 1
    FROM zulu.zulu_users
    where username = input_username
      and password_hash = crypt(input_password, password_hash)
  );
$function$


CREATE OR REPLACE FUNCTION public.refresh_zulu_videos_search()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW zulu.zulu_videos_search;
END;
$function$


CREATE OR REPLACE FUNCTION public.check_zulu_login(input_username text, input_password text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  select exists (
    select 1
    FROM zulu.zulu_users
    where username = input_username
      and password_hash = crypt(input_password, password_hash)
  );
$function$


CREATE OR REPLACE FUNCTION zulu.zulu_consolidate_duplicate(p_survivor_uid bigint, p_removed_uid bigint, p_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

DECLARE

    v_survivor zulu.zulu_videos%ROWTYPE;
    v_removed zulu.zulu_videos%ROWTYPE;

    v_actor_count integer := 0;
    v_view_count integer := 0;
    v_ingestion_count integer := 0;

BEGIN

    /* ================================================================
       BASIC VALIDATION
       ================================================================ */

    IF p_survivor_uid IS NULL
       OR p_removed_uid IS NULL
       OR p_survivor_uid = p_removed_uid THEN

        RAISE EXCEPTION
            'Survivor UID and removed UID must be different.';

    END IF;


    IF p_fingerprint IS NULL
       OR btrim(p_fingerprint) = '' THEN

        RAISE EXCEPTION
            'Fingerprint is required.';

    END IF;


    /* ================================================================
       LOCK BOTH VIDEO RECORDS

       FOR UPDATE prevents another catalogue operation changing either
       record while consolidation is taking place.
       ================================================================ */

    SELECT *
    INTO v_survivor
    FROM zulu.zulu_videos
    WHERE uid = p_survivor_uid
    FOR UPDATE;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Survivor UID % does not exist.',
            p_survivor_uid;

    END IF;


    SELECT *
    INTO v_removed
    FROM zulu.zulu_videos
    WHERE uid = p_removed_uid
    FOR UPDATE;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Duplicate UID % does not exist.',
            p_removed_uid;

    END IF;


    /* ================================================================
       FINGERPRINT REVALIDATION

       Both records must STILL have the fingerprint supplied by the
       repair operation.

       This prevents a stale Admin page from consolidating records that
       have changed since the duplicate report was generated.
       ================================================================ */

    IF v_survivor.fingerprint IS DISTINCT FROM p_fingerprint
       OR v_removed.fingerprint IS DISTINCT FROM p_fingerprint THEN

        RAISE EXCEPTION
            'Fingerprint validation failed. Catalogue records changed before consolidation.';

    END IF;


    /* ================================================================
       TECHNICAL METADATA VALIDATION

       Automatic consolidation is permitted only when the technical
       properties of both catalogue records agree.

       We deliberately do NOT require the following to match:

           film
           url
           tags

       Those are catalogue-level properties and can legitimately differ
       between two accidental catalogue entries for the same video.
       ================================================================ */

    IF v_survivor.filesize_bytes IS DISTINCT FROM
       v_removed.filesize_bytes THEN

        RAISE EXCEPTION
            'Filesize mismatch. Automatic consolidation blocked.';

    END IF;


    IF v_survivor.duration_seconds IS DISTINCT FROM
       v_removed.duration_seconds THEN

        RAISE EXCEPTION
            'Duration mismatch. Automatic consolidation blocked.';

    END IF;


    IF v_survivor.width IS DISTINCT FROM
       v_removed.width
       OR
       v_survivor.height IS DISTINCT FROM
       v_removed.height THEN

        RAISE EXCEPTION
            'Resolution mismatch. Automatic consolidation blocked.';

    END IF;


    /* ================================================================
       ACTORS

       zulu_actors has the composite primary key:

           (uid, actor)

       Copy all actor relationships belonging to the removed UID onto
       the survivor.

       ON CONFLICT protects against an actor already being attached to
       the surviving record.
       ================================================================ */

    INSERT INTO zulu.zulu_actors (
        uid,
        actor
    )

    SELECT
        p_survivor_uid,
        actor

    FROM zulu.zulu_actors

    WHERE uid = p_removed_uid

    ON CONFLICT (uid, actor)
    DO NOTHING;


    GET DIAGNOSTICS
        v_actor_count = ROW_COUNT;


    /*
     * The actor relationships belonging to the removed catalogue UID
     * are no longer required.
     */

    DELETE FROM zulu.zulu_actors
    WHERE uid = p_removed_uid;


    /* ================================================================
       VIDEO VIEW EVENTS

       zulu_video_views is the underlying event table.

       Each event has its own primary-key ID, so the events belonging to
       the duplicate catalogue record can safely be reassigned to the
       surviving UID.
       ================================================================ */

    UPDATE zulu.zulu_video_views

    SET
        video_uid = p_survivor_uid

    WHERE
        video_uid = p_removed_uid;


    GET DIAGNOSTICS
        v_view_count = ROW_COUNT;


    /* ================================================================
       VIDEO COUNTS

       IMPORTANT:

       zulu.zulu_video_counts is a VIEW.

       It must therefore NOT be updated, deleted from or inserted into
       here.

       Its values are derived from the underlying catalogue/view-event
       data.

       Because the zulu_video_views records have just been reassigned
       above, zulu_video_counts will automatically reflect the surviving
       UID when subsequently queried.
       ================================================================ */


    /* ================================================================
       INGESTION HISTORY

       Preserve every ingestion journal record.

       If an ingestion previously pointed at the catalogue UID that is
       being removed, redirect it to the surviving catalogue UID.

       We deliberately do not delete historical ingestion records.
       ================================================================ */

    UPDATE zulu.zulu_ingestions

    SET
        video_uid = p_survivor_uid,
        updated_at = now()

    WHERE
        video_uid = p_removed_uid;


    GET DIAGNOSTICS
        v_ingestion_count = ROW_COUNT;


    /* ================================================================
       DELETE DUPLICATE CATALOGUE ROW

       This happens only AFTER:

           ✓ fingerprint revalidation
           ✓ technical metadata validation
           ✓ actor migration
           ✓ view-event migration
           ✓ ingestion-history migration

       All operations in this function execute within the same
       PostgreSQL transaction.

       Therefore an exception before completion rolls the database
       changes back.
       ================================================================ */

    DELETE FROM zulu.zulu_videos

    WHERE
        uid = p_removed_uid;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Duplicate catalogue row disappeared during consolidation.';

    END IF;


    /* ================================================================
       FINAL SAFETY CHECK

       Make sure the surviving catalogue record still exists before the
       transaction is allowed to complete.
       ================================================================ */

    PERFORM 1
    FROM zulu.zulu_videos
    WHERE uid = p_survivor_uid;


    IF NOT FOUND THEN

        RAISE EXCEPTION
            'Surviving catalogue row disappeared during consolidation.';

    END IF;


    /* ================================================================
       RETURN TRANSACTION RESULT
       ================================================================ */

    RETURN jsonb_build_object(

        'success',
        true,

        'survivor_uid',
        p_survivor_uid,

        'removed_uid',
        p_removed_uid,

        'fingerprint',
        p_fingerprint,

        'actors_added_to_survivor',
        v_actor_count,

        'views_reassigned',
        v_view_count,

        'ingestions_reassigned',
        v_ingestion_count

    );

END;

$function$


CREATE OR REPLACE FUNCTION zulu.zulu_refresh_videos_search()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN

    REFRESH MATERIALIZED VIEW zulu.zulu_videos_search;

END;
$function$


CREATE OR REPLACE FUNCTION zulu.zulu_request_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    UPDATE zulu.zulu_refresh_queue
    SET
        pending = true,
        requested_at = clock_timestamp()
    WHERE id = 1;

    RETURN NULL;
END;
$function$


CREATE OR REPLACE PROCEDURE zulu.zulu_process_refresh()
 LANGUAGE plpgsql
 SET search_path TO ''
AS $procedure$
DECLARE
    needs_refresh boolean;
BEGIN
    SELECT pending
    INTO needs_refresh
    FROM zulu.zulu_refresh_queue
    WHERE id = 1
    FOR UPDATE;

    IF COALESCE(needs_refresh, false) THEN
        REFRESH MATERIALIZED VIEW
            zulu.zulu_videos_search;

        UPDATE zulu.zulu_refresh_queue
        SET
            pending = false,
            refreshed_at = clock_timestamp()
        WHERE id = 1;
    END IF;
END;
$procedure$


