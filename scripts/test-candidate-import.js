/*
 * =====================================================================
 * PORNFLIX AUTOMATIC CANDIDATE IMPORTER
 * =====================================================================
 *
 * PURPOSE
 * -------
 *
 * This script is the main worker that takes videos which have already
 * been discovered, reviewed and approved in the Pornflix candidate
 * system and imports them into the real Pornflix video catalogue.
 *
 * In simple terms, this is the part of the automation that turns:
 *
 *       "This looks like a video we want"
 *
 * into:
 *
 *       "This video is now stored in Backblaze and exists in Pornflix"
 *
 *
 * ---------------------------------------------------------------------
 * WHERE THE VIDEO COMES FROM
 * ---------------------------------------------------------------------
 *
 * Earlier parts of the candidate system have already:
 *
 *     1. discovered a video
 *     2. stored it in zulu_candidates
 *     3. allowed it to be reviewed
 *     4. resolved the actual MP4 address
 *     5. prepared the approved film title, actors and tags
 *
 * This script therefore does NOT scrape JustTheGays or GayXFans.
 *
 * It starts further down the pipeline with candidates which are:
 *
 *     status = "accepted"
 *
 * AND
 *
 *     import_status = "ready"
 *
 *
 * ---------------------------------------------------------------------
 * WHAT THIS SCRIPT DOES
 * ---------------------------------------------------------------------
 *
 * For each ready candidate it broadly performs this process:
 *
 *
 *     READY CANDIDATE
 *          │
 *          ▼
 *     Check candidate is still valid
 *          │
 *          ▼
 *     Mark candidate "importing"
 *          │
 *          ▼
 *     Has a previous ingestion already started?
 *          │
 *          ├── YES → attempt to safely resume it
 *          │
 *          └── NO  → start a new ingestion
 *                       │
 *                       ▼
 *                  Download MP4
 *                       │
 *                       ▼
 *                  Check downloaded size
 *                       │
 *                       ▼
 *                  Create zulu_ingestions record
 *                       │
 *                       ▼
 *                  Run ffprobe
 *                       │
 *                       ├── duration
 *                       ├── width
 *                       └── height
 *                       │
 *                       ▼
 *                  Calculate video fingerprint
 *                       │
 *                       ▼
 *                  DUPLICATE CHECK
 *                       │
 *                 ┌─────┴─────┐
 *                 │           │
 *             DUPLICATE     UNIQUE
 *                 │           │
 *                 ▼           ▼
 *              STOP       Calculate SHA-1
 *                             │
 *                             ▼
 *                       Authorize B2
 *                             │
 *                             ▼
 *                       Upload MP4
 *                             │
 *                             ▼
 *                       Create public
 *                       media URL
 *                             │
 *                             ▼
 *                    zulu-finalize-video
 *                             │
 *                             ▼
 *                      zulu_videos
 *                      zulu_actors
 *                       etc.
 *                             │
 *                             ▼
 *                       Verify result
 *                             │
 *                             ▼
 *                    Candidate = imported
 *
 *
 * ---------------------------------------------------------------------
 * IMPORTANT SAFETY FEATURES
 * ---------------------------------------------------------------------
 *
 * This script deliberately contains several safeguards because an
 * interrupted import could otherwise result in duplicate database
 * records or duplicate files in Backblaze.
 *
 *
 * 1. CANDIDATE STATE CHECKING
 * ---------------------------
 *
 * Before doing anything expensive, the script reloads the candidate
 * from Supabase.
 *
 * It checks that the candidate is still:
 *
 *     status = accepted
 *     import_status = ready
 *
 * and that it has:
 *
 *     media_url
 *     import_film
 *     import_actors
 *
 *
 * 2. INGESTION JOURNAL
 * --------------------
 *
 * zulu_ingestions acts as a journal recording how far an import has
 * progressed.
 *
 * Example states include:
 *
 *     pending
 *     analysing
 *     ready
 *     uploading
 *     video_uploaded
 *     catalogued
 *     complete_without_thumbnail
 *     duplicate
 *     failed
 *
 * This is important because the GitHub Action could stop halfway
 * through an import.
 *
 *
 * 3. RESUMABLE IMPORTS
 * --------------------
 *
 * If the MP4 has already successfully reached Backblaze, the script
 * does NOT blindly upload another copy.
 *
 * It can recognise a "video_uploaded" ingestion and continue from the
 * catalogue stage instead.
 *
 * This protects against situations such as:
 *
 *     MP4 uploaded successfully
 *          ↓
 *     GitHub Action crashes
 *          ↓
 *     workflow is run again
 *
 * Without the resume logic this could create another B2 object.
 *
 *
 * 4. VIDEO FINGERPRINT
 * --------------------
 *
 * Before uploading, the script calculates the same fingerprint used
 * by the existing Pornflix ingestion system.
 *
 * The fingerprint is based on:
 *
 *     file size
 *     +
 *     SHA-256 of first 4 MB
 *     +
 *     SHA-256 of middle 4 MB
 *     +
 *     SHA-256 of final 4 MB
 *
 * These values are combined and SHA-256 hashed again.
 *
 * This gives Pornflix a practical way of recognising the same video
 * even if it has a different filename.
 *
 *
 * 5. DUPLICATE CHECK BEFORE UPLOAD
 * --------------------------------
 *
 * The calculated fingerprint is checked against zulu_videos BEFORE
 * the file is uploaded to Backblaze.
 *
 * If a matching fingerprint already exists:
 *
 *     candidate → duplicate
 *     ingestion → duplicate
 *
 * and the Backblaze upload is skipped.
 *
 * This avoids wasting storage on a video we already have.
 *
 *
 * 6. SECOND DUPLICATE PROTECTION
 * ------------------------------
 *
 * zulu-finalize-video also performs catalogue duplicate protection.
 *
 * This gives us another safety check even after the earlier
 * fingerprint test.
 *
 *
 * 7. DOWNLOAD SIZE CHECK
 * ----------------------
 *
 * If the resolver previously discovered the expected file size, the
 * downloaded MP4 is checked against it.
 *
 * If:
 *
 *     expected size != downloaded size
 *
 * the import stops.
 *
 * This helps prevent a partial or incorrect download from being
 * uploaded to Pornflix.
 *
 *
 * 8. TEMPORARY FILE CLEANUP
 * -------------------------
 *
 * Downloaded candidate files exist only temporarily on the GitHub
 * runner.
 *
 * At the end of processing — whether successful or unsuccessful —
 * the script attempts to delete the temporary MP4.
 *
 *
 * ---------------------------------------------------------------------
 * VIDEO ANALYSIS
 * ---------------------------------------------------------------------
 *
 * FFmpeg's "ffprobe" utility is used to inspect the downloaded MP4.
 *
 * We obtain:
 *
 *     duration
 *     width
 *     height
 *
 * The import is rejected if valid video metadata cannot be obtained.
 *
 *
 * ---------------------------------------------------------------------
 * BACKBLAZE
 * ---------------------------------------------------------------------
 *
 * Once the video has passed the duplicate checks, this script:
 *
 *     1. calculates the SHA-1 required for the B2 upload
 *     2. authenticates with Backblaze
 *     3. obtains a B2 upload URL
 *     4. uploads the MP4
 *
 * The filename stored in Backblaze is:
 *
 *     <approved film title>.mp4
 *
 * For example:
 *
 *     Aaron Hugese with Ismatwink.mp4
 *
 * The resulting Pornflix media address is then constructed as:
 *
 *     https://media.zulu-orchid-falcon.co.uk/<filename>
 *
 *
 * ---------------------------------------------------------------------
 * FINAL CATALOGUING
 * ---------------------------------------------------------------------
 *
 * Uploading the MP4 is only part of the process.
 *
 * Once the file exists in Backblaze, this script calls the Supabase
 * Edge Function:
 *
 *     zulu-finalize-video
 *
 * It sends the approved information including:
 *
 *     ingestion ID
 *     film title
 *     public media URL
 *     actors
 *     tags
 *     file size
 *     duration
 *     width
 *     height
 *     fingerprint
 *
 * The Edge Function is responsible for final catalogue creation.
 *
 *
 * ---------------------------------------------------------------------
 * VERIFICATION
 * ---------------------------------------------------------------------
 *
 * The script does not simply assume that catalogue finalization
 * succeeded.
 *
 * Afterwards it checks Supabase to confirm that the expected records
 * actually exist in:
 *
 *     zulu_videos
 *     zulu_actors
 *     zulu_ingestions
 *
 * Only after these checks does it mark the candidate:
 *
 *     import_status = "imported"
 *
 *
 * ---------------------------------------------------------------------
 * THUMBNAILS
 * ---------------------------------------------------------------------
 *
 * Thumbnail processing is deliberately NOT performed by this version
 * of the automatic importer.
 *
 * A successful ingestion is therefore currently marked:
 *
 *     complete_without_thumbnail
 *
 * with:
 *
 *     thumbnail_status = skipped
 *
 * Thumbnail generation can be added to the automation separately.
 *
 *
 * ---------------------------------------------------------------------
 * FAILURE HANDLING
 * ---------------------------------------------------------------------
 *
 * Each stage has a name such as:
 *
 *     candidate_validation
 *     candidate_claim
 *     downloading
 *     ingestion_create
 *     analysis
 *     duplicate_check
 *     uploading
 *     video_uploaded
 *     cataloguing
 *     completion
 *
 * If something fails, that stage is recorded so that we can see
 * approximately where the import stopped.
 *
 * The candidate itself is normally changed to:
 *
 *     import_status = failed
 *
 * with the error stored in:
 *
 *     import_error
 *
 * A failure of ONE candidate does not immediately stop the queue.
 *
 * The script continues trying the remaining ready candidates.
 *
 * At the end, however, if any candidate failed, the overall process
 * exits with an error so that GitHub Actions clearly shows the run
 * as failed.
 *
 *
 * ---------------------------------------------------------------------
 * BATCH LIMIT
 * ---------------------------------------------------------------------
 *
 * To avoid one GitHub Action attempting an unlimited number of large
 * video imports, each run processes only a limited number.
 *
 * The environment variable:
 *
 *     MAX_CANDIDATES_PER_RUN
 *
 * controls the limit.
 *
 * If it isn't supplied, the default is:
 *
 *     10 candidates
 *
 *
 * ---------------------------------------------------------------------
 * SECURITY
 * ---------------------------------------------------------------------
 *
 * Credentials are NOT written directly into this source file.
 *
 * They are supplied to the GitHub Action as environment variables:
 *
 *     SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY
 *     ZULU_AUTOMATION_KEY
 *     B2_APPLICATION_KEY_ID
 *     B2_APPLICATION_KEY
 *     B2_BUCKET_ID
 *
 * The Supabase Service Role key and Backblaze credentials are highly
 * privileged and must remain server-side secrets.
 *
 *
 * ---------------------------------------------------------------------
 * SHORT VERSION
 * ---------------------------------------------------------------------
 *
 * This file is essentially the automated equivalent of:
 *
 *     "Take this approved candidate and safely add it to Pornflix."
 *
 * It handles:
 *
 *     download
 *       → analyse
 *       → fingerprint
 *       → duplicate check
 *       → upload
 *       → catalogue
 *       → verify
 *       → mark imported
 *
 * while keeping enough state in Supabase to recover safely from many
 * interrupted imports.
 * =====================================================================
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const { execFile } = require("child_process");
const { promisify } = require("util");


const execFileAsync =
  promisify(execFile);


/* =====================================================================
   CONFIGURATION
===================================================================== */

