import {
  createClient
} from "npm:@supabase/supabase-js@2";


/* =====================================================================
   ZULU CATALOGUE REPAIR
   =====================================================================

   PURPOSE
   -------

   Protected Admin operations for duplicate catalogue records.

   Supported actions:

       keep_both
       preview_consolidation
       consolidate_duplicate

   SAFETY MODEL
   ------------

   preview_consolidation:
       READ ONLY.

   consolidate_duplicate:
       Revalidates both catalogue rows and technical metadata before
       calling the transactional PostgreSQL consolidation RPC.

   IMPORTANT:
       This function does NOT delete Backblaze objects.
       It does NOT delete thumbnails.

   Physical storage cleanup is deliberately separate from catalogue
   consolidation.
   ===================================================================== */


/* =====================================================================
   01. CONFIGURATION
   ===================================================================== */

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL");

const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY");

const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const ZULU_ADMIN_EMAIL =
  Deno.env.get("ZULU_ADMIN_EMAIL") || null;


/* =====================================================================
   02. CORS
   ===================================================================== */

const allowedOrigins =
  new Set([
    "https://pornflix.zulu-orchid-falcon.co.uk"
  ]);


function getCorsHeaders(request: Request) {

  const origin =
    request.headers.get("origin") || "";

  const allowedOrigin =
    allowedOrigins.has(origin)
      ? origin
      : "https://www.zulu-orchid-falcon.co.uk";

  return {
    "Access-Control-Allow-Origin":
      allowedOrigin,

    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Vary":
      "Origin"
  };
}


/* =====================================================================
   03. RESPONSE HELPERS
   ===================================================================== */

function jsonResponse(
  request: Request,
  body: unknown,
  status = 200
) {

  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        ...getCorsHeaders(request),

        "Content-Type":
          "application/json"
      }
    }
  );
}


/* =====================================================================
   04. NORMALISATION HELPERS
   ===================================================================== */

