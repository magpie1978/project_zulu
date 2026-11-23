/* =====================================================================
   ZULU THUMBNAIL HEALTH
   =====================================================================

   PURPOSE
   ---------------------------------------------------------------------
   Reconciles thumbnail objects stored in Backblaze B2 against the
   zulu_videos catalogue.

   Expected thumbnail convention:

       images/{uid}.png

   READ-ONLY HEALTH CHECK
   ---------------------------------------------------------------------
   Uses:

       B2_HEALTH_KEY_ID
       B2_HEALTH_APPLICATION_KEY

   These credentials should remain READ ONLY and restricted to:

       images/

   CONTROLLED ORPHAN CLEANUP
   ---------------------------------------------------------------------
   Uses separate credentials:

       B2_THUMBNAIL_CLEANUP_KEY_ID
       B2_THUMBNAIL_CLEANUP_APPLICATION_KEY

   These credentials should have Read and Write access but remain
   restricted to:

       images/

   The delete action:

       1. authenticates the Supabase user
       2. optionally verifies ZULU_ADMIN_EMAIL
       3. validates UID / filename / B2 file ID
       4. rechecks zulu_videos immediately before deletion
       5. refuses deletion if that UID now exists
       6. deletes one exact B2 file version only

   The browser never receives Backblaze credentials.
===================================================================== */


import {
  createClient
} from "https://esm.sh/@supabase/supabase-js@2";


/* =====================================================================
   01. CORS
===================================================================== */

const ALLOWED_ORIGINS =
  new Set([
    "https://pornflix.zulu-orchid-falcon.co.uk"
  ]);


/**
 * Returns the requesting origin only when it is one of the site's
 * approved frontend origins.
 */
function getAllowedOrigin(
  req: Request
): string | null {

  const origin =
    req.headers.get(
      "origin"
    );


  if (
    origin &&
    ALLOWED_ORIGINS.has(
      origin
    )
  ) {

    return origin;
  }


  return null;
}


/**
 * Standard CORS headers for this protected Edge Function.
 */
function corsHeaders(
  req: Request
): Record<string, string> {

  const origin =
    getAllowedOrigin(
      req
    );


  return {
    ...(origin
      ? {
          "Access-Control-Allow-Origin":
            origin
        }
      : {}),

    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Vary":
      "Origin"
  };
}


/**
 * Creates a JSON response with the correct CORS headers.
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
        ...corsHeaders(
          req
        ),

        "Content-Type":
          "application/json"
      }
    }
  );
}


/* =====================================================================
   02. TYPES
===================================================================== */

type CatalogueVideo = {
  uid: number;
  film: string | null;
  url: string | null;
};


type B2File = {
  fileName: string;
  fileId: string;
  contentLength?: number;
  uploadTimestamp?: number;
  action?: string;
};


type ThumbnailObject = {
  uid: number;
  file_name: string;
  file_id: string;
  size_bytes: number;
  uploaded_at: string | null;
};


type InvalidThumbnailObject = {
  file_name: string;
  file_id: string;
  size_bytes: number;
  uploaded_at: string | null;
};


type B2Authorization = {
  authorizationToken: string;

  apiInfo: {
    storageApi: {
      apiUrl: string;
    };
  };
};


/* =====================================================================
   03. ENVIRONMENT
===================================================================== */

/**
 * Retrieves a required environment variable.
 */
function requireEnv(
  name: string
): string {

  const value =
    Deno.env.get(
      name
    );


  if (
    !value
  ) {

    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }


  return value;
}


/* =====================================================================
   04. BACKBLAZE AUTHORIZATION
===================================================================== */

/**
 * Authorizes against the Backblaze B2 v4 API.
 *
 * Different credentials are supplied depending on whether this is a
 * read-only health operation or the restricted cleanup operation.
 */
