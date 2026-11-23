import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


/* =====================================================================
   ZULU VIDEO HEALTH
   =====================================================================

   Read-only reconciliation between:

       zulu.zulu_videos
              ↕
       Backblaze B2 MP4 objects

   The function does NOT:

       - upload files
       - delete files
       - rename files
       - alter zulu_videos
       - repair catalogue URLs

   It only inventories and reports discrepancies.

   Diagnostic categories:

       matched
       missing
       orphaned
       case_mismatch
       url_filename_error
       invalid

   Thumbnail objects under images/ are deliberately ignored here.
   They are handled separately by zulu-thumbnail-health.
===================================================================== */


/* =====================================================================
   01. CORS
===================================================================== */

const ALLOWED_ORIGINS = new Set([
  "https://pornflix.zulu-orchid-falcon.co.uk"
]);


function corsHeaders(
  req: Request,
) {

  const origin =
    req.headers.get(
      "origin",
    ) || "";


  const allowedOrigin =
    ALLOWED_ORIGINS.has(
      origin,
    )
      ? origin
      : "https://pornflix.zulu-orchid-falcon.co.uk";


  return {
    "Access-Control-Allow-Origin":
      allowedOrigin,

    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Vary":
      "Origin",
  };
}


/* =====================================================================
   02. JSON RESPONSE
===================================================================== */

function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
) {

  return new Response(
    JSON.stringify(
      body,
      null,
      2,
    ),
    {
      status,

      headers: {
        ...corsHeaders(req),

        "Content-Type":
          "application/json",
      },
    },
  );
}


/* =====================================================================
   03. ENVIRONMENT
===================================================================== */

function requiredEnv(
  name: string,
) {

  const value =
    Deno.env.get(
      name,
    );


  if (
    !value
  ) {

    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }


  return value;
}


/* =====================================================================
   04. ADMIN AUTHENTICATION
===================================================================== */

async function requireAdminUser(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
) {

  const authorization =
    req.headers.get(
      "Authorization",
    );


  if (
    !authorization ||
    !authorization.startsWith(
      "Bearer ",
    )
  ) {

    throw new Error(
      "Missing Bearer token.",
    );
  }


  const authClient =
    createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization:
              authorization,
          },
        },
      },
    );


  const {
    data,
    error,
  } =
    await authClient
      .auth
      .getUser();


  if (
    error ||
    !data?.user
  ) {

    throw new Error(
      "Authentication failed.",
    );
  }


  /*
   * If ZULU_ADMIN_EMAIL has been configured, restrict this function to
   * that account.
   */
  const adminEmail =
    Deno.env.get(
      "ZULU_ADMIN_EMAIL",
    );


  if (
    adminEmail &&
    (
      !data.user.email ||
      data.user.email.toLowerCase() !==
        adminEmail.toLowerCase()
    )
  ) {

    throw new Error(
      "Admin access required.",
    );
  }


  return data.user;
}


/* =====================================================================
   05. BACKBLAZE TYPES
===================================================================== */

type B2AuthorizeResponse = {

  accountId?: string;

  authorizationToken?: string;

  apiInfo?: {
    storageApi?: {
      apiUrl?: string;
    };
  };

  code?: string;

  message?: string;
};


type B2File = {

  fileId?: string;

  fileName?: string;

  contentLength?: number;

  uploadTimestamp?: number;

  contentType?: string;
};


type B2ListResponse = {

  files?: B2File[];

  nextFileName?: string | null;

  code?: string;

  message?: string;
};

type DeleteOrphanPayload = {

  action?: string;

  file_name?: string;

  file_id?: string;
};


type B2DeleteResponse = {

  fileId?: string;

  fileName?: string;

  code?: string;

  message?: string;
};

/* =====================================================================
   06. BACKBLAZE AUTHORIZATION
===================================================================== */

