import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";


/* =====================================================================
   ZULU-INGESTION-STATUS
   =====================================================================

   PURPOSE
   -------

   Provides a controlled server-side API for the Add Video ingestion
   manager.

   The browser uses this Edge Function to:

       1. Create a persistent ingestion record immediately after an MP4
          is selected.
       2. Update permitted ingestion stages.
       3. Add metadata that becomes available after local analysis.
       4. Record fatal ingestion failures.
       5. Mark an ingestion complete.
       6. Mark an ingestion complete without a thumbnail.

   The browser is deliberately NOT given unrestricted write access to
   zulu.zulu_ingestions.


   INGESTION LIFECYCLE
   -------------------

       MP4 selected
            ↓
         pending
            ↓
        analysing
            ↓
          ready
            ↓
        uploading
            ↓
     video_uploaded
            ↓
       cataloguing          ← zulu-finalize-video
            ↓
        catalogued          ← zulu-finalize-video
            ↓
   thumbnail_uploading
            ↓
        complete

   Alternative final state:

       complete_without_thumbnail


   RESPONSIBILITY SPLIT
   --------------------

   zulu-ingestion-status owns browser-controlled states:

       pending
       analysing
       ready
       uploading
       video_uploaded
       thumbnail_uploading
       complete
       complete_without_thumbnail
       failed
       duplicate
       cancelled


   zulu-finalize-video owns catalogue states:

       cataloguing
       catalogued


   The browser must therefore never be able to claim that catalogue
   creation succeeded when the server has not actually completed it.

   ===================================================================== */


/* =====================================================================
   01. CORS
   ===================================================================== */

const corsHeaders = {

  "Access-Control-Allow-Origin":
    "https://pornflix.zulu-orchid-falcon.co.uk",

  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",

  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
};


/* =====================================================================
   02. RESPONSE HELPER
   ===================================================================== */

/**
 * Returns a JSON response with the required CORS headers.
 *
 * @param body   JSON-serialisable response body.
 * @param status HTTP response status.
 */
function jsonResponse(
  body: unknown,
  status = 200
) {

  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        ...corsHeaders,

        "Content-Type":
          "application/json"
      }
    }
  );
}


/* =====================================================================
   03. SUPPORTED ACTIONS
   ===================================================================== */

type IngestionAction =
  | "create"
  | "update"
  | "fail"
  | "complete";


/* =====================================================================
   04. BROWSER-CONTROLLED INGESTION STATUS VALUES
   =====================================================================

   IMPORTANT:

   "cataloguing" and "catalogued" are deliberately absent.

   Those states may only be written by zulu-finalize-video.
===================================================================== */

const browserStatuses =
  new Set([
    "pending",
    "analysing",
    "ready",
    "uploading",
    "video_uploaded",
    "thumbnail_uploading",
    "complete",
    "complete_without_thumbnail",
    "failed",
    "duplicate",
    "cancelled"
  ]);


/* =====================================================================
   05. THUMBNAIL STATUS VALUES
   ===================================================================== */

const thumbnailStatuses =
  new Set([
    "pending",
    "generating",
    "ready",
    "uploading",
    "uploaded",
    "failed",
    "skipped"
  ]);


/* =====================================================================
   06. REQUEST PAYLOAD
   ===================================================================== */

interface IngestionPayload {

  /*
   * Operation requested by the browser.
   */
  action:
    IngestionAction;


  /*
   * Required for every action except "create".
   */
  ingestion_id?:
    string;


  /*
   * Source information.
   *
   * original_filename and filesize_bytes are available immediately
   * when the user selects the local MP4.
   */
  original_filename?:
    string;

  filesize_bytes?:
    number;


  /*
   * Analysis-derived information.
   *
   * These may not exist when the ingestion is first created.
   *
   * They can subsequently be supplied through action="update".
   */
  canonical_filename?:
    string;

  film?:
    string;

  fingerprint?:
    string;


  /*
   * Ordinary ingestion state.
   */
  status?:
    string;


  /*
   * Backblaze information.
   */
  public_url?:
    string;

  backblaze_file_id?:
    string;