const MAX_CANDIDATES_PER_RUN =
  Number(
    process.env.MAX_CANDIDATES_PER_RUN ||
    10
  );

const SAMPLE_SIZE =
  4 * 1024 * 1024;


const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const ZULU_AUTOMATION_KEY =
  process.env.ZULU_AUTOMATION_KEY;


const B2_APPLICATION_KEY_ID =
  process.env.B2_APPLICATION_KEY_ID;

const B2_APPLICATION_KEY =
  process.env.B2_APPLICATION_KEY;

const B2_BUCKET_ID =
  process.env.B2_BUCKET_ID;


if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !ZULU_AUTOMATION_KEY ||
  !B2_APPLICATION_KEY_ID ||
  !B2_APPLICATION_KEY ||
  !B2_BUCKET_ID
) {

  throw new Error(
    "Missing required Supabase, automation, or Backblaze environment variables."
  );
}


const FINALIZE_VIDEO_URL =
  `${SUPABASE_URL}/functions/v1/zulu-finalize-video`;


const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );


/* =====================================================================
   SMALL HELPERS
===================================================================== */

function nowIso() {

  return new Date()
    .toISOString();
}


function errorMessage(error) {

  if (
    error instanceof Error
  ) {

    return error.message;
  }


  return String(
    error ||
    "Unknown error"
  );
}


/* =====================================================================
   ACTOR DETECTION
===================================================================== */

/*
 * This intentionally mirrors the existing Add Video filename/title
 * convention:
 *
 *     Actor A with Actor B
 *     Actor A with Actor B & Actor C
 *     Actor A with Actor B and Actor C
 *
 * We do NOT guess if the title does not match this pattern.
 */
function inferActorsFromTitle(title) {

  const workingTitle =
    String(title || "")
      .replace(
        /^PREVIEW\s*-\s*/i,
        ""
      )
      .trim();


  if (
    !workingTitle
  ) {

    return [];
  }


  /*
   * FORMAT 1
   * --------
   *
   * Actor A with Actor B
   * Actor A with Actor B & Actor C
   * Actor A with Actor B and Actor C
   */
  const withMatch =
    workingTitle.match(
      /^(.+?)\s+with\s+(.+)$/i
    );


  if (
    withMatch
  ) {

    const actors = [
      withMatch[1].trim()
    ];


    const rest =
      withMatch[2]
        .replace(
          /\s+-\s+.*$/,
          ""
        )
        .replace(
          /\s+#\d+$/,
          ""
        );


    const others =
      rest
        .replace(
          /\s+and\s+/gi,
          " & "
        )
        .split(
          /\s*,\s*|\s*&\s*/
        )
        .map(
          value =>
            value.trim()
        )
        .filter(Boolean);


    actors.push(
      ...others
    );


    return [
      ...new Set(
        actors.filter(Boolean)
      )
    ];
  }


  /*
   * FORMAT 2
   * --------
   *
   * Actor – description
   * Actor - description
   *
   * Example:
   *
   * TheMaskedsukr – a blowjob through the glorygole
   *
   * becomes:
   *
   * TheMaskedsukr
   */
  const dashMatch =
    workingTitle.match(
      /^(.+?)\s+[–—-]\s+(.+)$/
    );


  if (
    dashMatch
  ) {

    const actor =
      dashMatch[1]
        .trim();


    if (
      actor
    ) {

      return [
        actor
      ];
    }
  }


  /*
   * Unknown title format.
   *
   * Deliberately return nothing rather than guessing.
   */
  return [];
}