async function authorizeB2(
  keyId: string,
  applicationKey: string,
) {

  const credentials =
    btoa(
      `${keyId}:${applicationKey}`,
    );


  const response =
    await fetch(
      "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
      {
        method:
          "GET",

        headers: {
          Authorization:
            `Basic ${credentials}`,
        },
      },
    );


  const text =
    await response.text();


  let data:
    B2AuthorizeResponse;


  try {

    data =
      JSON.parse(
        text,
      );

  } catch {

    throw new Error(
      `Backblaze authorization returned invalid JSON (${response.status}).`,
    );
  }


  if (
    !response.ok
  ) {

    throw new Error(
      `Backblaze authorization failed: ${
        data.code ||
        response.status
      } ${
        data.message ||
        ""
      }`.trim(),
    );
  }


  const authorizationToken =
    data.authorizationToken;


  const apiUrl =
    data.apiInfo
      ?.storageApi
      ?.apiUrl;


  if (
    !authorizationToken ||
    !apiUrl
  ) {

    throw new Error(
      "Backblaze authorization response was incomplete.",
    );
  }


  return {
    authorizationToken,
    apiUrl,
  };
}


/* =====================================================================
   07. BACKBLAZE FILE INVENTORY
===================================================================== */

/**
 * Returns every visible object in the configured B2 bucket.
 *
 * No filename prefix is supplied because the MP4s live at the bucket
 * root.
 *
 * Backblaze pagination is followed until nextFileName is null.
 */