async function authorizeB2(
  keyId: string,
  applicationKey: string
): Promise<B2Authorization> {

  const credentials =
    btoa(
      `${keyId}:${applicationKey}`
    );


  const response =
    await fetch(
      "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
      {
        method:
          "GET",

        headers: {
          Authorization:
            `Basic ${credentials}`
        }
      }
    );


  const data =
    await response.json();


  if (
    !response.ok
  ) {

    console.error(
      "B2 AUTHORIZE ERROR:",
      data
    );


    throw new Error(
      data?.message ||
      "Could not authorize with Backblaze."
    );
  }


  if (
    !data?.authorizationToken ||
    !data?.apiInfo?.storageApi?.apiUrl
  ) {

    throw new Error(
      "Backblaze authorization returned an invalid response."
    );
  }


  return data as
    B2Authorization;
}


/* =====================================================================
   05. BACKBLAZE THUMBNAIL INVENTORY
===================================================================== */

/**
 * Lists every object under images/.
 *
 * Backblaze returns at most 1000 objects per request, therefore the
 * function continues using nextFileName until the complete prefix has
 * been listed.
 */
async function listThumbnailObjects(
  authorization: B2Authorization,
  bucketId: string
): Promise<B2File[]> {

  const files:
    B2File[] =
      [];


  let startFileName:
    string | null =
      null;


  while (
    true
  ) {

    const body:
      Record<string, unknown> = {
        bucketId,

        prefix:
          "images/",

        maxFileCount:
          1000
      };


    if (
      startFileName
    ) {

      body.startFileName =
        startFileName;
    }


    const response =
      await fetch(
        `${authorization.apiInfo.storageApi.apiUrl}/b2api/v4/b2_list_file_names`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              authorization.authorizationToken,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              body
            )
        }
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      console.error(
        "B2 LIST FILE NAMES ERROR:",
        data
      );


      throw new Error(
        data?.message ||
        "Could not list Backblaze thumbnails."
      );
    }


    if (
      Array.isArray(
        data?.files
      )
    ) {

      files.push(
        ...data.files
      );
    }


    startFileName =
      data?.nextFileName ||
      null;


    if (
      !startFileName
    ) {

      break;
    }
  }


  return files;
}


/* =====================================================================
   06. THUMBNAIL OBJECT NORMALISATION
===================================================================== */

/**
 * Converts a Backblaze timestamp to an ISO date.
 */
function timestampToIso(
  timestamp: unknown
): string | null {

  const value =
    Number(
      timestamp
    );


  if (
    !Number.isFinite(
      value
    ) ||
    value <= 0
  ) {

    return null;
  }


  try {

    return new Date(
      value
    ).toISOString();

  } catch {

    return null;
  }
}


/**
 * Converts a valid images/{uid}.png B2 object to the shape returned to
 * Admin.
 */
function normaliseThumbnail(
  file: B2File,
  uid: number
): ThumbnailObject {

  return {
    uid,

    file_name:
      file.fileName,

    file_id:
      file.fileId,

    size_bytes:
      Number(
        file.contentLength ||
        0
      ),

    uploaded_at:
      timestampToIso(
        file.uploadTimestamp
      )
  };
}


/**
 * Converts an invalid object to the diagnostic result shape.
 */
function normaliseInvalidThumbnail(
  file: B2File
): InvalidThumbnailObject {

  return {
    file_name:
      file.fileName,

    file_id:
      file.fileId,

    size_bytes:
      Number(
        file.contentLength ||
        0
      ),

    uploaded_at:
      timestampToIso(
        file.uploadTimestamp
      )
  };
}


/* =====================================================================
   07. CONTROLLED ORPHAN DELETE
===================================================================== */

/**
 * Deletes ONE exact orphaned thumbnail.
 *
 * Security is intentionally defensive:
 *
 *     - numeric positive UID required
 *     - filename must be exactly images/{uid}.png
 *     - exact B2 file ID required
 *     - zulu_videos is queried again immediately before deletion
 *     - deletion is refused if the catalogue UID exists
 *     - separate images/-restricted B2 credentials are used
 */