  /*
   * Catalogue information.
   *
   * The browser does not normally need to set video_uid because
   * zulu-finalize-video owns catalogue creation.
   *
   * It remains represented in the payload interface for future
   * controlled repair/admin operations, but is not currently written
   * by the normal update action.
   */
  video_uid?:
    number;


  /*
   * Thumbnail state.
   */
  thumbnail_status?:
    string;


  /*
   * Failure information.
   */
  failed_stage?:
    string;

  error_message?:
    string;
}


/* =====================================================================
   07. UUID VALIDATION
   ===================================================================== */

/**
 * Performs basic UUID format validation.
 *
 * PostgreSQL remains the ultimate authority, but rejecting obviously
 * malformed IDs here gives the browser a clearer response.
 *
 * @param value Candidate UUID.
 */
function isValidUuid(
  value: string
) {

  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  );
}


/* =====================================================================
   08. ERROR MESSAGE NORMALISATION
   ===================================================================== */

/**
 * Converts an unknown thrown value into a useful string.
 *
 * This is primarily used for server logging and unexpected Edge
 * Function failures.
 *
 * @param error Unknown thrown value.
 */
function getErrorMessage(
  error: unknown
) {

  if (
    error instanceof Error
  ) {

    return error.message;
  }


  if (
    typeof error === "string"
  ) {

    return error;
  }


  return "Unknown ingestion error";
}


/* =====================================================================
   09. MAIN EDGE FUNCTION
   ===================================================================== */

