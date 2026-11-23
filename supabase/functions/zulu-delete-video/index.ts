import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":
    "https://pornflix.zulu-orchid-falcon.co.uk",

  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",

  "Access-Control-Allow-Methods":
    "POST, OPTIONS"
};

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

interface DeletePayload {
  uid?: number | string;
}

function encodeBasicAuth(
  keyId: string,
  applicationKey: string
) {
  const credentials =
    `${keyId}:${applicationKey}`;

  const bytes =
    new TextEncoder().encode(
      credentials
    );

  let binary = "";

  for (const byte of bytes) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary);
}

function decodeStoredVideoUrl(
  storedUrl: string
) {
  const parsed =
    new URL(storedUrl);

  const pathname =
    parsed.pathname;

  const prefix =
    "/file/zulu-orchid-falcon/";

  let objectName;

  if (
    pathname.startsWith(prefix)
  ) {
    objectName =
      pathname.slice(
        prefix.length
      );
  } else {
    objectName =
      pathname.replace(
        /^\/+/,
        ""
      );
  }

  return decodeURIComponent(
    objectName
  );
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response(
      "ok",
      {
        headers:
          corsHeaders
      }
    );
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error:
          "Method not allowed"
      },
      405
    );
  }

  try {
    // ---------------------------------------------------------
    // 1. Require logged-in user
    // ---------------------------------------------------------

    const authHeader =
      req.headers.get(
        "Authorization"
      );

    if (
      !authHeader?.startsWith(
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


    // ---------------------------------------------------------
    // 2. Load Supabase environment
    // ---------------------------------------------------------

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


    // ---------------------------------------------------------
    // 3. Verify logged-in user
    // ---------------------------------------------------------

    const authClient =
      createClient(
        supabaseUrl,
        supabaseAnonKey
      );

    const {
      data: {
        user
      },
      error: userError
    } =
      await authClient.auth.getUser(
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


    // ---------------------------------------------------------
    // 4. Optional admin-only restriction
    // ---------------------------------------------------------

    const adminEmail =
      Deno.env.get(
        "ZULU_ADMIN_EMAIL"
      );

    if (
      adminEmail &&
      user.email?.toLowerCase() !==
        adminEmail.toLowerCase()
    ) {
      return jsonResponse(
        {
          error:
            "Forbidden"
        },
        403
      );
    }


    // ---------------------------------------------------------
    // 5. Read UID
    // ---------------------------------------------------------

    let payload:
      DeletePayload;

    try {
      payload =
        await req.json();
    } catch {
      return jsonResponse(
        {
          error:
            "Invalid JSON payload"
        },
        400
      );
    }

    const uid =
      Number(
        payload.uid
      );

    if (
      !Number.isInteger(uid) ||
      uid <= 0
    ) {
      return jsonResponse(
        {
          error:
            "Invalid UID"
        },
        400
      );
    }


    // ---------------------------------------------------------
    // 6. Service-role client
    // ---------------------------------------------------------

    const supabase =
      createClient(
        supabaseUrl,
        serviceRoleKey
      );


    // ---------------------------------------------------------
    // 7. Look up catalogue row
    // ---------------------------------------------------------

    const {
      data: video,
      error: videoLookupError
    } = await supabase
      .schema("zulu").from(
        "zulu_videos"
      )
      .select(
        "uid, film, url"
      )
      .eq(
        "uid",
        uid
      )
      .maybeSingle();

    if (videoLookupError) {
      throw videoLookupError;
    }

    if (!video) {
      return jsonResponse(
        {
          error:
            "Video not found"
        },
        404
      );
    }


    // ---------------------------------------------------------
    // 8. Load Backblaze credentials
    // ---------------------------------------------------------

    const b2KeyId =
      Deno.env.get(
        "B2_DELETE_APPLICATION_KEY_ID"
      );

    const b2ApplicationKey =
      Deno.env.get(
        "B2_DELETE_APPLICATION_KEY"
      );

    const b2BucketId =
      Deno.env.get(
        "B2_BUCKET_ID"
      );

    const b2BucketName =
      Deno.env.get(
        "B2_BUCKET_NAME"
      ) ||
      "zulu-orchid-falcon";

    if (
      !b2KeyId ||
      !b2ApplicationKey ||
      !b2BucketId
    ) {
      return jsonResponse(
        {
          error:
            "Backblaze configuration error"
        },
        500
      );
    }


    // ---------------------------------------------------------
    // 9. Authorize with Backblaze
    // ---------------------------------------------------------

    const basicCredentials =
      encodeBasicAuth(
        b2KeyId,
        b2ApplicationKey
      );

    const authResponse =
      await fetch(
        "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
        {
          method:
            "GET",

          headers: {
            Authorization:
              `Basic ${basicCredentials}`
          }
        }
      );

    const authText =
      await authResponse.text();

    let authData:
      any = null;

    try {
      authData =
        JSON.parse(
          authText
        );
    } catch {
      authData = {
        raw:
          authText
      };
    }

    if (!authResponse.ok) {
      console.error(
        "Backblaze authorization failed:",
        authResponse.status,
        authData
      );

      return jsonResponse(
        {
          error:
            "Could not authorize with Backblaze"
        },
        502
      );
    }


    const apiUrl =
      authData?.apiInfo?.storageApi?.apiUrl ||
      authData?.apiUrl;

    const authorizationToken =
      authData?.authorizationToken;


    if (
      !apiUrl ||
      !authorizationToken
    ) {
      return jsonResponse(
        {
          error:
            "Backblaze authorization response incomplete"
        },
        502
      );
    }


    // ---------------------------------------------------------
    // Helper: find current B2 file version by name
    // ---------------------------------------------------------

    async function findFileByName(
      fileName: string
    ) {
      const url =
        `${apiUrl}/b2api/v4/b2_list_file_names`;

      const response =
        await fetch(
          url,
          {
            method:
              "POST",

            headers: {
              Authorization:
                authorizationToken,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                bucketId:
                  b2BucketId,

                startFileName:
                  fileName,

                maxFileCount:
                  1
              })
          }
        );

      const text =
        await response.text();

      let data:
        any = null;

      try {
        data =
          JSON.parse(
            text
          );
      } catch {
        data = {
          raw:
            text
        };
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
          `Backblaze list failed with HTTP ${response.status}`
        );
      }

      const file =
        data?.files?.[0];

      if (
        !file ||
        file.fileName !== fileName
      ) {
        return null;
      }

      return file;
    }


    // ---------------------------------------------------------
    // Helper: delete one B2 object if it exists
    // ---------------------------------------------------------

    async function deleteB2Object(
      fileName: string
    ) {
      const file =
        await findFileByName(
          fileName
        );

      if (!file) {
        return {
          fileName,
          deleted:
            false,
          reason:
            "not_found"
        };
      }

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
                "application/json"
            },

            body:
              JSON.stringify({
                fileName,
                fileId:
                  file.fileId
              })
          }
        );

      const text =
        await response.text();

      let data:
        any = null;

      try {
        data =
          JSON.parse(
            text
          );
      } catch {
        data = {
          raw:
            text
        };
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
          `Backblaze delete failed with HTTP ${response.status}`
        );
      }

      return {
        fileName,
        deleted:
          true,
        fileId:
          file.fileId
      };
    }


    // ---------------------------------------------------------
    // 10. Work out B2 object names
    // ---------------------------------------------------------

    const videoFileName =
      decodeStoredVideoUrl(
        video.url
      );

    const thumbnailFileName =
      `images/${uid}.png`;


    // ---------------------------------------------------------
    // 11. Delete Backblaze video
    // ---------------------------------------------------------

    const videoDeleteResult =
      await deleteB2Object(
        videoFileName
      );


    // ---------------------------------------------------------
    // 12. Delete Backblaze thumbnail
    // ---------------------------------------------------------

    const thumbnailDeleteResult =
      await deleteB2Object(
        thumbnailFileName
      );


    // ---------------------------------------------------------
    // 13. Delete actor relationships
    // ---------------------------------------------------------

    const {
      error: actorsDeleteError
    } = await supabase
      .schema("zulu").from(
        "zulu_actors"
      )
      .delete()
      .eq(
        "uid",
        uid
      );

    if (actorsDeleteError) {
      throw actorsDeleteError;
    }


    // ---------------------------------------------------------
    // 14. Delete video catalogue row
    // ---------------------------------------------------------

    const {
      error: videoDeleteError
    } = await supabase
      .schema("zulu").from(
        "zulu_videos"
      )
      .delete()
      .eq(
        "uid",
        uid
      );

    if (videoDeleteError) {
      throw videoDeleteError;
    }


    // ---------------------------------------------------------
    // 15. Refresh materialized view
    // ---------------------------------------------------------

    const {
      error: refreshError
    } = await supabase.rpc(
      "refresh_zulu_videos_search"
    );

    if (refreshError) {
      console.error(
        "Materialized view refresh failed:",
        refreshError
      );

      return jsonResponse(
        {
          success:
            false,

          partial:
            true,

          uid,

          film:
            video.film,

          videoDelete:
            videoDeleteResult,

          thumbnailDelete:
            thumbnailDeleteResult,

          error:
            "Video deleted, but search refresh failed"
        },
        500
      );
    }


    // ---------------------------------------------------------
    // 16. Done
    // ---------------------------------------------------------

    return jsonResponse(
      {
        success:
          true,

        uid,

        film:
          video.film,

        videoDelete:
          videoDeleteResult,

        thumbnailDelete:
          thumbnailDeleteResult
      }
    );

  } catch (error) {
    console.error(
      "zulu-delete-video error:",
      error
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not delete video"
      },
      500
    );
  }
});