import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


/* =====================================================================
   ZULU-ADMIN-DASHBOARD
   =====================================================================

   PURPOSE
   -------

   Provides the protected server-side data source for:

       /admin.html

   The browser must never receive the Supabase service-role key and does
   not need direct SELECT access to protected tables such as:

       public.zulu_ingestions

   This Edge Function:

       • verifies the caller's Supabase JWT
       • optionally restricts access to ZULU_ADMIN_EMAIL
       • creates a service-role Supabase client
       • returns catalogue summary counts
       • returns ingestion health counts
       • returns recent ingestion history
       • runs the protected Catalogue Integrity RPC

   Catalogue Integrity currently checks:

       • duplicate video URLs
       • duplicate video fingerprints
       • videos without actors
       • missing filesize
       • missing duration
       • missing resolution
       • missing fingerprint
       • old / non-canonical media URLs

   Backblaze object reconciliation is deliberately NOT performed here yet.

   ===================================================================== */


/* =====================================================================
   01. ENVIRONMENT
===================================================================== */

const SUPABASE_URL =
  Deno.env.get(
    "SUPABASE_URL"
  ) ?? "";


const SUPABASE_ANON_KEY =
  Deno.env.get(
    "SUPABASE_ANON_KEY"
  ) ?? "";


const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY"
  ) ?? "";


/*
 * Optional administrator restriction.
 *
 * If ZULU_ADMIN_EMAIL is configured, the authenticated user's email must
 * match it before privileged dashboard data is returned.
 */
const ZULU_ADMIN_EMAIL =
  (
    Deno.env.get(
      "ZULU_ADMIN_EMAIL"
    ) ?? ""
  )
    .trim()
    .toLowerCase();


/* =====================================================================
   02. CONFIGURATION
===================================================================== */

/*
 * Both production hostnames are permitted.
 *
 * Authentication/authorization remains the real security boundary.
 * CORS alone must never be treated as authorization.
 */
const ALLOWED_ORIGINS =
  new Set([
    "https://pornflix.zulu-orchid-falcon.co.uk"
  ]);


/*
 * Number of recent ingestion records returned to admin.js.
 */
const RECENT_INGESTION_LIMIT =
  50;


/*
 * States which represent an unfinished ingestion.
 *
 * Terminal states are deliberately excluded:
 *
 *     complete
 *     complete_without_thumbnail
 *     failed
 *     cancelled
 *     duplicate
 */
const INCOMPLETE_INGESTION_STATUSES =
  [
    "pending",
    "analysing",
    "ready",
    "uploading",
    "video_uploaded",
    "cataloguing",
    "catalogued",
    "thumbnail_uploading"
  ];


/* =====================================================================
   03. TYPES
===================================================================== */

interface DashboardCounts {
  videos: number;
  actors: number;
  views: number;
  ingestions: number;
}


interface DashboardHealth {
  complete: number;
  complete_without_thumbnail: number;
  failed: number;
  incomplete: number;
  cancelled: number;
  duplicate: number;
}


/* =====================================================================
   04. CORS
===================================================================== */

/**
 * Builds CORS headers for an approved Pornflix origin.
 *
 * If the request does not come from an approved browser origin, no
 * Access-Control-Allow-Origin header is added.
 */
function getCorsHeaders(
  req: Request
): Record<string, string> {

  const origin =
    req.headers.get(
      "origin"
    ) ?? "";


  const headers:
    Record<string, string> =
  {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Vary":
      "Origin"
  };


  if (
    ALLOWED_ORIGINS.has(
      origin
    )
  ) {

    headers[
      "Access-Control-Allow-Origin"
    ] =
      origin;
  }


  return headers;
}


/**
 * Checks whether a browser request originates from one of the approved
 * Pornflix hostnames.
 *
 * Requests without an Origin header are allowed so the function can
 * still be invoked by trusted server-side tooling.
 */
function isAllowedOrigin(
  req: Request
): boolean {

  const origin =
    req.headers.get(
      "origin"
    );


  if (
    !origin
  ) {

    return true;
  }


  return ALLOWED_ORIGINS.has(
    origin
  );
}


/* =====================================================================
   05. RESPONSE HELPERS
===================================================================== */

/**
 * Creates a JSON response with the appropriate CORS and no-cache headers.
 */
function jsonResponse(
  req: Request,
  body: unknown,
  status = 200
): Response {

  return new Response(
    JSON.stringify(
      body
    ),
    {
      status,

      headers: {
        ...getCorsHeaders(
          req
        ),

        "Content-Type":
          "application/json",

        /*
         * Admin health information should always represent a fresh
         * server-side snapshot.
         */
        "Cache-Control":
          "no-store"
      }
    }
  );
}