/* =====================================================================
   HASH HELPERS
===================================================================== */

function sha256Buffer(buffer) {

  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}


async function sha1File(filename) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const hash =
        crypto.createHash("sha1");

      const stream =
        fs.createReadStream(
          filename
        );


      stream.on(
        "data",
        chunk =>
          hash.update(chunk)
      );


      stream.on(
        "end",
        () =>
          resolve(
            hash.digest("hex")
          )
      );


      stream.on(
        "error",
        reject
      );
    }
  );
}


/* =====================================================================
   PORNFLIX-COMPATIBLE FINGERPRINT
===================================================================== */

async function calculateCompatibleFingerprint(
  filename
) {

  const handle =
    await fsp.open(
      filename,
      "r"
    );


  try {

    const stat =
      await handle.stat();

    const size =
      stat.size;


    async function readRange(
      start,
      length
    ) {

      const actualLength =
        Math.max(
          0,
          Math.min(
            length,
            size - start
          )
        );


      const buffer =
        Buffer.alloc(
          actualLength
        );


      if (
        actualLength > 0
      ) {

        await handle.read(
          buffer,
          0,
          actualLength,
          start
        );
      }


      return buffer;
    }


    const firstLength =
      Math.min(
        SAMPLE_SIZE,
        size
      );


    const middleStart =
      Math.max(
        0,
        Math.floor(
          size / 2 -
          SAMPLE_SIZE / 2
        )
      );


    const middleLength =
      Math.min(
        SAMPLE_SIZE,
        size - middleStart
      );


    const lastStart =
      Math.max(
        0,
        size - SAMPLE_SIZE
      );


    const lastLength =
      size - lastStart;


    const first =
      await readRange(
        0,
        firstLength
      );


    const middle =
      await readRange(
        middleStart,
        middleLength
      );


    const last =
      await readRange(
        lastStart,
        lastLength
      );


    const firstSha256 =
      sha256Buffer(first);

    const middleSha256 =
      sha256Buffer(middle);

    const lastSha256 =
      sha256Buffer(last);


    const fingerprintSource = [
      size,
      firstSha256,
      middleSha256,
      lastSha256
    ].join("|");


    return crypto
      .createHash("sha256")
      .update(
        fingerprintSource,
        "utf8"
      )
      .digest("hex");

  } finally {

    await handle.close();
  }
}

/* =====================================================================
   FFPROBE
===================================================================== */

async function probeVideo(filename) {

  const {
    stdout
  } =
    await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",

        "-select_streams",
        "v:0",

        "-show_entries",
        "stream=width,height:format=duration",

        "-of",
        "json",

        filename
      ]
    );


  const result =
    JSON.parse(stdout);


  const stream =
    result.streams?.[0];


  const duration =
    Math.round(
      Number(
        result.format?.duration ||
        0
      )
    );


  const width =
    Number(
      stream?.width ||
      0
    );


  const height =
    Number(
      stream?.height ||
      0
    );


  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isInteger(width) ||
    width <= 0 ||
    !Number.isInteger(height) ||
    height <= 0
  ) {

    throw new Error(
      "ffprobe did not return valid video metadata."
    );
  }


  return {
    duration,
    width,
    height
  };
}


/* =====================================================================
   INGESTION JOURNAL
===================================================================== */

async function createIngestion({
  originalFilename,
  filesizeBytes
}) {

  console.log(
    "Creating zulu_ingestions record..."
  );


  const timestamp =
    nowIso();


  const {
    data,
    error
  } =
    await supabase
      .from(
        "zulu_ingestions"
      )
      .insert({
        original_filename:
          originalFilename,

        filesize_bytes:
          filesizeBytes,

        status:
          "pending",

        thumbnail_status:
          "pending",

        updated_at:
          timestamp
      })
      .select(
        "id, status"
      )
      .single();


  if (
    error
  ) {

    throw error;
  }


  console.log(
    `Ingestion ID: ${data.id}`
  );


  return data.id;
}


async function updateIngestion(
  ingestionId,
  values
) {

  if (
    !ingestionId
  ) {

    throw new Error(
      "Cannot update ingestion without an ingestion ID."
    );
  }


  const {
    error
  } =
    await supabase
      .from(
        "zulu_ingestions"
      )
      .update({
        ...values,

        updated_at:
          nowIso()
      })
      .eq(
        "id",
        ingestionId
      );


  if (
    error
  ) {

    throw error;
  }
}


async function markIngestionFailed(
  ingestionId,
  failedStage,
  error
) {

  if (
    !ingestionId
  ) {

    return;
  }


  try {

    await updateIngestion(
      ingestionId,
      {
        status:
          "failed",

        failed_stage:
          failedStage,

        error_message:
          errorMessage(error)
      }
    );

  } catch (journalError) {

    console.error(
      "Could not record ingestion failure:",
      journalError
    );
  }
}


async function markIngestionCompleteWithoutThumbnail(
  ingestionId
) {

  const timestamp =
    nowIso();


  await updateIngestion(
    ingestionId,
    {
      status:
        "complete_without_thumbnail",

      thumbnail_status:
        "skipped",

      completed_at:
        timestamp,

      failed_stage:
        null,

      error_message:
        null
    }
  );
}


/* =====================================================================
   BACKBLAZE AUTHORIZATION
===================================================================== */