async function deleteOrphanedThumbnail(
  req: Request,
  body: Record<string, unknown>,
  adminClient: ReturnType<typeof createClient>
): Promise<Response> {

  const uid =
    Number(
      body.uid
    );


  const fileName =
    String(
      body.file_name ||
      ""
    );


  const fileId =
    String(
      body.file_id ||
      ""
    );


  /* -----------------------------------------------------------------
     VALIDATE UID
  ----------------------------------------------------------------- */

  if (
    !Number.isInteger(
      uid
    ) ||
    uid <= 0
  ) {

    return jsonResponse(
      req,
      {
        success: false,
        error:
          "Invalid thumbnail UID."
      },
      400
    );
  }


  /* -----------------------------------------------------------------
     VALIDATE EXACT EXPECTED PATH
  ----------------------------------------------------------------- */

  const expectedFileName =
    `images/${uid}.png`;


  if (
    fileName !==
      expectedFileName
  ) {

    return jsonResponse(
      req,
      {
        success: false,

        error:
          `Deletion refused. Expected file ${expectedFileName}.`
      },
      400
    );
  }


  /* -----------------------------------------------------------------
     REQUIRE EXACT B2 FILE VERSION
  ----------------------------------------------------------------- */

  if (
    !fileId
  ) {

    return jsonResponse(
      req,
      {
        success: false,

        error:
          "Backblaze file ID is required."
      },
      400
    );
  }


  /* -----------------------------------------------------------------
     SAFETY CHECK:
     UID MUST STILL BE ABSENT FROM THE CATALOGUE
  ----------------------------------------------------------------- */

  const {
    data: existingVideo,
    error: catalogueCheckError
  } =
    await adminClient
      .schema("zulu").from(
        "zulu_videos"
      )
      .select(
        "uid, film"
      )
      .eq(
        "uid",
        uid
      )
      .maybeSingle();


  if (
    catalogueCheckError
  ) {

    console.error(
      "ORPHAN DELETE CATALOGUE CHECK ERROR:",
      catalogueCheckError
    );


    return jsonResponse(
      req,
      {
        success: false,

        error:
          "Could not verify the catalogue before deletion."
      },
      500
    );
  }


  if (
    existingVideo
  ) {

    return jsonResponse(
      req,
      {
        success: false,

        error:
          `Deletion refused. UID ${uid} now exists in zulu_videos.`,

        catalogue_video: {
          uid:
            existingVideo.uid,

          film:
            existingVideo.film
        }
      },
      409
    );
  }


  /* -----------------------------------------------------------------
     LOAD THE RESTRICTED CLEANUP CREDENTIALS
  ----------------------------------------------------------------- */

  let cleanupKeyId:
    string;

  let cleanupApplicationKey:
    string;


  try {

    cleanupKeyId =
      requireEnv(
        "B2_THUMBNAIL_CLEANUP_KEY_ID"
      );


    cleanupApplicationKey =
      requireEnv(
        "B2_THUMBNAIL_CLEANUP_APPLICATION_KEY"
      );

  } catch (error) {

    console.error(
      "THUMBNAIL CLEANUP CONFIG ERROR:",
      error
    );


    return jsonResponse(
      req,
      {
        success: false,

        error:
          "Thumbnail cleanup credentials are not configured."
      },
      500
    );
  }


  /* -----------------------------------------------------------------
     AUTHORIZE B2 USING CLEANUP KEY
  ----------------------------------------------------------------- */

  let authorization:
    B2Authorization;


  try {

    authorization =
      await authorizeB2(
        cleanupKeyId,
        cleanupApplicationKey
      );

  } catch (error) {

    console.error(
      "THUMBNAIL CLEANUP B2 AUTH ERROR:",
      error
    );


    return jsonResponse(
      req,
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Could not authorize thumbnail cleanup."
      },
      502
    );
  }


  /* -----------------------------------------------------------------
     DELETE THE EXACT FILE VERSION
  ----------------------------------------------------------------- */

  const deleteResponse =
    await fetch(
      `${authorization.apiInfo.storageApi.apiUrl}/b2api/v4/b2_delete_file_version`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            authorization.authorizationToken,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            fileName,
            fileId
          })
      }
    );


  const deleteData =
    await deleteResponse
      .json()
      .catch(
        () => ({})
      );


  if (
    !deleteResponse.ok
  ) {

    console.error(
      "B2 THUMBNAIL DELETE ERROR:",
      deleteData
    );


    return jsonResponse(
      req,
      {
        success: false,

        error:
          deleteData?.message ||
          "Backblaze refused thumbnail deletion."
      },
      502
    );
  }


  /* -----------------------------------------------------------------
     SUCCESS
  ----------------------------------------------------------------- */

  return jsonResponse(
    req,
    {
      success: true,

      action:
        "delete_orphan",

      deleted: {
        uid,

        file_name:
          deleteData?.fileName ||
          fileName,

        file_id:
          deleteData?.fileId ||
          fileId
      }
    }
  );
}