/* =====================================================================
   06. QUERY HELPERS
===================================================================== */

/**
 * Extracts an exact count from a Supabase query.
 *
 * Throws immediately if Supabase returned an error so the dashboard
 * cannot silently display a misleading zero.
 */
function getExactCount(
  label: string,
  result: {
    count: number | null;
    error: {
      message?: string;
    } | null;
  }
): number {

  if (
    result.error
  ) {

    throw new Error(
      `${label}: ${
        result.error.message ??
        "Supabase query failed"
      }`
    );
  }


  return result.count ?? 0;
}


/* =====================================================================
   07. REQUEST HANDLER
===================================================================== */

Deno.serve(
  async (
    req: Request
  ) => {

    const corsHeaders =
      getCorsHeaders(
        req
      );


    /* =================================================================
       07A. CORS PREFLIGHT
    ================================================================= */

    if (
      req.method ===
      "OPTIONS"
    ) {

      if (
        !isAllowedOrigin(
          req
        )
      ) {

        return new Response(
          null,
          {
            status:
              403,

            headers:
              corsHeaders
          }
        );
      }


      return new Response(
        null,
        {
          status:
            204,

          headers:
            corsHeaders
        }
      );
    }


    /* =================================================================
       07B. METHOD VALIDATION
    ================================================================= */

    if (
      req.method !==
      "POST"
    ) {

      return jsonResponse(
        req,
        {
          success:
            false,

          error:
            "Method not allowed."
        },
        405
      );
    }

        /* =================================================================
       07C. ORIGIN VALIDATION
    ================================================================= */

    if (
      !isAllowedOrigin(
        req
      )
    ) {

      return jsonResponse(
        req,
        {
          success:
            false,

          error:
            "Origin not allowed."
        },
        403
      );
    }


    try {

      /* ===============================================================
         08. ENVIRONMENT VALIDATION
      =============================================================== */

      if (
        !SUPABASE_URL ||
        !SUPABASE_ANON_KEY ||
        !SUPABASE_SERVICE_ROLE_KEY
      ) {

        throw new Error(
          "Required Supabase environment variables are not configured."
        );
      }


      /* ===============================================================
         09. AUTHENTICATION HEADER
      =============================================================== */

      const authorization =
        req.headers.get(
          "Authorization"
        );


      if (
        !authorization?.startsWith(
          "Bearer "
        )
      ) {

        return jsonResponse(
          req,
          {
            success:
              false,

            error:
              "Authentication required."
          },
          401
        );
      }


      const accessToken =
        authorization
          .slice(
            "Bearer ".length
          )
          .trim();


      if (
        !accessToken
      ) {

        return jsonResponse(
          req,
          {
            success:
              false,

            error:
              "Authentication required."
          },
          401
        );
      }


      /* ===============================================================
         10. VERIFY AUTHENTICATED USER
      =============================================================== */

      /*
       * This client uses the anon key solely to verify the caller's JWT.
       *
       * It is NOT used to read protected dashboard data.
       */
      const authClient =
        createClient(
          SUPABASE_URL,
          SUPABASE_ANON_KEY,
          {
            auth: {
              persistSession:
                false,

              autoRefreshToken:
                false
            }
          }
        );


      const {
        data: {
          user
        },
        error:
          userError
      } =
        await authClient.auth.getUser(
          accessToken
        );


      if (
        userError ||
        !user
      ) {

        return jsonResponse(
          req,
          {
            success:
              false,

            error:
              "Invalid or expired session."
          },
          401
        );
      }


      /* ===============================================================
         11. ADMIN AUTHORIZATION
      =============================================================== */

      /*
       * If ZULU_ADMIN_EMAIL has been configured, only that account is
       * permitted to retrieve the privileged dashboard.
       *
       * This is deliberately performed here on the server.
       *
       * Showing or hiding an Admin menu option in the browser is not
       * considered a security mechanism.
       */
      if (
        ZULU_ADMIN_EMAIL
      ) {

        const userEmail =
          (
            user.email ?? ""
          )
            .trim()
            .toLowerCase();


        if (
          userEmail !==
          ZULU_ADMIN_EMAIL
        ) {

          return jsonResponse(
            req,
            {
              success:
                false,

              error:
                "Administrator access required."
            },
            403
          );
        }
      }


      /* ===============================================================
         12. PRIVILEGED SUPABASE CLIENT
      =============================================================== */

      /*
       * The service-role key bypasses RLS.
       *
       * It exists only inside this Edge Function and must never be
       * returned to admin.js or embedded in the website.
       */
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
         13. DASHBOARD QUERIES
      =============================================================== */

      /*
       * All independent dashboard queries are performed concurrently.
       *
       * Health counts are calculated separately from recent ingestion
       * history so the figures always cover the complete journal even
       * though the activity table is limited to 50 rows.
       *
       * Catalogue Integrity is calculated inside PostgreSQL by the
       * protected zulu_catalogue_integrity() RPC.
       */
      const [
        videosResult,
        actorsResult,
        viewsResult,
        ingestionsResult,

        completeResult,
        noThumbnailResult,
        failedResult,
        incompleteResult,
        cancelledResult,
        duplicateResult,

        recentResult,
        integrityResult
      ] =
        await Promise.all([

          /* -----------------------------------------------------------
             Catalogue video count
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_videos"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            ),


          /* -----------------------------------------------------------
             Distinct actor count
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_distinct_actors"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            ),


          /* -----------------------------------------------------------
             Recorded video view count
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_video_views"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            ),


          /* -----------------------------------------------------------
             Total ingestion count
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            ),


          /* -----------------------------------------------------------
             Complete ingestions
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            )
            .eq(
              "status",
              "complete"
            ),


          /* -----------------------------------------------------------
             Complete without thumbnail
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            )
            .eq(
              "status",
              "complete_without_thumbnail"
            ),


          /* -----------------------------------------------------------
             Failed ingestions
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            )
            .eq(
              "status",
              "failed"
            ),


          /* -----------------------------------------------------------
             Incomplete ingestions
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            )
            .in(
              "status",
              INCOMPLETE_INGESTION_STATUSES
            ),


          /* -----------------------------------------------------------
             Cancelled ingestions
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            )
            .eq(
              "status",
              "cancelled"
            ),


          /* -----------------------------------------------------------
             Duplicate ingestions
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              "*",
              {
                count:
                  "exact",

                head:
                  true
              }
            )
            .eq(
              "status",
              "duplicate"
            ),


          /* -----------------------------------------------------------
             Recent ingestion history
          ----------------------------------------------------------- */

          adminClient
            .schema("zulu").from(
              "zulu_ingestions"
            )
            .select(
              `
                id,
                original_filename,
                canonical_filename,
                film,
                filesize_bytes,
                fingerprint,
                status,
                failed_stage,
                error_message,
                backblaze_file_id,
                public_url,
                video_uploaded_at,
                video_uid,
                catalogued_at,
                thumbnail_status,
                thumbnail_uploaded_at,
                created_at,
                updated_at,
                completed_at
              `
            )
            .order(
              "created_at",
              {
                ascending:
                  false
              }
            )
            .limit(
              RECENT_INGESTION_LIMIT
            ),


          /* -----------------------------------------------------------
             Catalogue Integrity
          ----------------------------------------------------------- */

          adminClient.schema("zulu").rpc(
            "zulu_catalogue_integrity"
          )
        ]);

              /* ===============================================================
         14. LIBRARY COUNTS
      =============================================================== */

      const library:
        DashboardCounts =
      {
        videos:
          getExactCount(
            "Video count",
            videosResult
          ),

        actors:
          getExactCount(
            "Actor count",
            actorsResult
          ),

        views:
          getExactCount(
            "View count",
            viewsResult
          ),

        ingestions:
          getExactCount(
            "Ingestion count",
            ingestionsResult
          )
      };


      /* ===============================================================
         15. INGESTION HEALTH
      =============================================================== */

      const health:
        DashboardHealth =
      {
        complete:
          getExactCount(
            "Complete ingestion count",
            completeResult
          ),

        complete_without_thumbnail:
          getExactCount(
            "Without-thumbnail ingestion count",
            noThumbnailResult
          ),

        failed:
          getExactCount(
            "Failed ingestion count",
            failedResult
          ),

        incomplete:
          getExactCount(
            "Incomplete ingestion count",
            incompleteResult
          ),

        cancelled:
          getExactCount(
            "Cancelled ingestion count",
            cancelledResult
          ),

        duplicate:
          getExactCount(
            "Duplicate ingestion count",
            duplicateResult
          )
      };


      /* ===============================================================
         16. RECENT INGESTION VALIDATION
      =============================================================== */

      if (
        recentResult.error
      ) {

        throw new Error(
          `Recent ingestions: ${
            recentResult.error.message
          }`
        );
      }


      /* ===============================================================
         17. CATALOGUE INTEGRITY VALIDATION
      =============================================================== */

      if (
        integrityResult.error
      ) {

        throw new Error(
          `Catalogue integrity: ${
            integrityResult.error.message
          }`
        );
      }


      if (
        !integrityResult.data
      ) {

        throw new Error(
          "Catalogue integrity returned no data."
        );
      }



      /* ===============================================================
        17A. ENRICH DUPLICATE FINGERPRINT GROUPS
      =============================================================== */

      /*
       * zulu_catalogue_integrity() identifies the duplicate groups, but its
       * compact diagnostic rows are not sufficient for an administrator to
       * decide whether two catalogue entries are genuinely duplicates.
       *
       * For the Admin page only, enrich those groups with the complete
       * catalogue metadata required for human comparison.
       *
       * This remains READ ONLY.
       */

      const integrity =
        structuredClone(
          integrityResult.data
        );


      const duplicateFingerprintSection =
        integrity?.duplicate_fingerprints;


      const duplicateFingerprintRows =
        Array.isArray(
          duplicateFingerprintSection?.rows
        )
          ? duplicateFingerprintSection.rows
          : [];


      /*
       * Collect every UID mentioned by the duplicate-fingerprint diagnostic.
       */
      const duplicateUids =
        [
          ...new Set(
            duplicateFingerprintRows
              .flatMap(
                (
                  group: any
                ) => {

                  if (
                    Array.isArray(
                      group?.uids
                    )
                  ) {

                    return group.uids;
                  }


                  if (
                    group?.uid !==
                      undefined &&
                    group?.uid !==
                      null
                  ) {

                    return [
                      group.uid
                    ];
                  }


                  return [];
                }
              )
              .map(
                (
                  uid: unknown
                ) =>
                  Number(
                    uid
                  )
              )
              .filter(
                (
                  uid: number
                ) =>
                  Number.isInteger(
                    uid
                  ) &&
                  uid > 0
              )
          )
        ];


      let duplicateVideos:
        any[] =
          [];


      if (
        duplicateUids.length
      ) {

        const {
          data,
          error
        } =
          await adminClient
            .schema("zulu").from(
              "zulu_videos"
            )
            .select(
              `
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
              `
            )
            .in(
              "uid",
              duplicateUids
            )
            .order(
              "uid",
              {
                ascending:
                  true
              }
            );


        if (
          error
        ) {

          throw new Error(
            `Duplicate fingerprint details: ${
              error.message
            }`
          );
        }


        duplicateVideos =
          data ?? [];
      }


      /*
       * Index the catalogue rows by UID so each diagnostic group can be
       * populated without repeatedly scanning the complete result.
       */
      const duplicateVideoByUid =
        new Map(
          duplicateVideos.map(
            video => [
              Number(
                video.uid
              ),
              video
            ]
          )
        );


      if (
        duplicateFingerprintSection &&
        Array.isArray(
          duplicateFingerprintSection.rows
        )
      ) {

        duplicateFingerprintSection.rows =
          duplicateFingerprintRows.map(
            (
              group: any
            ) => {

              const groupUids =
                Array.isArray(
                  group?.uids
                )
                  ? group.uids
                  : (
                      group?.uid !==
                        undefined &&
                      group?.uid !==
                        null
                        ? [
                            group.uid
                          ]
                        : []
                    );


              const videos =
                groupUids
                  .map(
                    (
                      uid: unknown
                    ) =>
                      duplicateVideoByUid.get(
                        Number(
                          uid
                        )
                      )
                  )
                  .filter(
                    Boolean
                  );


              return {
                ...group,

                videos
              };
            }
          );
      }

            /* ===============================================================
         18. SUCCESSFUL RESPONSE
      =============================================================== */

      /*
       * The browser receives only the data needed to render the Admin
       * dashboard.
       *
       * No service-role credentials or other privileged secrets are
       * included in this response.
       */
      return jsonResponse(
        req,
        {
          success:
            true,

          generated_at:
            new Date().toISOString(),

          library,

          health,

          recent_ingestions:
            recentResult.data ?? [],

          integrity:
            integrity
        }
      );


    } catch (
      error
    ) {

      /* ===============================================================
         19. ERROR HANDLING
      =============================================================== */

      console.error(
        "zulu-admin-dashboard error:",
        error
      );


      const message =
        error instanceof Error
          ? error.message
          : "Unexpected dashboard error.";


      return jsonResponse(
        req,
        {
          success:
            false,

          error:
            message
        },
        500
      );
    }
  }
);