async function authorizeBackblaze() {

  console.log(
    "Authorizing with Backblaze..."
  );


  const credentials =
    Buffer.from(
      `${B2_APPLICATION_KEY_ID}:${B2_APPLICATION_KEY}`
    ).toString(
      "base64"
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


  if (
    !response.ok
  ) {

    const body =
      await response.text();


    throw new Error(
      `Backblaze authorization failed: ${response.status} ${body}`
    );
  }


  const data =
    await response.json();


  const storageApi =
    data?.apiInfo?.storageApi;


  const apiUrl =
    storageApi?.apiUrl;


  const authorizationToken =
    data?.authorizationToken;


  if (
    !apiUrl ||
    !authorizationToken
  ) {

    throw new Error(
      "Backblaze authorization response was missing apiUrl or authorizationToken."
    );
  }


  return {
    apiUrl,
    authorizationToken
  };
}


/* =====================================================================
   BACKBLAZE UPLOAD URL
===================================================================== */

async function getB2UploadUrl(
  apiUrl,
  authorizationToken
) {

  console.log(
    "Obtaining B2 upload URL..."
  );


  const response =
    await fetch(
      `${apiUrl}/b2api/v4/b2_get_upload_url?bucketId=${encodeURIComponent(
        B2_BUCKET_ID
      )}`,
      {
        method:
          "GET",

        headers: {
          Authorization:
            authorizationToken
        }
      }
    );


  if (
    !response.ok
  ) {

    const body =
      await response.text();


    throw new Error(
      `b2_get_upload_url failed: ${response.status} ${body}`
    );
  }


  const data =
    await response.json();


  if (
    !data.uploadUrl ||
    !data.authorizationToken
  ) {

    throw new Error(
      "Backblaze did not return an upload URL/token."
    );
  }


  return {
    uploadUrl:
      data.uploadUrl,

    authorizationToken:
      data.authorizationToken
  };
}


/* =====================================================================
   B2 FILENAME
===================================================================== */

function encodeB2Filename(filename) {

  return encodeURIComponent(
    filename
  ).replace(
    /%2F/gi,
    "/"
  );
}


/* =====================================================================
   B2 NORMAL UPLOAD
===================================================================== */

async function uploadToBackblaze({
  uploadUrl,
  authorizationToken,
  localFilename,
  remoteFilename,
  sha1
}) {

  console.log(
    `Uploading to B2 as: ${remoteFilename}`
  );


  const fileBuffer =
    await fsp.readFile(
      localFilename
    );


  const response =
    await fetch(
      uploadUrl,
      {
        method:
          "POST",

        headers: {
          Authorization:
            authorizationToken,

          "X-Bz-File-Name":
            encodeB2Filename(
              remoteFilename
            ),

          "Content-Type":
            "video/mp4",

          "X-Bz-Content-Sha1":
            sha1,

          "Content-Length":
            String(
              fileBuffer.length
            )
        },

        body:
          fileBuffer
      }
    );


  const responseText =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(
      `B2 upload failed: ${response.status} ${responseText}`
    );
  }


  let data;


  try {

    data =
      JSON.parse(
        responseText
      );

  } catch {

    throw new Error(
      `B2 upload succeeded but returned invalid JSON: ${responseText}`
    );
  }


  return data;
}

/* =====================================================================
   ZULU-FINALIZE-VIDEO
===================================================================== */