/* =====================================================================
   08. MAIN REQUEST HANDLER
===================================================================== */

Deno.serve(
  async (
    req: Request
  ) => {

    /* ----------------------------------------------------------------
       CORS PREFLIGHT
    ---------------------------------------------------------------- */

    if (
      req.method ===
        "OPTIONS"
    ) {

      const allowedOrigin =
        getAllowedOrigin(
          req
        );


      if (
        req.headers.get(
          "origin"
        ) &&
        !allowedOrigin
      ) {

        return new Response(
          null,
          {
            status:
              403
          }
        );
      }


      return new Response(
        null,
        {
          status:
            204,

          headers:
            corsHeaders(
              req
            )
        }
      );
    }


    /* ----------------------------------------------------------------
       POST ONLY
    ---------------------------------------------------------------- */

    if (
      req.method !==
        "POST"
    ) {

      return jsonResponse(
        req,
        {
          success: false,
          error:
            "Method not allowed."
        },
        405
      );
    }


    try {

      /* ==============================================================
         09. SUPABASE CONFIGURATION
      ============================================================== */

      const supabaseUrl =
        requireEnv(
          "SUPABASE_URL"
        );


      const supabaseAnonKey =
        requireEnv(
          "SUPABASE_ANON_KEY"
        );


      const serviceRoleKey =
        requireEnv(
          "SUPABASE_SERVICE_ROLE_KEY"
        );


      /* ==============================================================
         10. AUTHENTICATE CALLING USER
      ============================================================== */

      const authorizationHeader =
        req.headers.get(
          "Authorization"
        );


      if (
        !authorizationHeader ||
        !authorizationHeader.startsWith(
          "Bearer "
        )
      ) {

        return jsonResponse(
          req,
          {
            success: false,
            error:
              "Unauthorized."
          },
          401
        );
      }


      /*
       * User-scoped client.
       *
       * This client is used only to validate the supplied JWT.
       */
      const userClient =
        createClient(
          supabaseUrl,
          supabaseAnonKey,
          {
            global: {
              headers: {
                Authorization:
                  authorizationHeader
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
        data: {
          user
        },

        error:
          userError
      } =
        await userClient
          .auth
          .getUser();


      if (
        userError ||
        !user
      ) {

        console.error(
          "THUMBNAIL HEALTH AUTH ERROR:",
          userError
        );


        return jsonResponse(
          req,
          {
            success: false,
            error:
              "Unauthorized."
          },
          401
        );
      }


      /* ==============================================================
         11. OPTIONAL ADMIN EMAIL RESTRICTION
      ============================================================== */

      const adminEmail =
        Deno.env.get(
          "ZULU_ADMIN_EMAIL"
        );


      if (
        adminEmail &&
        (
          !user.email ||
          user.email.toLowerCase() !==
            adminEmail.toLowerCase()
        )
      ) {

        return jsonResponse(
          req,
          {
            success: false,
            error:
              "Forbidden."
          },
          403
        );
      }


      /* ==============================================================
         12. SERVICE-ROLE CLIENT
      ============================================================== */

      const adminClient =
        createClient(
          supabaseUrl,
          serviceRoleKey,
          {
            auth: {
              persistSession:
                false,

              autoRefreshToken:
                false
            }
          }
        );


      /* ==============================================================
         13. READ REQUEST BODY
      ============================================================== */

      const body =
        await req
          .json()
          .catch(
            () => ({})
          );


      /* ==============================================================
         14. CONTROLLED WRITE ACTION:
             DELETE ONE ORPHAN
      ============================================================== */

      if (
        body?.action ===
          "delete_orphan"
      ) {

        return await
          deleteOrphanedThumbnail(
            req,
            body,
            adminClient
          );
      }


      /*
       * Reject unknown actions rather than silently interpreting them
       * as a health check.
       */
      if (
        body?.action
      ) {

        return jsonResponse(
          req,
          {
            success: false,

            error:
              `Unknown action: ${String(
                body.action
              )}`
          },
          400
        );
      }


      /* ==============================================================
         15. LOAD CATALOGUE
      ============================================================== */

      const {
        data: catalogueRows,
        error: catalogueError
      } =
        await adminClient
          .schema("zulu").from(
            "zulu_videos"
          )
          .select(
            "uid, film, url"
          )
          .order(
            "uid",
            {
              ascending:
                true
            }
          );


      if (
        catalogueError
      ) {

        console.error(
          "THUMBNAIL HEALTH CATALOGUE ERROR:",
          catalogueError
        );


        return jsonResponse(
          req,
          {
            success: false,

            error:
              "Could not load zulu_videos."
          },
          500
        );
      }


      const catalogue:
        CatalogueVideo[] =
          Array.isArray(
            catalogueRows
          )
            ? catalogueRows
            : [];


      /* ==============================================================
         16. AUTHORIZE READ-ONLY B2 HEALTH ACCESS
      ============================================================== */

      const healthKeyId =
        requireEnv(
          "B2_HEALTH_KEY_ID"
        );


      const healthApplicationKey =
        requireEnv(
          "B2_HEALTH_APPLICATION_KEY"
        );


      const bucketId =
        requireEnv(
          "B2_BUCKET_ID"
        );


      const b2Authorization =
        await authorizeB2(
          healthKeyId,
          healthApplicationKey
        );


      /* ==============================================================
         17. LIST ALL THUMBNAIL OBJECTS
      ============================================================== */

      const b2Files =
        await listThumbnailObjects(
          b2Authorization,
          bucketId
        );


      /* ==============================================================
         18. BUILD CATALOGUE UID LOOKUP
      ============================================================== */

      const catalogueByUid =
        new Map<
          number,
          CatalogueVideo
        >();


      for (
        const video of
        catalogue
      ) {

        const uid =
          Number(
            video.uid
          );


        if (
          Number.isInteger(
            uid
          )
        ) {

          catalogueByUid.set(
            uid,
            video
          );
        }
      }


      /* ==============================================================
         19. CLASSIFY B2 OBJECTS
      ============================================================== */

      const thumbnailRegex =
        /^images\/(\d+)\.png$/i;

        /*
        * Valid system image objects which deliberately do not use a numeric
        * catalogue UID.
        *
        * These files remain in Backblaze but are excluded from thumbnail
        * reconciliation and must not be reported as invalid objects.
        */
        const allowedSystemImages =
          new Set([
            "images/default.png"
          ]);


      const validThumbnails:
        ThumbnailObject[] =
          [];


      const invalidRows:
        InvalidThumbnailObject[] =
          [];


      /*
       * UID → B2 thumbnail.
       *
       * The expected convention allows one canonical thumbnail per UID.
       */
      const thumbnailByUid =
        new Map<
          number,
          ThumbnailObject
        >();


      for (
        const file of
        b2Files
      ) {

        const fileName =
          String(
            file?.fileName ||
            ""
          );


        /*
         * The B2 key is restricted to images/, but retain this guard so
         * an unexpected response cannot accidentally enter thumbnail
         * reconciliation.
         */
        if (
          !fileName.startsWith(
            "images/"
          )
        ) {

          continue;
        }


        /*
        * Known system images are legitimate objects but are not thumbnails
        * belonging to individual catalogue UIDs.
        */
        if (
          allowedSystemImages.has(
            fileName
          )
        ) {

          continue;
        }


        const match =
          fileName.match(
            thumbnailRegex
          );


        if (
          !match
        ) {

          invalidRows.push(
            normaliseInvalidThumbnail(
              file
            )
          );


          continue;
        }

        const uid =
          Number(
            match[1]
          );


        if (
          !Number.isInteger(
            uid
          ) ||
          uid <= 0
        ) {

          invalidRows.push(
            normaliseInvalidThumbnail(
              file
            )
          );


          continue;
        }


        const thumbnail =
          normaliseThumbnail(
            file,
            uid
          );


        validThumbnails.push(
          thumbnail
        );


        thumbnailByUid.set(
          uid,
          thumbnail
        );
      }


      /* ==============================================================
         20. FIND MISSING THUMBNAILS
      ============================================================== */

      const missingRows =
        catalogue
          .filter(
            video => {

              const uid =
                Number(
                  video.uid
                );


              return (
                Number.isInteger(
                  uid
                ) &&
                !thumbnailByUid.has(
                  uid
                )
              );
            }
          )
          .map(
            video => ({
              uid:
                Number(
                  video.uid
                ),

              film:
                video.film,

              url:
                video.url,

              expected_file:
                `images/${video.uid}.png`
            })
          );


      /* ==============================================================
         21. FIND ORPHANED THUMBNAILS
      ============================================================== */

      const orphanedRows =
        validThumbnails
          .filter(
            thumbnail =>
              !catalogueByUid.has(
                thumbnail.uid
              )
          );


      /* ==============================================================
         22. SORT DIAGNOSTICS
      ============================================================== */

      missingRows.sort(
        (
          a,
          b
        ) =>
          a.uid -
          b.uid
      );


      orphanedRows.sort(
        (
          a,
          b
        ) =>
          a.uid -
          b.uid
      );


      invalidRows.sort(
        (
          a,
          b
        ) =>
          a.file_name.localeCompare(
            b.file_name
          )
      );


      /* ==============================================================
         23. CALCULATE PRESENT COVERAGE
      ============================================================== */

      const expected =
        catalogue.length;


      const missing =
        missingRows.length;


      const present =
        Math.max(
          0,
          expected -
          missing
        );


      /* ==============================================================
         24. RETURN RECONCILIATION
      ============================================================== */

      return jsonResponse(
        req,
        {
          success:
            true,

          generated_at:
            new Date()
              .toISOString(),

          convention:
            "images/{uid}.png",

          summary: {
            catalogue_videos:
              catalogue.length,

            expected,

            present,

            missing:
              missingRows.length,

            orphaned:
              orphanedRows.length,

            invalid:
              invalidRows.length
          },


          missing: {
            count:
              missingRows.length,

            rows:
              missingRows
          },


          orphaned: {
            count:
              orphanedRows.length,

            rows:
              orphanedRows
          },


          invalid: {
            count:
              invalidRows.length,

            rows:
              invalidRows
          }
        }
      );

    } catch (error) {

      /* ==============================================================
         25. UNEXPECTED ERROR
      ============================================================== */

      console.error(
        "ZULU THUMBNAIL HEALTH ERROR:",
        error
      );


      return jsonResponse(
        req,
        {
          success: false,

          error:
            error instanceof Error
              ? error.message
              : "Unexpected Thumbnail Health error."
        },
        500
      );
    }
  }
);