function normaliseNumber(
  value: unknown
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function technicalMetadataMatches(
  a: any,
  b: any
) {

  return (
    normaliseNumber(a.filesize_bytes) ===
      normaliseNumber(b.filesize_bytes) &&

    normaliseNumber(a.duration_seconds) ===
      normaliseNumber(b.duration_seconds) &&

    normaliseNumber(a.width) ===
      normaliseNumber(b.width) &&

    normaliseNumber(a.height) ===
      normaliseNumber(b.height)
  );
}


/* =====================================================================
   05. MAIN HANDLER
   ===================================================================== */

Deno.serve(
  async request => {

    /* -----------------------------------------------------------------
       PREFLIGHT
       ----------------------------------------------------------------- */

    if (
      request.method === "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers:
            getCorsHeaders(request)
        }
      );
    }


    /* -----------------------------------------------------------------
       METHOD
       ----------------------------------------------------------------- */

    if (
      request.method !== "POST"
    ) {

      return jsonResponse(
        request,
        {
          success: false,
          error:
            "Method not allowed."
        },
        405
      );
    }


    try {

      /* ===============================================================
         ENVIRONMENT
         =============================================================== */

      if (
        !SUPABASE_URL ||
        !SUPABASE_ANON_KEY ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {

        throw new Error(
          "Required Supabase environment variables are missing."
        );
      }


      /* ===============================================================
         AUTHENTICATION
         =============================================================== */

      const authorization =
        request.headers.get(
          "authorization"
        );


      if (
        !authorization
      ) {

        return jsonResponse(
          request,
          {
            success: false,
            error:
              "Missing authorization header."
          },
          401
        );
      }


      const authClient =
        createClient(
          SUPABASE_URL,
          SUPABASE_ANON_KEY,
          {
            global: {
              headers: {
                Authorization:
                  authorization
              }
            },

            auth: {
              persistSession:
                false,

              autoRefreshToken:
                false
            }
          }
        );


      const {
        data: userData,
        error: userError
      } =
        await authClient.auth.getUser();


      if (
        userError ||
        !userData?.user
      ) {

        return jsonResponse(
          request,
          {
            success: false,
            error:
              "Unauthorised."
          },
          401
        );
      }


      const user =
        userData.user;


      /* ===============================================================
         ADMIN RESTRICTION
         =============================================================== */

      if (
        ZULU_ADMIN_EMAIL
      ) {

        const userEmail =
          String(
            user.email || ""
          )
            .trim()
            .toLowerCase();


        const adminEmail =
          ZULU_ADMIN_EMAIL
            .trim()
            .toLowerCase();


        if (
          userEmail !== adminEmail
        ) {

          return jsonResponse(
            request,
            {
              success: false,
              error:
                "Forbidden."
            },
            403
          );
        }
      }


      /* ===============================================================
         SERVICE ROLE CLIENT
         =============================================================== */

      const adminClient =
        createClient(
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY,
          {
            auth: {
              persistSession:
                false,

              autoRefreshToken:
                false
            }
          }
        );


      /* ===============================================================
         REQUEST BODY
         =============================================================== */

      let body: any;


      try {

        body =
          await request.json();

      } catch {

        return jsonResponse(
          request,
          {
            success: false,
            error:
              "Invalid JSON request body."
          },
          400
        );
      }


      const action =
        String(
          body?.action || ""
        )
          .trim()
          .toLowerCase();


      if (
        !action
      ) {

        return jsonResponse(
          request,
          {
            success: false,
            error:
              "Action is required."
          },
          400
        );
      }


      /* ===============================================================
         KEEP BOTH
         =============================================================== */

      if (
        action === "keep_both"
      ) {

        const fingerprint =
          String(
            body?.fingerprint || ""
          ).trim();


        if (
          !fingerprint
        ) {

          return jsonResponse(
            request,
            {
              success: false,
              error:
                "Fingerprint is required."
            },
            400
          );
        }


        const {
          data: videos,
          error: videosError
        } =
          await adminClient
            .schema("zulu").from("zulu_videos")
            .select(`
              uid,
              film,
              url,
              fingerprint,
              filesize_bytes,
              duration_seconds,
              width,
              height
            `)
            .eq(
              "fingerprint",
              fingerprint
            )
            .order(
              "uid",
              {
                ascending: true
              }
            );


        if (
          videosError
        ) {

          throw new Error(
            `Could not verify duplicate catalogue records: ${videosError.message}`
          );
        }


        if (
          !Array.isArray(videos) ||
          videos.length < 2
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                "This fingerprint no longer identifies a duplicate catalogue group."
            },
            409
          );
        }


        const reviewedUids =
          videos
            .map(
              video =>
                Number(video.uid)
            )
            .filter(
              Number.isFinite
            )
            .sort(
              (a, b) =>
                a - b
            );


        const reviewRecord = {

          fingerprint,

          decision:
            "keep_both",

          survivor_uid:
            null,

          removed_uid:
            null,

          reviewed_uids:
            reviewedUids,

          reviewed_by:
            user.id,

          reviewed_at:
            new Date().toISOString(),

          notes:
            null
        };


        const {
          data: review,
          error: reviewError
        } =
          await adminClient
            .schema("zulu").from(
              "zulu_duplicate_reviews"
            )
            .upsert(
              reviewRecord,
              {
                onConflict:
                  "fingerprint"
              }
            )
            .select()
            .single();


        if (
          reviewError
        ) {

          throw new Error(
            `Could not record duplicate review: ${reviewError.message}`
          );
        }


        return jsonResponse(
          request,
          {
            success: true,

            action:
              "keep_both",

            fingerprint,

            matching_records:
              videos.length,

            reviewed_uids:
              reviewedUids,

            review
          }
        );
      }


      /* ===============================================================
         PREVIEW CONSOLIDATION
         =============================================================== */

      if (
        action ===
          "preview_consolidation"
      ) {

        const fingerprint =
          String(
            body?.fingerprint || ""
          ).trim();


        if (
          !fingerprint
        ) {

          return jsonResponse(
            request,
            {
              success: false,
              error:
                "Fingerprint is required."
            },
            400
          );
        }


        /* -------------------------------------------------------------
           LOAD ALL CURRENT MEMBERS OF THIS FINGERPRINT GROUP
           ------------------------------------------------------------- */

        const {
          data: videos,
          error: videosError
        } =
          await adminClient
            .schema("zulu").from("zulu_videos")
            .select(`
              uid,
              film,
              url,
              tags,
              filesize_bytes,
              duration_seconds,
              width,
              height,
              fingerprint,
              ingested_at
            `)
            .eq(
              "fingerprint",
              fingerprint
            )
            .order(
              "uid",
              {
                ascending: true
              }
            );


        if (
          videosError
        ) {

          throw new Error(
            `Could not load duplicate catalogue records: ${videosError.message}`
          );
        }


        if (
          !Array.isArray(videos) ||
          videos.length < 2
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                "This fingerprint no longer identifies a duplicate catalogue group."
            },
            409
          );
        }


        /*
         * The first Admin implementation supports PAIRS.
         *
         * If we later encounter a fingerprint shared by three or more
         * catalogue records, we stop rather than guessing which two
         * records the administrator intended to consolidate.
         */
        if (
          videos.length !== 2
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                `This fingerprint currently belongs to ${videos.length} catalogue records. Pair consolidation requires exactly two records.`,

              videos
            },
            409
          );
        }


        const [
          videoA,
          videoB
        ] =
          videos;


        /* -------------------------------------------------------------
           TECHNICAL COMPARISON
           ------------------------------------------------------------- */

        const technicalMatch =
          technicalMetadataMatches(
            videoA,
            videoB
          );


        /* -------------------------------------------------------------
           ACTORS
           ------------------------------------------------------------- */

        const uids =
          videos.map(
            video =>
              Number(video.uid)
          );


        const {
          data: actors,
          error: actorsError
        } =
          await adminClient
            .schema("zulu").from("zulu_actors")
            .select(
              "uid, actor"
            )
            .in(
              "uid",
              uids
            )
            .order(
              "actor",
              {
                ascending: true
              }
            );


        if (
          actorsError
        ) {

          throw new Error(
            `Could not load actor relationships: ${actorsError.message}`
          );
        }


        /* -------------------------------------------------------------
           VIEW EVENTS
           ------------------------------------------------------------- */

        const {
          data: viewRows,
          error: viewsError
        } =
          await adminClient
            .schema("zulu").from(
              "zulu_video_views"
            )
            .select(
              "video_uid"
            )
            .in(
              "video_uid",
              uids
            );


        if (
          viewsError
        ) {

          throw new Error(
            `Could not inspect video views: ${viewsError.message}`
          );
        }


        /* -------------------------------------------------------------
           INGESTION HISTORY
           ------------------------------------------------------------- */

        const {
          data: ingestionRows,
          error: ingestionError
        } =
          await adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(`
              id,
              video_uid,
              original_filename,
              canonical_filename,
              status,
              created_at,
              completed_at
            `)
            .in(
              "video_uid",
              uids
            )
            .order(
              "created_at",
              {
                ascending: true
              }
            );


        if (
          ingestionError
        ) {

          throw new Error(
            `Could not inspect ingestion history: ${ingestionError.message}`
          );
        }


        /* -------------------------------------------------------------
           BUILD PER-VIDEO PREVIEW
           ------------------------------------------------------------- */

        const previewVideos =
          videos.map(
            video => {

              const uid =
                Number(video.uid);


              const videoActors =
                (actors || [])
                  .filter(
                    row =>
                      Number(row.uid) === uid
                  )
                  .map(
                    row =>
                      row.actor
                  );


              const viewCount =
                (viewRows || [])
                  .filter(
                    row =>
                      Number(
                        row.video_uid
                      ) === uid
                  )
                  .length;


              const videoIngestions =
                (ingestionRows || [])
                  .filter(
                    row =>
                      Number(
                        row.video_uid
                      ) === uid
                  );


              return {
                ...video,

                actors:
                  videoActors,

                view_count:
                  viewCount,

                ingestion_count:
                  videoIngestions.length,

                ingestions:
                  videoIngestions
              };
            }
          );


        return jsonResponse(
          request,
          {
            success: true,

            action:
              "preview_consolidation",

            fingerprint,

            can_consolidate:
              technicalMatch,

            technical_match:
              technicalMatch,

            technical_comparison: {

              filesize:
                normaliseNumber(
                  videoA.filesize_bytes
                ) ===
                normaliseNumber(
                  videoB.filesize_bytes
                ),

              duration:
                normaliseNumber(
                  videoA.duration_seconds
                ) ===
                normaliseNumber(
                  videoB.duration_seconds
                ),

              resolution:
                (
                  normaliseNumber(
                    videoA.width
                  ) ===
                  normaliseNumber(
                    videoB.width
                  ) &&

                  normaliseNumber(
                    videoA.height
                  ) ===
                  normaliseNumber(
                    videoB.height
                  )
                )
            },

            videos:
              previewVideos
          }
        );
      }


      /* ===============================================================
         CONSOLIDATE DUPLICATE
         =============================================================== */

      if (
        action ===
          "consolidate_duplicate"
      ) {

        const fingerprint =
          String(
            body?.fingerprint || ""
          ).trim();


        const survivorUid =
          Number(
            body?.survivor_uid
          );


        const removedUid =
          Number(
            body?.removed_uid
          );


        /* -------------------------------------------------------------
           REQUEST VALIDATION
           ------------------------------------------------------------- */

        if (
          !fingerprint
        ) {

          return jsonResponse(
            request,
            {
              success: false,
              error:
                "Fingerprint is required."
            },
            400
          );
        }


        if (
          !Number.isInteger(
            survivorUid
          ) ||
          !Number.isInteger(
            removedUid
          )
        ) {

          return jsonResponse(
            request,
            {
              success: false,
              error:
                "Valid survivor_uid and removed_uid values are required."
            },
            400
          );
        }


        if (
          survivorUid ===
            removedUid
        ) {

          return jsonResponse(
            request,
            {
              success: false,
              error:
                "Survivor UID and removed UID must be different."
            },
            400
          );
        }


        /* -------------------------------------------------------------
           RELOAD CURRENT CATALOGUE STATE
           ------------------------------------------------------------- */

        const {
          data: videos,
          error: videosError
        } =
          await adminClient
            .schema("zulu").from("zulu_videos")
            .select(`
              uid,
              film,
              url,
              tags,
              filesize_bytes,
              duration_seconds,
              width,
              height,
              fingerprint,
              ingested_at
            `)
            .in(
              "uid",
              [
                survivorUid,
                removedUid
              ]
            );


        if (
          videosError
        ) {

          throw new Error(
            `Could not revalidate catalogue records: ${videosError.message}`
          );
        }


        if (
          !Array.isArray(videos) ||
          videos.length !== 2
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                "Both catalogue records no longer exist."
            },
            409
          );
        }


        const survivor =
          videos.find(
            video =>
              Number(video.uid) ===
                survivorUid
          );


        const removed =
          videos.find(
            video =>
              Number(video.uid) ===
                removedUid
          );


        if (
          !survivor ||
          !removed
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                "Could not identify both requested catalogue records."
            },
            409
          );
        }


        /* -------------------------------------------------------------
           FINGERPRINT REVALIDATION
           ------------------------------------------------------------- */

        if (
          survivor.fingerprint !==
            fingerprint ||
          removed.fingerprint !==
            fingerprint
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                "Fingerprint validation failed. Refresh Admin before trying again."
            },
            409
          );
        }


        /* -------------------------------------------------------------
           GROUP REVALIDATION

           Require the fingerprint still to identify exactly these two
           records. This prevents a stale two-record preview being used
           if another record subsequently joins the same group.
           ------------------------------------------------------------- */

        const {
          data: currentGroup,
          error: groupError
        } =
          await adminClient
            .schema("zulu").from("zulu_videos")
            .select(
              "uid"
            )
            .eq(
              "fingerprint",
              fingerprint
            )
            .order(
              "uid",
              {
                ascending: true
              }
            );


        if (
          groupError
        ) {

          throw new Error(
            `Could not revalidate duplicate group: ${groupError.message}`
          );
        }


        const currentUids =
          (currentGroup || [])
            .map(
              row =>
                Number(row.uid)
            )
            .sort(
              (a, b) =>
                a - b
            );


        const requestedUids =
          [
            survivorUid,
            removedUid
          ]
            .sort(
              (a, b) =>
                a - b
            );


        if (
          currentUids.length !== 2 ||
          currentUids[0] !==
            requestedUids[0] ||
          currentUids[1] !==
            requestedUids[1]
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                "Duplicate group membership changed after preview. Refresh Admin before trying again.",

              current_uids:
                currentUids
            },
            409
          );
        }


        /* -------------------------------------------------------------
           TECHNICAL REVALIDATION
           ------------------------------------------------------------- */

        if (
          !technicalMetadataMatches(
            survivor,
            removed
          )
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              error:
                "Technical metadata differs between the two records. Automatic consolidation has been blocked."
            },
            409
          );
        }


        /* -------------------------------------------------------------
           DATABASE CONSOLIDATION

           This calls the transactional PostgreSQL function created in
           the previous step.

           If anything inside that RPC fails, PostgreSQL rolls the whole
           database transaction back.
           ------------------------------------------------------------- */

        const {
          data: consolidation,
          error: consolidationError
        } =
          await adminClient.schema("zulu").rpc(
            "zulu_consolidate_duplicate",
            {
              p_survivor_uid:
                survivorUid,

              p_removed_uid:
                removedUid,

              p_fingerprint:
                fingerprint
            }
          );


        if (
          consolidationError
        ) {

          throw new Error(
            `Catalogue consolidation failed: ${consolidationError.message}`
          );
        }


        if (
          !consolidation ||
          consolidation.success !== true
        ) {

          throw new Error(
            "Catalogue consolidation did not return a successful result."
          );
        }


        /* -------------------------------------------------------------
           VERIFY DATABASE RESULT
           ------------------------------------------------------------- */

        const {
          data: postRows,
          error: postRowsError
        } =
          await adminClient
            .schema("zulu").from("zulu_videos")
            .select(`
              uid,
              film,
              url,
              fingerprint
            `)
            .in(
              "uid",
              [
                survivorUid,
                removedUid
              ]
            );


        if (
          postRowsError
        ) {

          throw new Error(
            `Catalogue was consolidated but post-consolidation verification failed: ${postRowsError.message}`
          );
        }


        const survivorStillExists =
          (postRows || [])
            .some(
              row =>
                Number(row.uid) ===
                  survivorUid
            );


        const removedStillExists =
          (postRows || [])
            .some(
              row =>
                Number(row.uid) ===
                  removedUid
            );


        if (
          !survivorStillExists ||
          removedStillExists
        ) {

          /*
           * IMPORTANT:
           *
           * At this point the transactional RPC has already completed,
           * so we do not pretend that this verification failure rolled
           * it back.
           *
           * Instead we report the exact state for manual inspection.
           */

          return jsonResponse(
            request,
            {
              success: false,

              database_consolidation_completed:
                true,

              verification_failed:
                true,

              error:
                "Database consolidation completed but the resulting catalogue state was unexpected.",

              survivor_uid:
                survivorUid,

              removed_uid:
                removedUid,

              current_rows:
                postRows || []
            },
            500
          );
        }


        /* -------------------------------------------------------------
           REFRESH SEARCH MATERIALIZED VIEW

           zulu_videos_search is a materialized view.

           Removing a catalogue record does not automatically remove the
           corresponding stored row from that view, so every successful
           consolidation must rebuild it.

           IMPORTANT:
           The catalogue transaction has already completed at this point.
           A refresh failure therefore must NOT be reported as though the
           catalogue consolidation itself was rolled back.
           ------------------------------------------------------------- */

        const {
          error: searchRefreshError
        } =
          await adminClient.schema("zulu").rpc(
            "zulu_refresh_videos_search"
          );


        if (
          searchRefreshError
        ) {

          console.error(
            "Catalogue consolidation succeeded but zulu_videos_search refresh failed:",
            searchRefreshError
          );


          return jsonResponse(
            request,
            {
              success: false,

              action:
                "consolidate_duplicate",

              catalogue_consolidated:
                true,

              search_refresh_completed:
                false,

              survivor_uid:
                survivorUid,

              removed_uid:
                removedUid,

              fingerprint,

              error:
                `Catalogue consolidation completed, but zulu_videos_search could not be refreshed: ${searchRefreshError.message}`,

              storage_cleanup_required:
                true,

              removed_video_url:
                removed.url,

              removed_thumbnail_uid:
                removedUid
            },
            500
          );
        }


        /* -------------------------------------------------------------
           VERIFY SEARCH RESULT

           Do not merely assume REFRESH succeeded correctly.

           The removed UID must no longer be present and the surviving
           UID must still be represented by the search view.
           ------------------------------------------------------------- */

        const {
          data: searchRows,
          error: searchVerificationError
        } =
          await adminClient
            .schema("zulu").from(
              "zulu_videos_search"
            )
            .select(
              "uid"
            )
            .in(
              "uid",
              [
                survivorUid,
                removedUid
              ]
            );


        if (
          searchVerificationError
        ) {

          console.error(
            "Search materialized view refreshed but verification failed:",
            searchVerificationError
          );


          return jsonResponse(
            request,
            {
              success: false,

              action:
                "consolidate_duplicate",

              catalogue_consolidated:
                true,

              search_refresh_completed:
                true,

              search_verification_completed:
                false,

              survivor_uid:
                survivorUid,

              removed_uid:
                removedUid,

              fingerprint,

              error:
                `Catalogue consolidation and search refresh completed, but search verification failed: ${searchVerificationError.message}`,

              storage_cleanup_required:
                true,

              removed_video_url:
                removed.url,

              removed_thumbnail_uid:
                removedUid
            },
            500
          );
        }


        const survivorInSearch =
          (searchRows || [])
            .some(
              row =>
                Number(
                  row.uid
                ) ===
                  survivorUid
            );


        const removedInSearch =
          (searchRows || [])
            .some(
              row =>
                Number(
                  row.uid
                ) ===
                  removedUid
            );


        if (
          !survivorInSearch ||
          removedInSearch
        ) {

          return jsonResponse(
            request,
            {
              success: false,

              action:
                "consolidate_duplicate",

              catalogue_consolidated:
                true,

              search_refresh_completed:
                true,

              search_verification_completed:
                false,

              error:
                "Catalogue consolidation completed, but the refreshed search view contains an unexpected result.",

              survivor_uid:
                survivorUid,

              removed_uid:
                removedUid,

              survivor_in_search:
                survivorInSearch,

              removed_in_search:
                removedInSearch,

              search_rows:
                searchRows || [],

              storage_cleanup_required:
                true,

              removed_video_url:
                removed.url,

              removed_thumbnail_uid:
                removedUid
            },
            500
          );
        }


        /* -------------------------------------------------------------
           AUDIT RECORD

           Only record 'consolidated' AFTER successful database
           consolidation and verification.
           ------------------------------------------------------------- */

        const reviewRecord = {

          fingerprint,

          decision:
            "consolidated",

          survivor_uid:
            survivorUid,

          removed_uid:
            removedUid,

          reviewed_uids:
            requestedUids,

          reviewed_by:
            user.id,

          reviewed_at:
            new Date().toISOString(),

          notes:
            null
        };


        const {
          data: review,
          error: reviewError
        } =
          await adminClient
            .schema("zulu").from(
              "zulu_duplicate_reviews"
            )
            .upsert(
              reviewRecord,
              {
                onConflict:
                  "fingerprint"
              }
            )
            .select()
            .single();


        /*
         * Audit failure must NOT be represented as catalogue failure.
         *
         * The consolidation has already happened successfully.
         */
        if (
          reviewError
        ) {

          console.error(
            "Catalogue consolidation succeeded but audit record failed:",
            reviewError
          );


          return jsonResponse(
            request,
            {
              success: true,

              action:
                "consolidate_duplicate",

              catalogue_consolidated:
                true,

              search_refresh_completed:
                true,

              search_verification_completed:
                true,


              audit_recorded:
                false,

              audit_error:
                reviewError.message,

              survivor_uid:
                survivorUid,

              removed_uid:
                removedUid,

              fingerprint,

              consolidation,

              storage_cleanup_required:
                true,

              removed_video_url:
                removed.url,

              removed_thumbnail_uid:
                removedUid
            }
          );
        }


        /* -------------------------------------------------------------
           SUCCESS
           ------------------------------------------------------------- */

        return jsonResponse(
          request,
          {
            success: true,

            action:
              "consolidate_duplicate",

            catalogue_consolidated:
              true,

            search_refresh_completed:
              true,

            search_verification_completed:
              true,

            audit_recorded:
              true,
            survivor_uid:
              survivorUid,

            removed_uid:
              removedUid,

            fingerprint,

            survivor: {
              uid:
                survivor.uid,

              film:
                survivor.film,

              url:
                survivor.url
            },

            removed: {
              uid:
                removed.uid,

              film:
                removed.film,

              url:
                removed.url
            },

            consolidation,

            review,

            /*
             * These flags deliberately tell Admin that physical storage
             * cleanup has NOT happened.
             */
            storage_cleanup_required:
              true,

            removed_video_url:
              removed.url,

            removed_thumbnail_uid:
              removedUid
          }
        );
      }


      /* ===============================================================
         UNSUPPORTED ACTION
         =============================================================== */

      return jsonResponse(
        request,
        {
          success: false,

          error:
            `Unsupported catalogue repair action: ${action}`
        },
        400
      );


    } catch (
      error
    ) {

      console.error(
        "ZULU CATALOGUE REPAIR ERROR:",
        error
      );


      return jsonResponse(
        request,
        {
          success: false,

          error:
            error instanceof Error
              ? error.message
              : "Unknown catalogue repair error."
        },
        500
      );
    }
  }
);