async function listB2Files(
  apiUrl: string,
  authorizationToken: string,
  bucketId: string,
) {

  const files:
    B2File[] = [];


  let startFileName:
    string | undefined;


  let page =
    0;


  while (
    true
  ) {

    page +=
      1;


    /*
     * Safety protection against an unexpected B2 pagination loop.
     */
    if (
      page > 100
    ) {

      throw new Error(
        "Backblaze pagination exceeded 100 pages.",
      );
    }


    const body:
      Record<string, unknown> = {

        bucketId,

        maxFileCount:
          1000,
      };


    if (
      startFileName
    ) {

      body.startFileName =
        startFileName;
    }


    const response =
      await fetch(
        `${apiUrl}/b2api/v4/b2_list_file_names`,
        {
          method:
            "POST",

          headers: {
            Authorization:
              authorizationToken,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify(
              body,
            ),
        },
      );


    const text =
      await response.text();


    let data:
      B2ListResponse;


    try {

      data =
        JSON.parse(
          text,
        );

    } catch {

      throw new Error(
        `Backblaze file listing returned invalid JSON (${response.status}).`,
      );
    }


    if (
      !response.ok
    ) {

      throw new Error(
        `Backblaze file listing failed: ${
          data.code ||
          response.status
        } ${
          data.message ||
          ""
        }`.trim(),
      );
    }


    if (
      Array.isArray(
        data.files,
      )
    ) {

      files.push(
        ...data.files,
      );
    }


    if (
      !data.nextFileName
    ) {

      break;
    }


    /*
     * Prevent an infinite loop if B2 unexpectedly gives us the same
     * pagination cursor again.
     */
    if (
      data.nextFileName ===
        startFileName
    ) {

      throw new Error(
        "Backblaze pagination returned the same nextFileName twice.",
      );
    }


    startFileName =
      data.nextFileName;
  }


  return files;
}


/* =====================================================================
   08. SAFE URL DECODING
===================================================================== */

/**
 * decodeURIComponent throws if a string contains malformed percent
 * encoding. A health check should report bad catalogue data rather than
 * crash because of it.
 */
function safeDecode(
  value: string,
) {

  try {

    return decodeURIComponent(
      value,
    );

  } catch {

    return value;
  }
}


/* =====================================================================
   09. CATALOGUE URL → B2 OBJECT NAME
===================================================================== */

/**
 * Example:
 *
 *   https://media.zulu-orchid-falcon.co.uk/
 *       Hugo%20Dupre%20with%20Eduell%20Levine.mp4
 *
 * becomes:
 *
 *   Hugo Dupre with Eduell Levine.mp4
 *
 * Query strings and fragments do not form part of the B2 filename.
 */
function filenameFromUrl(
  value: unknown,
) {

  if (
    typeof value !==
      "string" ||
    !value.trim()
  ) {

    return null;
  }


  const raw =
    value.trim();


  /*
   * Normal absolute URL.
   */
  try {

    const url =
      new URL(
        raw,
      );


    const pathname =
      url.pathname.replace(
        /^\/+/,
        "",
      );


    if (
      !pathname
    ) {

      return null;
    }


    return safeDecode(
      pathname,
    );

  } catch {

    /*
     * Fall back to treating the value as a raw path.
     *
     * This is useful for finding old or malformed catalogue records
     * rather than simply losing them from the health report.
     */
    const withoutQuery =
      raw
        .split(
          "?",
        )[0]
        .split(
          "#",
        )[0]
        .replace(
          /^\/+/,
          "",
        );


    if (
      !withoutQuery
    ) {

      return null;
    }


    return safeDecode(
      withoutQuery,
    );
  }
}


/* =====================================================================
   10. FILENAME NORMALISATION
===================================================================== */

/**
 * Normalisation used for exact diagnostic matching.
 *
 * IMPORTANT:
 *
 * We deliberately do NOT lowercase filenames here because Backblaze
 * object names are case-sensitive.
 */
function canonicalFilename(
  value: unknown,
) {

  if (
    typeof value !==
      "string"
  ) {

    return "";
  }


  return safeDecode(
    value,
  )
    .normalize(
      "NFC",
    )
    .trim();
}


/**
 * Used only for detecting a filename where the physical object exists
 * but its letter case differs from the catalogue URL.
 */
function caseInsensitiveKey(
  value: string,
) {

  return value
    .normalize(
      "NFC",
    )
    .toLocaleLowerCase();
}


/* =====================================================================
   11. FILE CLASSIFICATION
===================================================================== */

function isMp4(
  fileName: string,
) {

  return /\.mp4$/i.test(
    fileName,
  );
}


/**
 * images/ is legitimate bucket content but belongs to Thumbnail Health,
 * not Video Health.
 */
function isThumbnailObject(
  fileName: string,
) {

  return fileName.startsWith(
    "images/",
  );
}


/* =====================================================================
   12. B2 DIAGNOSTIC ROW
===================================================================== */

/**
 * Produces a consistent diagnostic representation of a B2 object.
 */
function b2DiagnosticRow(
  file: B2File,
) {

  return {

    file_name:
      file.fileName ||
      null,

    file_id:
      file.fileId ||
      null,

    size_bytes:
      file.contentLength ??
      null,

    uploaded_at:
      file.uploadTimestamp
        ? new Date(
            file.uploadTimestamp,
          ).toISOString()
        : null,

    content_type:
      file.contentType ||
      null,
  };
}


/* =====================================================================
   12A. EXACT B2 FILE LOOKUP
   ===================================================================== */

/**
 * Looks up the current visible B2 object for an exact filename.
 *
 * This is deliberately performed again immediately before deletion.
 * We do not trust an older Admin health snapshot for a destructive action.
 */
async function findExactB2File(
  apiUrl: string,
  authorizationToken: string,
  bucketId: string,
  fileName: string,
) {

  const response =
    await fetch(
      `${apiUrl}/b2api/v4/b2_list_file_names`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            authorizationToken,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            bucketId,

            startFileName:
              fileName,

            maxFileCount:
              1,
          }),
      },
    );


  const text =
    await response.text();


  let data:
    B2ListResponse;


  try {

    data =
      JSON.parse(
        text,
      );

  } catch {

    throw new Error(
      `Backblaze file lookup returned invalid JSON (${response.status}).`,
    );
  }


  if (
    !response.ok
  ) {

    throw new Error(
      `Backblaze file lookup failed: ${
        data.code ||
        response.status
      } ${
        data.message ||
        ""
      }`.trim(),
    );
  }


  const file =
    data.files?.[0];


  if (
    !file ||
    canonicalFilename(
      file.fileName,
    ) !==
      canonicalFilename(
        fileName,
      )
  ) {

    return null;
  }


  return file;
}