async function finalizeVideo({
  ingestionId,
  film,
  publicUrl,
  actors,
  tags,
  filesizeBytes,
  durationSeconds,
  width,
  height,
  fingerprint
}) {

  console.log("");
  console.log(
    "Calling zulu-finalize-video..."
  );


  const response =
    await fetch(
      FINALIZE_VIDEO_URL,
      {
        method:
          "POST",

          headers: {
            "Content-Type":
              "application/json",
          
            /*
             * Required by the Supabase Edge Function gateway.
             *
             * The service-role key is available only inside this GitHub Actions
             * job and is never exposed to the browser.
             */
            "Authorization":
              `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          
            /*
             * Our own server-to-server authentication.
             *
             * zulu-finalize-video validates this separately.
             */
            "X-Zulu-Automation-Key":
              ZULU_AUTOMATION_KEY
          },
        
        body:
          JSON.stringify({
            ingestion_id:
              ingestionId,

            film,

            url:
              publicUrl,

            actors,

            tags,

            filesize_bytes:
              filesizeBytes,

            duration_seconds:
              durationSeconds,

            width,

            height,

            fingerprint
          })
      }
    );


  const responseText =
    await response.text();


  let data;


  try {

    data =
      responseText
        ? JSON.parse(
            responseText
          )
        : {};

  } catch {

    throw new Error(
      `zulu-finalize-video returned invalid JSON. HTTP ${response.status}: ${responseText}`
    );
  }


  /*
   * A duplicate response is deliberately surfaced distinctly.
   *
   * The Edge Function itself owns the duplicate catalogue protection
   * and will have updated zulu_ingestions accordingly.
   */
  if (
    response.status === 409 &&
    data?.duplicate
  ) {

    const duplicateError =
      new Error(
        data.error ||
        "zulu-finalize-video found a duplicate."
      );


    duplicateError.isDuplicate =
      true;

    duplicateError.duplicateData =
      data;


    throw duplicateError;
  }


  if (
    !response.ok
  ) {

    throw new Error(
      `zulu-finalize-video failed: HTTP ${response.status} — ${
        data?.error ||
        responseText ||
        "Unknown error"
      }`
    );
  }


  if (
    !data?.success ||
    data?.uid == null
  ) {

    throw new Error(
      `zulu-finalize-video returned an incomplete success response: ${responseText}`
    );
  }


  return data;
}

/* =====================================================================
   RESUME EXISTING VIDEO_UPLOADED INGESTION
===================================================================== */

async function findResumableIngestion({
  film,
  canonicalFilename
}) {

  console.log("");
  console.log(
    "Checking for an existing resumable ingestion..."
  );


  const {
    data,
    error
  } =
    await supabase
      .from(
        "zulu_ingestions"
      )
      .select(`
        id,
        original_filename,
        canonical_filename,
        film,
        filesize_bytes,
        fingerprint,
        status,
        backblaze_file_id,
        public_url,
        video_uploaded_at,
        video_uid,
        created_at
      `)
      .eq(
        "film",
        film
      )
      .eq(
        "canonical_filename",
        canonicalFilename
      )
      .eq(
        "status",
        "video_uploaded"
      )
      .not(
        "public_url",
        "is",
        null
      )
      .not(
        "fingerprint",
        "is",
        null
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();


  if (
    error
  ) {

    throw error;
  }


  if (
    !data
  ) {

    console.log(
      "No resumable video_uploaded ingestion found."
    );

    return null;
  }


  console.log(
    "RESUMABLE INGESTION FOUND"
  );

  console.log(
    `  Ingestion: ${data.id}`
  );

  console.log(
    `  Status: ${data.status}`
  );

  console.log(
    `  Public URL: ${data.public_url}`
  );

  console.log(
    `  Fingerprint: ${data.fingerprint}`
  );

  console.log(
    `  Size: ${data.filesize_bytes}`
  );


  return data;
}


async function resumeVideoUploadedIngestion({
  ingestion,
  film,
  actors,
  tags,
  mediaUrl
}) {

  console.log("");
  console.log(
    "============================================================"
  );

  console.log(
    "RESUMING EXISTING VIDEO UPLOAD"
  );

  console.log(
    "============================================================"
  );


  /*
   * The MP4 itself is already safely in Backblaze.
   *
   * We therefore do NOT:
   *
   *   - download the MP4
   *   - calculate the fingerprint again
   *   - calculate the B2 SHA-1 again
   *   - upload anything to Backblaze
   *
   * We only need duration/dimensions for the finalizer.
   *
   * ffprobe can read these directly from the source media URL.
   */
  console.log("");
  console.log(
    "Reading video metadata directly from source URL..."
  );


  const metadata =
    await probeVideo(
      mediaUrl
    );


  console.log(
    `Duration: ${metadata.duration}`
  );

  console.log(
    `Dimensions: ${metadata.width}x${metadata.height}`
  );


  const filesizeBytes =
    Number(
      ingestion.filesize_bytes
    );


  if (
    !Number.isFinite(filesizeBytes) ||
    filesizeBytes <= 0
  ) {

    throw new Error(
      `Existing ingestion ${ingestion.id} has an invalid filesize_bytes value.`
    );
  }


  if (
    !ingestion.fingerprint
  ) {

    throw new Error(
      `Existing ingestion ${ingestion.id} has no fingerprint.`
    );
  }


  if (
    !ingestion.public_url
  ) {

    throw new Error(
      `Existing ingestion ${ingestion.id} has no public_url.`
    );
  }


  console.log("");
  console.log(
    "Submitting existing upload to zulu-finalize-video:"
  );

  console.log(
    `  Ingestion: ${ingestion.id}`
  );

  console.log(
    `  Film: ${film}`
  );

  console.log(
    `  Actors: ${actors.join(", ")}`
  );

  console.log(
    `  URL: ${ingestion.public_url}`
  );

  console.log(
    `  Size: ${filesizeBytes}`
  );

  console.log(
    `  Duration: ${metadata.duration}`
  );

  console.log(
    `  Dimensions: ${metadata.width}x${metadata.height}`
  );


  const finalizeData =
    await finalizeVideo({
      ingestionId:
        ingestion.id,

      film,

      publicUrl:
        ingestion.public_url,

      actors,

      tags,

      filesizeBytes,

      durationSeconds:
        metadata.duration,

      width:
        metadata.width,

      height:
        metadata.height,

      fingerprint:
        ingestion.fingerprint
    });


  console.log("");
  console.log(
    "CATALOGUE FINALIZATION SUCCESSFUL"
  );

  console.log(
    `Video UID: ${finalizeData.uid}`
  );

  console.log(
    `Ingestion status returned: ${finalizeData.ingestion_status}`
  );


  /*
   * Thumbnail processing is deliberately not part of this test yet.
   */
  await markIngestionCompleteWithoutThumbnail(
    ingestion.id
  );


  console.log(
    "Ingestion marked complete_without_thumbnail."
  );


  /*
   * Verify that the catalogue record actually exists.
   */
  const {
    data: savedVideo,
    error: videoError
  } =
    await supabase
      .from(
        "zulu_videos"
      )
      .select(`
        uid,
        film,
        url,
        filesize_bytes,
        duration_seconds,
        width,
        height,
        fingerprint
      `)
      .eq(
        "uid",
        finalizeData.uid
      )
      .single();


  if (
    videoError
  ) {

    throw new Error(
      `Finalization succeeded but catalogue verification failed: ${videoError.message}`
    );
  }


  const {
    data: savedActors,
    error: actorsError
  } =
    await supabase
      .from(
        "zulu_actors"
      )
      .select(
        "actor"
      )
      .eq(
        "uid",
        finalizeData.uid
      );


  if (
    actorsError
  ) {

    throw new Error(
      `Finalization succeeded but actor verification failed: ${actorsError.message}`
    );
  }


  const {
    data: finalIngestion,
    error: ingestionError
  } =
    await supabase
      .from(
        "zulu_ingestions"
      )
      .select(`
        id,
        status,
        video_uid,
        public_url,
        thumbnail_status,
        completed_at
      `)
      .eq(
        "id",
        ingestion.id
      )
      .single();


  if (
    ingestionError
  ) {

    throw new Error(
      `Finalization succeeded but ingestion verification failed: ${ingestionError.message}`
    );
  }


  console.log("");
  console.log(
    "============================================================"
  );

  console.log(
    "RESUMED IMPORT SUCCESSFUL"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `Video UID: ${savedVideo.uid}`
  );

  console.log(
    `Film: ${savedVideo.film}`
  );

  console.log(
    `Actors: ${
      savedActors
        ?.map(
          row =>
            row.actor
        )
        .join(", ") ||
      "(none)"
    }`
  );

  console.log(
    `URL: ${savedVideo.url}`
  );

  console.log(
    `Ingestion: ${finalIngestion.id}`
  );

  console.log(
    `Ingestion status: ${finalIngestion.status}`
  );

  console.log(
    `Thumbnail status: ${finalIngestion.thumbnail_status}`
  );

  console.log(
    "============================================================"
  );


  return {
    finalizeData,
    savedVideo,
    savedActors,
    finalIngestion
  };
}


/* =====================================================================
   CANDIDATE QUEUE
===================================================================== */

async function loadReadyCandidates() {

  console.log("");
  console.log(
    "Loading ready candidate queue..."
  );


  const {
    data,
    error
  } =
    await supabase
      .from(
        "zulu_candidates"
      )
      .select(`
        id,
        title,
        status,
        media_url,
        media_filename,
        media_size_bytes,
        import_film,
        import_actors,
        import_tags,
        import_status,
        imported_uid,
        ingestion_id,
        import_started_at,
        imported_at,
        import_error,
        source_uploaded_at,
        first_seen_at
      `)
      .eq(
        "status",
        "accepted"
      )
      .eq(
        "import_status",
        "ready"
      )
      .order(
        "source_uploaded_at",
        {
          ascending: true,
          nullsFirst: false
        }
      )
      .order(
        "id",
        {
          ascending: true
        }
      )
      .limit(
        MAX_CANDIDATES_PER_RUN
      );


  if (
    error
  ) {
    throw error;
  }


  console.log(
    `Ready candidates: ${
      data?.length || 0
    }`
  );


  return data || [];
}


async function loadCandidateById(
  candidateId
) {

  const {
    data,
    error
  } =
    await supabase
      .from(
        "zulu_candidates"
      )
      .select(`
        id,
        title,
        status,
        media_url,
        media_filename,
        media_size_bytes,
        import_film,
        import_actors,
        import_tags,
        import_status,
        imported_uid,
        ingestion_id,
        import_started_at,
        imported_at,
        import_error
      `)
      .eq(
        "id",
        candidateId
      )
      .single();


  if (
    error
  ) {
    throw error;
  }


  return data;
}


async function updateCandidateImport(
  candidateId,
  values
) {

  const {
    error
  } =
    await supabase
      .from(
        "zulu_candidates"
      )
      .update(
        values
      )
      .eq(
        "id",
        candidateId
      );


  if (
    error
  ) {
    throw error;
  }
}


async function markCandidateImporting(
  candidateId
) {

  await updateCandidateImport(
    candidateId,
    {
      import_status:
        "importing",

      import_started_at:
        nowIso(),

      import_error:
        null
    }
  );
}


async function linkCandidateIngestion(
  candidateId,
  ingestionId
) {

  await updateCandidateImport(
    candidateId,
    {
      ingestion_id:
        ingestionId,

      import_error:
        null
    }
  );
}


async function markCandidateImported(
  candidateId,
  videoUid,
  ingestionId
) {

  await updateCandidateImport(
    candidateId,
    {
      import_status:
        "imported",

      imported_uid:
        videoUid,

      ingestion_id:
        ingestionId,

      imported_at:
        nowIso(),

      import_error:
        null
    }
  );
}


async function markCandidateDuplicate(
  candidateId,
  duplicateUid,
  ingestionId,
  message
) {

  await updateCandidateImport(
    candidateId,
    {
      import_status:
        "duplicate",

      imported_uid:
        duplicateUid || null,

      ingestion_id:
        ingestionId || null,

      imported_at:
        null,

      import_error:
        message ||
        "Duplicate video detected."
    }
  );
}


async function markCandidateFailed(
  candidateId,
  ingestionId,
  error
) {

  try {

    await updateCandidateImport(
      candidateId,
      {
        import_status:
          "failed",

        ingestion_id:
          ingestionId || null,

        imported_at:
          null,

        import_error:
          errorMessage(
            error
          )
      }
    );

  } catch (
    candidateError
  ) {

    console.error(
      "Could not record candidate failure:",
      candidateError
    );
  }
}


/* =====================================================================
   INGESTION RESUME BY ID
===================================================================== */

async function loadCandidateIngestion(
  ingestionId
) {

  if (
    !ingestionId
  ) {
    return null;
  }


  console.log("");
  console.log(
    `Loading linked ingestion ${ingestionId}...`
  );


  const {
    data,
    error
  } =
    await supabase
      .from(
        "zulu_ingestions"
      )
      .select(`
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
        completed_at,
        created_at,
        updated_at
      `)
      .eq(
        "id",
        ingestionId
      )
      .maybeSingle();


  if (
    error
  ) {
    throw error;
  }


  return data;
}

/* =====================================================================
   MAIN
===================================================================== */

async function main() {

  console.log(
    "============================================================"
  );

  console.log(
    "PORNFLIX CANDIDATE IMPORT QUEUE"
  );

  console.log(
    "============================================================"
  );


  const candidates =
    await loadReadyCandidates();


  if (
    candidates.length === 0
  ) {

    console.log("");
    console.log(
      "No candidates are ready for import."
    );

    console.log(
      "Nothing to do."
    );

    return;
  }


  console.log("");
  console.log(
    `Processing up to ${MAX_CANDIDATES_PER_RUN} candidate(s) sequentially.`
  );


  let imported =
    0;

  let duplicates =
    0;

  let failed =
    0;


  for (
    const queuedCandidate
    of candidates
  ) {

    try {

      const result =
        await processCandidate(
          queuedCandidate.id
        );


      if (
        result === "imported"
      ) {

        imported++;
      }


      if (
        result === "duplicate"
      ) {

        duplicates++;
      }


    } catch (
      error
    ) {

      failed++;


      console.error("");
      console.error(
        `Candidate ${queuedCandidate.id} failed:`
      );

      console.error(
        errorMessage(
          error
        )
      );


      /*
       * A failure of one candidate must not prevent later ready
       * candidates from being attempted.
       */
    }
  }


  console.log("");
  console.log(
    "============================================================"
  );

  console.log(
    "CANDIDATE QUEUE COMPLETE"
  );

  console.log(
    "============================================================"
  );

  console.log(
    `Imported: ${imported}`
  );

  console.log(
    `Duplicates: ${duplicates}`
  );

  console.log(
    `Failed: ${failed}`
  );

  console.log(
    "============================================================"
  );


  /*
   * We deliberately fail the GitHub Actions job if any candidate failed,
   * even though later candidates were allowed to continue.
   */

  if (
    failed > 0
  ) {

    throw new Error(
      `${failed} candidate import(s) failed.`
    );
  }
}


async function processCandidate(
  candidateId
) {

  const tempFilename =
    path.join(
      process.cwd(),
      `candidate-${candidateId}.mp4`
    );


  let ingestionId =
    null;


  let currentStage =
    "candidate_validation";


  try {

    console.log("");
    console.log(
      "============================================================"
    );

    console.log(
      `CANDIDATE ${candidateId}`
    );

    console.log(
      "============================================================"
    );


    /* ---------------------------------------------------------------
       1. LOAD CURRENT CANDIDATE STATE
    --------------------------------------------------------------- */

    const candidate =
      await loadCandidateById(
        candidateId
      );


    if (
      !candidate
    ) {

      throw new Error(
        "Candidate not found."
      );
    }


    if (
      candidate.status !==
      "accepted"
    ) {

      throw new Error(
        `Candidate is not accepted. Current status: ${candidate.status}`
      );
    }


    if (
      candidate.import_status !==
      "ready"
    ) {

      console.log(
        `Skipping candidate ${candidateId}; import status is now "${candidate.import_status}".`
      );

      return "skipped";
    }


    if (
      !candidate.media_url
    ) {

      throw new Error(
        "Candidate has no resolved media URL."
      );
    }


    const film =
      String(
        candidate.import_film ||
        ""
      ).trim();


    const actors =
      Array.isArray(
        candidate.import_actors
      )
        ? candidate.import_actors
            .map(
              value =>
                String(
                  value
                ).trim()
            )
            .filter(Boolean)
        : [];


    const tags =
      Array.isArray(
        candidate.import_tags
      )
        ? candidate.import_tags
            .map(
              value =>
                String(
                  value
                ).trim()
            )
            .filter(Boolean)
        : [];


    if (
      !film
    ) {

      throw new Error(
        "Candidate has no approved import_film."
      );
    }


    if (
      actors.length === 0
    ) {

      throw new Error(
        "Candidate has no approved import_actors."
      );
    }


    console.log(
      `Film: ${film}`
    );

    console.log(
      `Actors: ${actors.join(", ")}`
    );

    console.log(
      `Tags: ${
        tags.length
          ? tags.join(", ")
          : "(none)"
      }`
    );

    console.log(
      `Media: ${candidate.media_url}`
    );


    /* ---------------------------------------------------------------
       2. CLAIM CANDIDATE
    --------------------------------------------------------------- */

    currentStage =
      "candidate_claim";


    await markCandidateImporting(
      candidateId
    );


    console.log(
      "Candidate marked importing."
    );


    /* ---------------------------------------------------------------
       3. CHECK LINKED INGESTION
    --------------------------------------------------------------- */

    ingestionId =
      candidate.ingestion_id ||
      null;


    if (
      ingestionId
    ) {

      const linkedIngestion =
        await loadCandidateIngestion(
          ingestionId
        );


      if (
        !linkedIngestion
      ) {

        throw new Error(
          `Candidate references missing ingestion ${ingestionId}.`
        );
      }


      console.log(
        `Linked ingestion status: ${linkedIngestion.status}`
      );


      /*
       * The MP4 is already in B2. Resume at catalogue finalization.
       */

      if (
        linkedIngestion.status ===
        "video_uploaded"
      ) {

        currentStage =
          "cataloguing";


        const resumed =
          await resumeVideoUploadedIngestion({
            ingestion:
              linkedIngestion,

            film,

            actors,

            tags,

            mediaUrl:
              candidate.media_url
          });


        await markCandidateImported(
          candidateId,
          resumed.savedVideo.uid,
          ingestionId
        );


        console.log(
          `Candidate ${candidateId} marked imported.`
        );


        return "imported";
      }


      /*
       * Catalogue finalization may have completed before the previous
       * process stopped while updating the candidate row.
       */

      if (
        [
          "catalogued",
          "complete",
          "complete_without_thumbnail"
        ].includes(
          linkedIngestion.status
        ) &&
        linkedIngestion.video_uid
      ) {

        if (
          linkedIngestion.status ===
          "catalogued"
        ) {

          await markIngestionCompleteWithoutThumbnail(
            ingestionId
          );
        }


        await markCandidateImported(
          candidateId,
          linkedIngestion.video_uid,
          ingestionId
        );


        console.log(
          `Candidate ${candidateId} recovered from completed ingestion.`
        );


        return "imported";
      }


      if (
        linkedIngestion.status ===
        "duplicate"
      ) {

        await markCandidateDuplicate(
          candidateId,
          linkedIngestion.video_uid,
          ingestionId,
          linkedIngestion.error_message ||
          "Linked ingestion is a duplicate."
        );


        console.log(
          `Candidate ${candidateId} marked duplicate from linked ingestion.`
        );


        return "duplicate";
      }


      /*
       * A linked ingestion in an earlier state cannot safely be resumed
       * from the remote source without knowing exactly which local work
       * completed before interruption.
       *
       * We fail closed instead of creating another ingestion/B2 object.
       */

      throw new Error(
        `Linked ingestion ${ingestionId} is in status "${linkedIngestion.status}" and cannot yet be resumed automatically.`
      );
    }


    /* ---------------------------------------------------------------
       4. DOWNLOAD MP4
    --------------------------------------------------------------- */

    currentStage =
      "downloading";


    console.log("");
    console.log(
      "Downloading MP4..."
    );


    const downloadResponse =
      await fetch(
        candidate.media_url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0"
          }
        }
      );


    if (
      !downloadResponse.ok
    ) {

      throw new Error(
        `Download failed: HTTP ${downloadResponse.status}`
      );
    }


    if (
      !downloadResponse.body
    ) {

      throw new Error(
        "Download response had no body."
      );
    }


    await pipeline(
      Readable.fromWeb(
        downloadResponse.body
      ),

      fs.createWriteStream(
        tempFilename
      )
    );


    const stat =
      await fsp.stat(
        tempFilename
      );


    console.log(
      `Downloaded bytes: ${stat.size}`
    );


    if (
      candidate.media_size_bytes &&
      Number(
        candidate.media_size_bytes
      ) !==
        stat.size
    ) {

      throw new Error(
        `Downloaded size mismatch. Expected ${candidate.media_size_bytes}, received ${stat.size}.`
      );
    }


    /* ---------------------------------------------------------------
       5. CREATE INGESTION
    --------------------------------------------------------------- */

    currentStage =
      "ingestion_create";


    ingestionId =
      await createIngestion({
        originalFilename:
          candidate.media_filename ||
          `${film}.mp4`,

        filesizeBytes:
          stat.size
      });


    /*
     * This linkage is written immediately.
     *
     * From this point onward, a retry knows exactly which ingestion
     * belongs to this candidate.
     */

    await linkCandidateIngestion(
      candidateId,
      ingestionId
    );


    console.log(
      `Candidate linked to ingestion ${ingestionId}.`
    );


    await updateIngestion(
      ingestionId,
      {
        status:
          "analysing",

        film,

        failed_stage:
          null,

        error_message:
          null
      }
    );


    /* ---------------------------------------------------------------
       6. FFPROBE
    --------------------------------------------------------------- */

    currentStage =
      "analysis";


    console.log("");
    console.log(
      "Running ffprobe..."
    );


    const metadata =
      await probeVideo(
        tempFilename
      );


    console.log(
      `Duration: ${metadata.duration}`
    );

    console.log(
      `Dimensions: ${metadata.width}x${metadata.height}`
    );


    /* ---------------------------------------------------------------
       7. FINGERPRINT
    --------------------------------------------------------------- */

    console.log(
      "Calculating Pornflix-compatible fingerprint..."
    );


    const fingerprint =
      await calculateCompatibleFingerprint(
        tempFilename
      );


    console.log(
      `Fingerprint: ${fingerprint}`
    );


    const remoteFilename =
      `${film}.mp4`;


    await updateIngestion(
      ingestionId,
      {
        status:
          "ready",

        canonical_filename:
          remoteFilename,

        film,

        filesize_bytes:
          stat.size,

        fingerprint,

        failed_stage:
          null,

        error_message:
          null
      }
    );


    /* ---------------------------------------------------------------
       8. DUPLICATE CHECK
    --------------------------------------------------------------- */

    currentStage =
      "duplicate_check";


    console.log("");
    console.log(
      "Checking zulu_videos for fingerprint duplicate..."
    );


    const {
      data: duplicates,
      error: duplicateError
    } =
      await supabase
        .from(
          "zulu_videos"
        )
        .select(`
          uid,
          film,
          fingerprint
        `)
        .eq(
          "fingerprint",
          fingerprint
        )
        .limit(1);


    if (
      duplicateError
    ) {
      throw duplicateError;
    }


    if (
      duplicates &&
      duplicates.length > 0
    ) {

      const duplicate =
        duplicates[0];


      const duplicateMessage =
        `Fingerprint already exists as video UID ${duplicate.uid}.`;


      console.log("");
      console.log(
        "DUPLICATE FOUND"
      );

      console.log(
        duplicate
      );


      await updateIngestion(
        ingestionId,
        {
          status:
            "duplicate",

          failed_stage:
            "duplicate_check",

          error_message:
            duplicateMessage,

          video_uid:
            duplicate.uid
        }
      );


      await markCandidateDuplicate(
        candidateId,
        duplicate.uid,
        ingestionId,
        duplicateMessage
      );


      console.log(
        "Candidate marked duplicate."
      );

      console.log(
        "Stopping before Backblaze upload."
      );


      return "duplicate";
    }


    console.log(
      "NO DUPLICATE FOUND"
    );


    /* ---------------------------------------------------------------
       9. B2 SHA-1
    --------------------------------------------------------------- */

    currentStage =
      "uploading";


    console.log("");
    console.log(
      "Calculating B2 SHA-1..."
    );


    const sha1 =
      await sha1File(
        tempFilename
      );


    console.log(
      `SHA-1: ${sha1}`
    );

    console.log(
      `Canonical filename: ${remoteFilename}`
    );


    await updateIngestion(
      ingestionId,
      {
        status:
          "uploading",

        canonical_filename:
          remoteFilename,

        failed_stage:
          null,

        error_message:
          null
      }
    );


    /* ---------------------------------------------------------------
       10. BACKBLAZE AUTH
    --------------------------------------------------------------- */

    const {
      apiUrl,
      authorizationToken
    } =
      await authorizeBackblaze();


    /* ---------------------------------------------------------------
       11. GET B2 UPLOAD URL
    --------------------------------------------------------------- */

    const {
      uploadUrl,
      authorizationToken:
        uploadAuthorizationToken
    } =
      await getB2UploadUrl(
        apiUrl,
        authorizationToken
      );


    /* ---------------------------------------------------------------
       12. UPLOAD
    --------------------------------------------------------------- */

    const uploadResult =
      await uploadToBackblaze({
        uploadUrl,

        authorizationToken:
          uploadAuthorizationToken,

        localFilename:
          tempFilename,

        remoteFilename,

        sha1
      });


    console.log("");
    console.log(
      "B2 UPLOAD SUCCESSFUL"
    );

    console.log(
      `B2 file ID: ${uploadResult.fileId}`
    );

    console.log(
      `B2 filename: ${uploadResult.fileName}`
    );

    console.log(
      `B2 bytes: ${uploadResult.contentLength}`
    );

    console.log(
      `B2 SHA-1: ${uploadResult.contentSha1}`
    );


    const publicUrl =
      `https://media.zulu-orchid-falcon.co.uk/${encodeB2Filename(
        remoteFilename
      )}`;


    console.log(
      `Public URL: ${publicUrl}`
    );


    /* ---------------------------------------------------------------
       13. VIDEO_UPLOADED
    --------------------------------------------------------------- */

    currentStage =
      "video_uploaded";


    const videoUploadedAt =
      nowIso();


    await updateIngestion(
      ingestionId,
      {
        status:
          "video_uploaded",

        canonical_filename:
          remoteFilename,

        film,

        filesize_bytes:
          stat.size,

        fingerprint,

        backblaze_file_id:
          uploadResult.fileId ||
          null,

        public_url:
          publicUrl,

        video_uploaded_at:
          videoUploadedAt,

        failed_stage:
          null,

        error_message:
          null
      }
    );


    console.log(
      "Ingestion marked video_uploaded."
    );


    /* ---------------------------------------------------------------
       14. FINALIZE CATALOGUE
    --------------------------------------------------------------- */

    currentStage =
      "cataloguing";


    console.log("");
    console.log(
      "Submitting catalogue metadata:"
    );

    console.log(
      `  Ingestion: ${ingestionId}`
    );

    console.log(
      `  Film: ${film}`
    );

    console.log(
      `  Actors: ${actors.join(", ")}`
    );

    console.log(
      `  URL: ${publicUrl}`
    );

    console.log(
      `  Size: ${stat.size}`
    );

    console.log(
      `  Duration: ${metadata.duration}`
    );

    console.log(
      `  Dimensions: ${metadata.width}x${metadata.height}`
    );


    const finalizeData =
      await finalizeVideo({
        ingestionId,

        film,

        publicUrl,

        actors,

        tags,

        filesizeBytes:
          stat.size,

        durationSeconds:
          metadata.duration,

        width:
          metadata.width,

        height:
          metadata.height,

        fingerprint
      });


    console.log("");
    console.log(
      "CATALOGUE FINALIZATION SUCCESSFUL"
    );

    console.log(
      `Video UID: ${finalizeData.uid}`
    );


    /* ---------------------------------------------------------------
       15. COMPLETE WITHOUT THUMBNAIL
    --------------------------------------------------------------- */

    currentStage =
      "completion";


    await markIngestionCompleteWithoutThumbnail(
      ingestionId
    );


    console.log(
      "Ingestion marked complete_without_thumbnail."
    );


    /* ---------------------------------------------------------------
       16. VERIFY CATALOGUE
    --------------------------------------------------------------- */

    const {
      data: savedVideo,
      error: verifyVideoError
    } =
      await supabase
        .from(
          "zulu_videos"
        )
        .select(`
          uid,
          film,
          url,
          filesize_bytes,
          duration_seconds,
          width,
          height,
          fingerprint
        `)
        .eq(
          "uid",
          finalizeData.uid
        )
        .single();


    if (
      verifyVideoError
    ) {

      throw new Error(
        `Catalogue was finalized but verification failed: ${verifyVideoError.message}`
      );
    }


    const {
      data: savedActors,
      error: verifyActorsError
    } =
      await supabase
        .from(
          "zulu_actors"
        )
        .select(
          "actor"
        )
        .eq(
          "uid",
          finalizeData.uid
        );


    if (
      verifyActorsError
    ) {

      throw new Error(
        `Catalogue was finalized but actor verification failed: ${verifyActorsError.message}`
      );
    }


    const {
      data: finalIngestion,
      error: verifyIngestionError
    } =
      await supabase
        .from(
          "zulu_ingestions"
        )
        .select(`
          id,
          status,
          video_uid,
          public_url,
          thumbnail_status,
          completed_at
        `)
        .eq(
          "id",
          ingestionId
        )
        .single();


    if (
      verifyIngestionError
    ) {

      throw new Error(
        `Catalogue was finalized but ingestion verification failed: ${verifyIngestionError.message}`
      );
    }


    /* ---------------------------------------------------------------
       17. MARK CANDIDATE IMPORTED
    --------------------------------------------------------------- */

    await markCandidateImported(
      candidateId,
      savedVideo.uid,
      ingestionId
    );


    console.log("");
    console.log(
      "============================================================"
    );

    console.log(
      "IMPORT SUCCESSFUL"
    );

    console.log(
      "============================================================"
    );

    console.log(
      `Candidate: ${candidateId}`
    );

    console.log(
      `Video UID: ${savedVideo.uid}`
    );

    console.log(
      `Film: ${savedVideo.film}`
    );

    console.log(
      `Actors: ${
        savedActors
          ?.map(
            row =>
              row.actor
          )
          .join(", ") ||
        "(none)"
      }`
    );

    console.log(
      `URL: ${savedVideo.url}`
    );

    console.log(
      `Ingestion: ${finalIngestion.id}`
    );

    console.log(
      `Ingestion status: ${finalIngestion.status}`
    );

    console.log(
      `Thumbnail status: ${finalIngestion.thumbnail_status}`
    );

    console.log(
      `Candidate status: imported`
    );

    console.log(
      "============================================================"
    );


    return "imported";


  } catch (
    error
  ) {

    console.error("");
    console.error(
      "============================================================"
    );

    console.error(
      `CANDIDATE ${candidateId} FAILED`
    );

    console.error(
      "============================================================"
    );

    console.error(
      `Stage: ${currentStage}`
    );

    console.error(
      error
    );


    /*
     * The finalizer owns ingestion catalogue-stage failures.
     */

    if (
      ingestionId &&
      currentStage !==
        "cataloguing"
    ) {

      await markIngestionFailed(
        ingestionId,
        currentStage,
        error
      );
    }


    if (
      error?.isDuplicate
    ) {

      const duplicateUid =
        error?.duplicateData?.uid ||
        error?.duplicateData?.existing_uid ||
        null;


      await markCandidateDuplicate(
        candidateId,
        duplicateUid,
        ingestionId,
        errorMessage(
          error
        )
      );


      console.error(
        "Finalizer reported duplicate:",
        error.duplicateData
      );


      return "duplicate";
    }


    await markCandidateFailed(
      candidateId,
      ingestionId,
      error
    );


    throw error;


  } finally {

    try {

      await fsp.unlink(
        tempFilename
      );

    } catch {

      // Temporary file may not exist.
    }
  }
}

/* =====================================================================
   RUN
===================================================================== */

main()
  .catch(
    error => {

      console.error("");
      console.error(
       "Candidate import queue terminated:"
      );

      console.error(
        errorMessage(error)
      );


      process.exit(1);
    }
  );