Deno.serve(async req => {

  /* -----------------------------------------------------------------
     CORS PREFLIGHT
  ----------------------------------------------------------------- */

  if (
    req.method === "OPTIONS"
  ) {

    return new Response(
      "ok",
      {
        headers:
          corsHeaders
      }
    );
  }


  /* -----------------------------------------------------------------
     ONLY POST IS SUPPORTED
  ----------------------------------------------------------------- */

  if (
    req.method !== "POST"
  ) {

    return jsonResponse(
      {
        error:
          "Method not allowed"
      },
      405
    );
  }


  try {

    /* ===============================================================
       10. VERIFY AUTHORIZATION HEADER
       =============================================================== */

    const authHeader =
      req.headers.get(
        "Authorization"
      );


    if (
      !authHeader
        ?.startsWith(
          "Bearer "
        )
    ) {

      return jsonResponse(
        {
          error:
            "Unauthorized"
        },
        401
      );
    }


    const accessToken =
      authHeader.slice(7);


    /* ===============================================================
       11. LOAD SERVER CONFIGURATION
       =============================================================== */

    const supabaseUrl =
      Deno.env.get(
        "SUPABASE_URL"
      );


    const supabaseAnonKey =
      Deno.env.get(
        "SUPABASE_ANON_KEY"
      );


    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      );


    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !serviceRoleKey
    ) {

      return jsonResponse(
        {
          error:
            "Server configuration error"
        },
        500
      );
    }


    /* ===============================================================
       12. VERIFY LOGGED-IN USER
       =============================================================== */

    const authClient =
      createClient(
        supabaseUrl,
        supabaseAnonKey
      );


    const {
      data: {
        user
      },

      error:
        userError
    } =
      await authClient.auth
        .getUser(
          accessToken
        );


    if (
      userError ||
      !user
    ) {

      return jsonResponse(
        {
          error:
            "Unauthorized"
        },
        401
      );
    }


    /* ===============================================================
       13. OPTIONAL ADMIN-ONLY RESTRICTION
       =============================================================== */

    const adminEmail =
      Deno.env.get(
        "ZULU_ADMIN_EMAIL"
      );


    if (
      adminEmail &&
      user.email
        ?.toLowerCase() !==
        adminEmail
          .toLowerCase()
    ) {

      return jsonResponse(
        {
          error:
            "Forbidden"
        },
        403
      );
    }


    /* ===============================================================
       14. CREATE SERVICE-ROLE DATABASE CLIENT
       =============================================================== */

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey
      );


    /* ===============================================================
       15. READ REQUEST PAYLOAD
       =============================================================== */

    const payload:
      IngestionPayload =
        await req.json();


    const action =
      payload.action;


    if (
      !action ||
      ![
        "create",
        "update",
        "fail",
        "complete"
      ].includes(action)
    ) {

      return jsonResponse(
        {
          error:
            "Invalid ingestion action"
        },
        400
      );
    }


    /* =================================================================
       16. ACTION: CREATE
       =================================================================

       Creates the persistent ingestion journal immediately after the
       user selects an MP4.

       IMPORTANT:

       At this point video analysis may not yet have happened.

       Therefore we deliberately require only information that is known
       immediately from the File object:

           original_filename
           filesize_bytes

       The following values are intentionally NOT required yet:

           film
           canonical_filename
           fingerprint

       They are added later using action="update" after local video
       analysis succeeds.

       Initial state:

           status            = pending
           thumbnail_status  = pending
    ================================================================= */

    if (
      action === "create"
    ) {

      const originalFilename =
        payload.original_filename
          ?.trim();


      /* ---------------------------------------------------------------
         Validate original filename.
      --------------------------------------------------------------- */

      if (
        !originalFilename
      ) {

        return jsonResponse(
          {
            error:
              "Missing original filename"
          },
          400
        );
      }


      /* ---------------------------------------------------------------
         Validate file size.
      --------------------------------------------------------------- */

      if (
        !Number.isFinite(
          payload.filesize_bytes
        ) ||
        payload.filesize_bytes! <= 0
      ) {

        return jsonResponse(
          {
            error:
              "Invalid ingestion file size"
          },
          400
        );
      }


      const now =
        new Date()
          .toISOString();


      /* ---------------------------------------------------------------
         Create ingestion journal record.
      --------------------------------------------------------------- */

      const {
        data:
          ingestion,

        error:
          createError
      } =
        await supabase
          .schema("zulu").from(
            "zulu_ingestions"
          )
          .insert({

            original_filename:
              originalFilename,

            filesize_bytes:
              payload.filesize_bytes,

            status:
              "pending",

            thumbnail_status:
              "pending",

            created_at:
              now,

            updated_at:
              now
          })
          .select(
            "*"
          )
          .single();


      if (
        createError
      ) {

        throw createError;
      }


      return jsonResponse({
        success:
          true,

        ingestion
      });
    }


    /* =================================================================
       17. ALL REMAINING ACTIONS REQUIRE AN INGESTION ID
       ================================================================= */

    const ingestionId =
      payload.ingestion_id
        ?.trim();


    if (
      !ingestionId ||
      !isValidUuid(
        ingestionId
      )
    ) {

      return jsonResponse(
        {
          error:
            "Invalid ingestion ID"
        },
        400
      );
    }


    /* =================================================================
       18. LOAD EXISTING INGESTION
       =================================================================

       Loading the record before changing it lets us:

           - verify it exists;
           - inspect its current state;
           - enforce completion rules;
           - preserve useful state when recording failures.
    ================================================================= */

    const {
      data:
        ingestion,

      error:
        ingestionError
    } =
      await supabase
        .schema("zulu").from(
          "zulu_ingestions"
        )
        .select(
          "*"
        )
        .eq(
          "id",
          ingestionId
        )
        .maybeSingle();


    if (
      ingestionError
    ) {

      throw ingestionError;
    }


    if (
      !ingestion
    ) {

      return jsonResponse(
        {
          error:
            "Ingestion record not found"
        },
        404
      );
    }


    /* =================================================================
       19. ACTION: UPDATE
       =================================================================

       Handles ordinary browser-controlled ingestion changes.

       Examples:

           pending
               ↓
           analysing

           analysing
               ↓
           ready

           ready
               ↓
           uploading

           uploading
               ↓
           video_uploaded

           catalogued
               ↓
           thumbnail_uploading


       This action can also enrich the ingestion record after local
       analysis with:

           film
           canonical_filename
           fingerprint


       The browser may NOT use this action to write:

           cataloguing
           catalogued

       Those statuses belong exclusively to zulu-finalize-video.
    ================================================================= */

    if (
      action === "update"
    ) {

      const newStatus =
        payload.status;


      /* ---------------------------------------------------------------
         Validate requested status.
      --------------------------------------------------------------- */

      if (
        !newStatus ||
        !browserStatuses.has(
          newStatus
        )
      ) {

        return jsonResponse(
          {
            error:
              "Invalid browser-controlled ingestion status"
          },
          400
        );
      }


      /* ---------------------------------------------------------------
         Completion and failure have dedicated actions.
      --------------------------------------------------------------- */

      if (
        newStatus ===
          "complete" ||
        newStatus ===
          "complete_without_thumbnail" ||
        newStatus ===
          "failed"
      ) {

        return jsonResponse(
          {
            error:
              "Use the dedicated completion or failure action"
          },
          400
        );
      }


      /* ---------------------------------------------------------------
         Defence against browser-written catalogue states.
      --------------------------------------------------------------- */

      if (
        newStatus ===
          "cataloguing" ||
        newStatus ===
          "catalogued"
      ) {

        return jsonResponse(
          {
            error:
              "Catalogue status is server controlled"
          },
          403
        );
      }


      const now =
        new Date()
          .toISOString();


      const updateData:
        Record<string, unknown> = {

          status:
            newStatus,

          updated_at:
            now
        };


      /* ---------------------------------------------------------------
         OPTIONAL FILM TITLE
         ---------------------------------------------------------------

         This normally becomes final after the user has selected a file
         and the proposed title has been populated in the form.
      --------------------------------------------------------------- */

      if (
        payload.film !==
          undefined
      ) {

        const film =
          payload.film
            .trim();


        if (
          !film
        ) {

          return jsonResponse(
            {
              error:
                "Invalid film title"
            },
            400
          );
        }


        updateData.film =
          film;
      }


      /* ---------------------------------------------------------------
         OPTIONAL CANONICAL FILENAME
         ---------------------------------------------------------------

         Example:

             Original:
                 Some Source Filename 1080p.mp4

             Film:
                 Hugo Dupre with Eduell Levine

             Canonical:
                 Hugo Dupre with Eduell Levine.mp4
      --------------------------------------------------------------- */

      if (
        payload.canonical_filename !==
          undefined
      ) {

        const canonicalFilename =
          payload.canonical_filename
            .trim();


        if (
          !canonicalFilename
        ) {

          return jsonResponse(
            {
              error:
                "Invalid canonical filename"
            },
            400
          );
        }


        updateData.canonical_filename =
          canonicalFilename;
      }


      /* ---------------------------------------------------------------
         OPTIONAL VIDEO FINGERPRINT
         ---------------------------------------------------------------

         add-video.js generates a 64-character SHA-256 fingerprint from
         selected chunks of the MP4.

         It becomes available only after local analysis has completed.
      --------------------------------------------------------------- */

      if (
        payload.fingerprint !==
          undefined
      ) {

        const fingerprint =
          payload.fingerprint
            .trim()
            .toLowerCase();


        if (
          !/^[0-9a-f]{64}$/i
            .test(
              fingerprint
            )
        ) {

          return jsonResponse(
            {
              error:
                "Invalid ingestion fingerprint"
            },
            400
          );
        }


        updateData.fingerprint =
          fingerprint;
      }


      /* ---------------------------------------------------------------
         OPTIONAL PUBLIC MEDIA URL
         ---------------------------------------------------------------

         Normally supplied immediately after the MP4 has successfully
         reached Backblaze.

         The public URL uses the Cloudflare media hostname.
      --------------------------------------------------------------- */

      if (
        payload.public_url !==
          undefined
      ) {

        const publicUrl =
          payload.public_url
            .trim();


        if (
          !publicUrl
        ) {

          return jsonResponse(
            {
              error:
                "Invalid public URL"
            },
            400
          );
        }


        updateData.public_url =
          publicUrl;
      }


      /* ---------------------------------------------------------------
         OPTIONAL BACKBLAZE FILE ID
         ---------------------------------------------------------------

         Some Backblaze upload responses expose the underlying B2 file
         ID.

         We store it when available, but ingestion does not depend on it.
      --------------------------------------------------------------- */

      if (
        payload.backblaze_file_id !==
          undefined
      ) {

        const backblazeFileId =
          payload.backblaze_file_id
            .trim();


        if (
          !backblazeFileId
        ) {

          return jsonResponse(
            {
              error:
                "Invalid Backblaze file ID"
            },
            400
          );
        }


        updateData.backblaze_file_id =
          backblazeFileId;
      }


      /* ---------------------------------------------------------------
         OPTIONAL THUMBNAIL STATUS
      --------------------------------------------------------------- */

      if (
        payload.thumbnail_status !==
          undefined
      ) {

        if (
          !thumbnailStatuses.has(
            payload.thumbnail_status
          )
        ) {

          return jsonResponse(
            {
              error:
                "Invalid thumbnail status"
            },
            400
          );
        }


        updateData.thumbnail_status =
          payload.thumbnail_status;
      }


      /* ---------------------------------------------------------------
         AUTOMATIC VIDEO-UPLOAD TIMESTAMP
         ---------------------------------------------------------------

         When the browser reports video_uploaded, record when the MP4
         reached persistent Backblaze storage.
      --------------------------------------------------------------- */

      if (
        newStatus ===
          "video_uploaded"
      ) {

        updateData.video_uploaded_at =
          now;
      }


      /* ---------------------------------------------------------------
         AUTOMATIC THUMBNAIL-UPLOAD TIMESTAMP
      --------------------------------------------------------------- */

      if (
        payload.thumbnail_status ===
          "uploaded"
      ) {

        updateData.thumbnail_uploaded_at =
          now;
      }


      /* ---------------------------------------------------------------
         PERFORM UPDATE
      --------------------------------------------------------------- */

      const {
        data:
          updatedIngestion,

        error:
          updateError
      } =
        await supabase
          .schema("zulu").from(
            "zulu_ingestions"
          )
          .update(
            updateData
          )
          .eq(
            "id",
            ingestionId
          )
          .select(
            "*"
          )
          .single();


      if (
        updateError
      ) {

        throw updateError;
      }


      return jsonResponse({
        success:
          true,

        ingestion:
          updatedIngestion
      });
    }


    /* =================================================================
       20. ACTION: FAIL
       =================================================================

       Records a fatal ingestion failure.

       Examples:

           video analysis failure
           fingerprint failure
           duplicate-check infrastructure failure
           Backblaze upload failure
           catalogue failure


       IMPORTANT:

       Thumbnail generation/upload failure is normally NOT fatal.

       Once the MP4 and catalogue record exist, thumbnail failure should
       ultimately produce:

           complete_without_thumbnail

       rather than:

           failed
    ================================================================= */

    if (
      action === "fail"
    ) {

      const failedStage =
        payload.failed_stage
          ?.trim() ||
        ingestion.status;


      const errorMessage =
        payload.error_message
          ?.trim() ||
        "Unknown ingestion error";


      const now =
        new Date()
          .toISOString();


      const {
        data:
          failedIngestion,

        error:
          failError
      } =
        await supabase
          .schema("zulu").from(
            "zulu_ingestions"
          )
          .update({

            status:
              "failed",

            failed_stage:
              failedStage,

            error_message:
              errorMessage,

            updated_at:
              now
          })
          .eq(
            "id",
            ingestionId
          )
          .select(
            "*"
          )
          .single();


      if (
        failError
      ) {

        throw failError;
      }


      return jsonResponse({
        success:
          true,

        ingestion:
          failedIngestion
      });
    }


    /* =================================================================
       21. ACTION: COMPLETE
       =================================================================

       Marks the complete ingestion workflow as finished.

       Two valid final outcomes exist:


       COMPLETE
       --------

           MP4             ✓
           Catalogue       ✓
           Thumbnail       ✓

       Database:

           status =
               complete

           thumbnail_status =
               uploaded


       COMPLETE WITHOUT THUMBNAIL
       --------------------------

           MP4             ✓
           Catalogue       ✓
           Thumbnail       ✗ / skipped

       Database:

           status =
               complete_without_thumbnail

           thumbnail_status =
               failed

       or:

           thumbnail_status =
               skipped


       Completion is allowed only after zulu-finalize-video has already
       placed the ingestion into "catalogued", or while the browser is
       performing the optional thumbnail-uploading stage.
    ================================================================= */

    if (
      action === "complete"
    ) {

      /* ---------------------------------------------------------------
         Validate current ingestion state.
      --------------------------------------------------------------- */

      /*
      * Completion is normally performed immediately after catalogue creation.
      *
      * An ingestion which originally completed without a thumbnail may also
      * be upgraded later when Thumbnail Review successfully creates one.
      *
      * Valid paths:
      *
      *     catalogued
      *         → complete / complete_without_thumbnail
      *
      *     thumbnail_uploading
      *         → complete / complete_without_thumbnail
      *
      *     complete_without_thumbnail
      *         → complete
      */
      const completingExistingMissingThumbnail =
        ingestion.status ===
          "complete_without_thumbnail";


      if (
        ingestion.status !==
          "catalogued" &&
        ingestion.status !==
          "thumbnail_uploading" &&
        !completingExistingMissingThumbnail
      ) {

        return jsonResponse(
          {
            error:
              `Cannot complete ingestion from status "${ingestion.status}"`
          },
          409
        );
      }

      /* ---------------------------------------------------------------
         Validate final thumbnail state.
      --------------------------------------------------------------- */

      const thumbnailStatus =
        payload.thumbnail_status;


      if (
        !thumbnailStatus ||
        ![
          "uploaded",
          "failed",
          "skipped"
        ].includes(
          thumbnailStatus
        )
      ) {

        return jsonResponse(
          {
            error:
              "Completion requires a final thumbnail status"
          },
          400
        );
      }

      /*
      * Once an ingestion has already reached
      * complete_without_thumbnail, this endpoint may only improve it by
      * recording a subsequently uploaded thumbnail.
      *
      * Do not allow an already-completed ingestion to be "completed" again
      * as failed/skipped.
      */
      if (
        completingExistingMissingThumbnail &&
        thumbnailStatus !==
          "uploaded"
      ) {

        return jsonResponse(
          {
            error:
              "A completed ingestion without a thumbnail may only be upgraded with an uploaded thumbnail"
          },
          409
        );
      }

      /* ---------------------------------------------------------------
         Determine overall final ingestion state.
      --------------------------------------------------------------- */

      const finalStatus =
        thumbnailStatus ===
          "uploaded"
          ? "complete"
          : "complete_without_thumbnail";


      const now =
        new Date()
          .toISOString();


      const updateData:
        Record<string, unknown> = {

          status:
            finalStatus,

          thumbnail_status:
            thumbnailStatus,

          failed_stage:
            null,

          /*
           * Thumbnail failure is deliberately not treated as the primary
           * ingestion error because the video itself has been ingested.
           *
           * Library Health can identify the problem through
           * thumbnail_status.
           */
          error_message:
            null,

          completed_at:
            now,

          updated_at:
            now
        };


      /* ---------------------------------------------------------------
         Record successful thumbnail upload time.
      --------------------------------------------------------------- */

      if (
        thumbnailStatus ===
          "uploaded"
      ) {

        updateData.thumbnail_uploaded_at =
          now;
      }


      /* ---------------------------------------------------------------
         PERFORM COMPLETION UPDATE
      --------------------------------------------------------------- */

      const {
        data:
          completedIngestion,

        error:
          completeError
      } =
        await supabase
          .schema("zulu").from(
            "zulu_ingestions"
          )
          .update(
            updateData
          )
          .eq(
            "id",
            ingestionId
          )
          .select(
            "*"
          )
          .single();


      if (
        completeError
      ) {

        throw completeError;
      }


      return jsonResponse({
        success:
          true,

        ingestion:
          completedIngestion
      });
    }


    /* =================================================================
       22. DEFENSIVE FALLBACK
       =================================================================

       The initial action validation should make this unreachable, but it
       protects the function if action handling is changed later.
    ================================================================= */

    return jsonResponse(
      {
        error:
          "Unsupported ingestion action"
      },
      400
    );


  } catch (error) {

    /* =================================================================
       23. UNEXPECTED SERVER FAILURE
       ================================================================= */

    console.error(
      "zulu-ingestion-status error:",
      error
    );


    return jsonResponse(
      {
        error:
          "Could not update ingestion status",

        detail:
          getErrorMessage(
            error
          )
      },
      500
    );
  }
});