/* =====================================================================
   12B. DELETE EXACT B2 FILE VERSION
   ===================================================================== */

/**
 * Deletes one exact B2 file version.
 *
 * The caller must already have proved that:
 *
 *     • the object is not referenced by the catalogue
 *     • the current B2 file ID matches the requested file ID
 */
async function deleteExactB2FileVersion(
  apiUrl: string,
  authorizationToken: string,
  fileName: string,
  fileId: string,
) {

  const response =
    await fetch(
      `${apiUrl}/b2api/v4/b2_delete_file_version`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            authorizationToken,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            fileName,
            fileId,
          }),
      },
    );


  const text =
    await response.text();


  let data:
    B2DeleteResponse;


  try {

    data =
      JSON.parse(
        text,
      );

  } catch {

    throw new Error(
      `Backblaze deletion returned invalid JSON (${response.status}).`,
    );
  }


  if (
    !response.ok
  ) {

    throw new Error(
      `Backblaze deletion failed: ${
        data.code ||
        response.status
      } ${
        data.message ||
        ""
      }`.trim(),
    );
  }


  return data;
}


/* =====================================================================
   13. MAIN FUNCTION
===================================================================== */

Deno.serve(
  async (
    req: Request,
  ) => {

    /* -----------------------------------------------------------------
       CORS PREFLIGHT
    ----------------------------------------------------------------- */

    if (
      req.method ===
        "OPTIONS"
    ) {

      return new Response(
        "ok",
        {
          headers:
            corsHeaders(
              req,
            ),
        },
      );
    }


    /* -----------------------------------------------------------------
       METHOD CHECK
    ----------------------------------------------------------------- */

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
            "Method not allowed.",
        },
        405,
      );
    }


    try {

      /* ===============================================================
         14. ENVIRONMENT
      =============================================================== */

      const supabaseUrl =
        requiredEnv(
          "SUPABASE_URL",
        );


      const anonKey =
        requiredEnv(
          "SUPABASE_ANON_KEY",
        );


      const serviceRoleKey =
        requiredEnv(
          "SUPABASE_SERVICE_ROLE_KEY",
        );


      const b2KeyId =
        requiredEnv(
          "B2_VIDEO_HEALTH_KEY_ID",
        );


      const b2ApplicationKey =
        requiredEnv(
          "B2_VIDEO_HEALTH_APPLICATION_KEY",
        );


      const bucketId =
        requiredEnv(
          "B2_BUCKET_ID",
        );


      /* ===============================================================
         15. AUTHENTICATE USER
      =============================================================== */

      await requireAdminUser(
        req,
        supabaseUrl,
        anonKey,
      );


      /* ===============================================================
         16. SUPABASE SERVICE CLIENT
      =============================================================== */

      const adminClient =
        createClient(
          supabaseUrl,
          serviceRoleKey,
          {
            auth: {
              persistSession:
                false,

              autoRefreshToken:
                false,
            },
          },
        );

/* ===============================================================
   16A. OPTIONAL ORPHAN DELETE ACTION
   =============================================================== */

/*
 * Normal POST requests continue into the existing read-only
 * reconciliation below.
 *
 * Only action === "delete_orphan" enters this destructive branch.
 */
let payload:
  DeleteOrphanPayload = {};


try {

  payload =
    await req.json();

} catch {

  /*
   * Existing health requests send {}.
   *
   * An empty/unparseable body therefore simply behaves as a normal
   * reconciliation request.
   */
  payload = {};
}


if (
  payload.action ===
    "delete_orphan"
) {

  const requestedFileName =
    canonicalFilename(
      payload.file_name,
    );


  const requestedFileId =
    typeof payload.file_id ===
      "string"
      ? payload.file_id.trim()
      : "";


  /* -------------------------------------------------------------
     VALIDATE REQUEST
  ------------------------------------------------------------- */

  if (
    !requestedFileName ||
    !requestedFileId
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "file_name and file_id are required.",
      },
      400,
    );
  }


  if (
    !isMp4(
      requestedFileName,
    )
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "Only MP4 objects can be deleted through Video Storage Health.",
      },
      400,
    );
  }


  if (
    isThumbnailObject(
      requestedFileName,
    )
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "Thumbnail objects must be managed through Thumbnail Health.",
      },
      400,
    );
  }


  /* -------------------------------------------------------------
     RELOAD THE CURRENT CATALOGUE

     This is the critical server-side orphan check.

     We do NOT trust the earlier Admin health result.
  ------------------------------------------------------------- */

  const {
    data:
      currentCatalogueRows,
    error:
      currentCatalogueError,
  } =
    await adminClient
      .schema("zulu").from(
        "zulu_videos",
      )
      .select(
        "uid, film, url",
      );


  if (
    currentCatalogueError
  ) {

    throw new Error(
      `Could not recheck zulu_videos before deletion: ${currentCatalogueError.message}`,
    );
  }


  const currentCatalogue =
    currentCatalogueRows ||
    [];


  const referencingVideos =
    currentCatalogue.filter(
      video => {

        const extracted =
          filenameFromUrl(
            video.url,
          );


        const catalogueFileName =
          canonicalFilename(
            extracted,
          );


        return (
          catalogueFileName ===
          requestedFileName
        );
      },
    );


  if (
    referencingVideos.length >
      0
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "Deletion refused because this MP4 is currently referenced by the catalogue.",

        references:
          referencingVideos.map(
            video => ({
              uid:
                video.uid,

              film:
                video.film,
            }),
          ),
      },
      409,
    );
  }


  /* -------------------------------------------------------------
     LOAD DELETE-SCOPED BACKBLAZE CREDENTIALS

     Do not use the read-only Video Health credentials for deletion.
  ------------------------------------------------------------- */

  const deleteKeyId =
    requiredEnv(
      "B2_DELETE_APPLICATION_KEY_ID",
    );


  const deleteApplicationKey =
    requiredEnv(
      "B2_DELETE_APPLICATION_KEY",
    );


  const {
    authorizationToken:
      deleteAuthorizationToken,

    apiUrl:
      deleteApiUrl,
  } =
    await authorizeB2(
      deleteKeyId,
      deleteApplicationKey,
    );


  /* -------------------------------------------------------------
     RE-LOOK UP THE EXACT B2 OBJECT
  ------------------------------------------------------------- */

  const currentB2File =
    await findExactB2File(
      deleteApiUrl,
      deleteAuthorizationToken,
      bucketId,
      requestedFileName,
    );


  if (
    !currentB2File
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "The Backblaze object no longer exists.",
      },
      404,
    );
  }


  if (
    !currentB2File.fileId
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "Backblaze did not return a file ID for the requested object.",
      },
      409,
    );
  }


  /* -------------------------------------------------------------
     VERIFY IMMUTABLE FILE VERSION

     This prevents a stale Admin page from deleting a replacement
     object uploaded under the same filename.
  ------------------------------------------------------------- */

  if (
    currentB2File.fileId !==
      requestedFileId
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "Deletion refused because the Backblaze file version has changed. Refresh Video Storage Health and try again.",

        requested_file_id:
          requestedFileId,

        current_file_id:
          currentB2File.fileId,
      },
      409,
    );
  }


  /* -------------------------------------------------------------
     FINAL CATALOGUE CHECK

     Perform one last check immediately before the destructive B2 call.
  ------------------------------------------------------------- */

  const {
    data:
      finalCatalogueRows,
    error:
      finalCatalogueError,
  } =
    await adminClient
      .schema("zulu").from(
        "zulu_videos",
      )
      .select(
        "uid, film, url",
      );


  if (
    finalCatalogueError
  ) {

    throw new Error(
      `Could not perform final catalogue safety check: ${finalCatalogueError.message}`,
    );
  }


  const finalReferences =
    (
      finalCatalogueRows ||
      []
    ).filter(
      video => {

        const extracted =
          filenameFromUrl(
            video.url,
          );


        return (
          canonicalFilename(
            extracted,
          ) ===
          requestedFileName
        );
      },
    );


  if (
    finalReferences.length >
      0
  ) {

    return jsonResponse(
      req,
      {
        success:
          false,

        error:
          "Deletion cancelled because the MP4 became referenced by the catalogue.",
      },
      409,
    );
  }


  /* -------------------------------------------------------------
     DELETE EXACT VERSION
  ------------------------------------------------------------- */

  const deleteResult =
    await deleteExactB2FileVersion(
      deleteApiUrl,
      deleteAuthorizationToken,
      requestedFileName,
      requestedFileId,
    );


  return jsonResponse(
    req,
    {
      success:
        true,

      action:
        "delete_orphan",

      deleted: {
        file_name:
          requestedFileName,

        file_id:
          requestedFileId,

        size_bytes:
          currentB2File.contentLength ??
          null,

        backblaze:
          deleteResult,
      },
    },
  );
}

      /* ===============================================================
         17. LOAD CATALOGUE
      =============================================================== */

      /*
       * Stage 9 only needs these three columns.
       *
       * Do NOT request filesize here. zulu_videos does not have a
       * column named "filesize", which caused the previous version of
       * this function to fail before reaching Backblaze.
       */
      const {
        data:
          catalogueRows,
        error:
          catalogueError,
      } =
        await adminClient
          .schema("zulu").from(
            "zulu_videos",
          )
          .select(
            "uid, film, url",
          )
          .order(
            "uid",
            {
              ascending:
                true,
            },
          );


      if (
        catalogueError
      ) {

        throw new Error(
          `Could not load zulu_videos: ${catalogueError.message}`,
        );
      }


      const catalogue =
        catalogueRows ||
        [];


      /* ===============================================================
         18. AUTHORIZE BACKBLAZE
      =============================================================== */

      const {
        authorizationToken,
        apiUrl,
      } =
        await authorizeB2(
          b2KeyId,
          b2ApplicationKey,
        );


      /* ===============================================================
         19. INVENTORY BACKBLAZE
      =============================================================== */

      const allB2Files =
        await listB2Files(
          apiUrl,
          authorizationToken,
          bucketId,
        );


      /*
       * Every MP4 object participates in video reconciliation.
       */
      const b2Videos =
        allB2Files.filter(
          (
            file,
          ) => {

            const fileName =
              file.fileName;


            return (
              typeof fileName ===
                "string" &&
              isMp4(
                fileName,
              )
            );
          },
        );


      /*
       * Non-MP4 objects outside images/ are reported separately.
       *
       * We do not call images/{uid}.png invalid here because those are
       * valid objects managed by zulu-thumbnail-health.
       */
      const invalid =
        allB2Files
          .filter(
            (
              file,
            ) => {

              const fileName =
                file.fileName ||
                "";


              if (
                !fileName
              ) {

                return false;
              }


              if (
                isMp4(
                  fileName,
                )
              ) {

                return false;
              }


              if (
                isThumbnailObject(
                  fileName,
                )
              ) {

                return false;
              }


              return true;
            },
          )
          .map(
            b2DiagnosticRow,
          );


      /* ===============================================================
         20. BUILD EXACT B2 LOOKUP
      =============================================================== */

      const exactB2Map =
        new Map<
          string,
          B2File[]
        >();


      /*
       * We use arrays rather than storing a single object so the
       * diagnostic logic remains safe even if the B2 inventory contains
       * something unexpected.
       */
      for (
        const file of b2Videos
      ) {

        const fileName =
          canonicalFilename(
            file.fileName,
          );


        if (
          !fileName
        ) {

          continue;
        }


        const existing =
          exactB2Map.get(
            fileName,
          ) || [];


        existing.push(
          file,
        );


        exactB2Map.set(
          fileName,
          existing,
        );
      }


      /* ===============================================================
         21. BUILD CASE-INSENSITIVE B2 LOOKUP
      =============================================================== */

      const insensitiveB2Map =
        new Map<
          string,
          B2File[]
        >();


      for (
        const file of b2Videos
      ) {

        const fileName =
          canonicalFilename(
            file.fileName,
          );


        if (
          !fileName
        ) {

          continue;
        }


        const key =
          caseInsensitiveKey(
            fileName,
          );


        const existing =
          insensitiveB2Map.get(
            key,
          ) || [];


        existing.push(
          file,
        );


        insensitiveB2Map.set(
          key,
          existing,
        );
      }


      /* ===============================================================
         22. RESULT COLLECTIONS
      =============================================================== */

      const matched:
        Record<
          string,
          unknown
        >[] = [];


      const missing:
        Record<
          string,
          unknown
        >[] = [];


      const caseMismatch:
        Record<
          string,
          unknown
        >[] = [];


      const urlFilenameError:
        Record<
          string,
          unknown
        >[] = [];


      /*
       * We track physical B2 objects accounted for by catalogue rows.
       *
       * fileId is preferable, with fileName as a fallback.
       */
      const matchedB2FileIds =
        new Set<
          string
        >();


      const matchedB2Names =
        new Set<
          string
        >();


      /* ===============================================================
         23. RECONCILE EACH CATALOGUE VIDEO
      =============================================================== */

      for (
        const video of catalogue
      ) {

        const extractedFilename =
          filenameFromUrl(
            video.url,
          );


        const expectedFileName =
          canonicalFilename(
            extractedFilename,
          );


        /* -------------------------------------------------------------
           URL CANNOT PRODUCE A FILENAME
        ------------------------------------------------------------- */

        if (
          !expectedFileName
        ) {

          urlFilenameError.push({
            uid:
              video.uid,

            film:
              video.film,

            url:
              video.url,

            expected_file:
              null,

            reason:
              "Could not extract a B2 filename from catalogue URL.",
          });


          continue;
        }


        /* -------------------------------------------------------------
           URL DOES NOT IDENTIFY AN MP4
        ------------------------------------------------------------- */

        if (
          !isMp4(
            expectedFileName,
          )
        ) {

          urlFilenameError.push({
            uid:
              video.uid,

            film:
              video.film,

            url:
              video.url,

            expected_file:
              expectedFileName,

            reason:
              "Catalogue URL does not identify an MP4 object.",
          });


          continue;
        }


        /* -------------------------------------------------------------
           EXACT CASE-SENSITIVE MATCH
        ------------------------------------------------------------- */

        const exactMatches =
          exactB2Map.get(
            expectedFileName,
          );


        if (
          exactMatches &&
          exactMatches.length >
            0
        ) {

          const file =
            exactMatches[0];


          if (
            file.fileId
          ) {

            matchedB2FileIds.add(
              file.fileId,
            );
          }


          if (
            file.fileName
          ) {

            matchedB2Names.add(
              file.fileName,
            );
          }


          matched.push({
            uid:
              video.uid,

            film:
              video.film,

            url:
              video.url,

            file_name:
              file.fileName ||
              null,

            file_id:
              file.fileId ||
              null,

            size_bytes:
              file.contentLength ??
              null,

            uploaded_at:
              file.uploadTimestamp
                ? new Date(
                    file.uploadTimestamp,
                  ).toISOString()
                : null,
          });


          continue;
        }


        /* -------------------------------------------------------------
           CASE-ONLY MISMATCH
        ------------------------------------------------------------- */

        const insensitiveMatches =
          insensitiveB2Map.get(
            caseInsensitiveKey(
              expectedFileName,
            ),
          );


        if (
          insensitiveMatches &&
          insensitiveMatches.length >
            0
        ) {

          const file =
            insensitiveMatches[0];


          if (
            file.fileId
          ) {

            matchedB2FileIds.add(
              file.fileId,
            );
          }


          if (
            file.fileName
          ) {

            matchedB2Names.add(
              file.fileName,
            );
          }


          caseMismatch.push({
            uid:
              video.uid,

            film:
              video.film,

            url:
              video.url,

            catalogue_file:
              expectedFileName,

            b2_file:
              file.fileName ||
              null,

            file_id:
              file.fileId ||
              null,

            size_bytes:
              file.contentLength ??
              null,

            uploaded_at:
              file.uploadTimestamp
                ? new Date(
                    file.uploadTimestamp,
                  ).toISOString()
                : null,
          });


          continue;
        }


        /* -------------------------------------------------------------
           MISSING FROM BACKBLAZE
        ------------------------------------------------------------- */

        missing.push({
          uid:
            video.uid,

          film:
            video.film,

          url:
            video.url,

          expected_file:
            expectedFileName,
        });
      }


      /* ===============================================================
         24. FIND ORPHANED B2 MP4s
      =============================================================== */

      const orphaned =
        b2Videos
          .filter(
            (
              file,
            ) => {

              /*
               * Prefer the immutable B2 file ID.
               */
              if (
                file.fileId &&
                matchedB2FileIds.has(
                  file.fileId,
                )
              ) {

                return false;
              }


              /*
               * Fallback for any unusual object without a file ID.
               */
              if (
                file.fileName &&
                matchedB2Names.has(
                  file.fileName,
                )
              ) {

                return false;
              }


              return true;
            },
          )
          .map(
            b2DiagnosticRow,
          );


      /* ===============================================================
         25. SUMMARY COUNTS
      =============================================================== */

      const catalogueCount =
        catalogue.length;


      const b2VideoCount =
        b2Videos.length;


      const matchedCount =
        matched.length;


      const caseMismatchCount =
        caseMismatch.length;


      /*
       * A case mismatch is still physically present in B2, even though
       * it is not an exact filename match.
       */
      const physicallyPresent =
        matchedCount +
        caseMismatchCount;


      const coveragePercent =
        catalogueCount >
          0
          ? Number(
              (
                (
                  physicallyPresent /
                  catalogueCount
                ) *
                100
              ).toFixed(
                2,
              ),
            )
          : 0;


      /* ===============================================================
         26. SUCCESS RESPONSE
      =============================================================== */

      return jsonResponse(
        req,
        {
          success:
            true,

          generated_at:
            new Date()
              .toISOString(),

          convention:
            "Catalogue media URL → decoded case-sensitive B2 object filename",


          summary: {

            catalogue_videos:
              catalogueCount,

            b2_videos:
              b2VideoCount,

            matched:
              matchedCount,

            physically_present:
              physicallyPresent,

            missing:
              missing.length,

            orphaned:
              orphaned.length,

            case_mismatch:
              caseMismatch.length,

            url_filename_error:
              urlFilenameError.length,

            invalid:
              invalid.length,

            coverage_percent:
              coveragePercent,

            bucket_objects:
              allB2Files.length,
          },


          /*
           * Exact matches aren't sent as detailed rows because the Admin
           * dashboard doesn't need thousands of healthy records.
           *
           * The count remains available in summary.matched.
           */


          missing: {

            count:
              missing.length,

            rows:
              missing,
          },


          orphaned: {

            count:
              orphaned.length,

            rows:
              orphaned,
          },


          case_mismatch: {

            count:
              caseMismatch.length,

            rows:
              caseMismatch,
          },


          url_filename_error: {

            count:
              urlFilenameError.length,

            rows:
              urlFilenameError,
          },


          invalid: {

            count:
              invalid.length,

            rows:
              invalid,
          },
        },
      );


    } catch (
      error
    ) {

      /* ===============================================================
         27. FAILURE RESPONSE
      =============================================================== */

      console.error(
        "zulu-video-health:",
        error,
      );


      return jsonResponse(
        req,
        {
          success:
            false,

          error:
            error instanceof Error
              ? error.message
              : String(
                  error,
                ),
        },
        500,
      );
    }
  },
);