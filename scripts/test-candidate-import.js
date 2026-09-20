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

const CANDIDATE_ID = 1;

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
   MAIN
===================================================================== */

async function main() {

  const tempFilename =
    path.join(
      process.cwd(),
      `candidate-${CANDIDATE_ID}.mp4`
    );


  let ingestionId =
    null;


  let currentStage =
    "candidate_validation";


  try {

    console.log(
      "============================================================"
    );

    console.log(
      `PORNFLIX CANDIDATE IMPORT TEST — CANDIDATE ${CANDIDATE_ID}`
    );

    console.log(
      "============================================================"
    );

    console.log("");


    /* ---------------------------------------------------------------
       1. LOAD CANDIDATE
    --------------------------------------------------------------- */

    console.log(
      `Loading candidate ${CANDIDATE_ID}...`
    );


    const {
      data: candidate,
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
          import_status
        `)
        .eq(
          "id",
          CANDIDATE_ID
        )
        .single();


    if (
      error
    ) {

      throw error;
    }


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
      !candidate.media_url
    ) {

      throw new Error(
        "Candidate has no resolved media URL."
      );
    }


    const film =
      String(
        candidate.title ||
        ""
      ).trim();


    if (
      !film
    ) {

      throw new Error(
        "Candidate has no film title."
      );
    }


    console.log(
      `Title: ${film}`
    );

    console.log(
      `Media: ${candidate.media_url}`
    );


    /* ---------------------------------------------------------------
       2. INFER ACTORS
    --------------------------------------------------------------- */

    const actors =
      inferActorsFromTitle(
        film
      );


    console.log("");
    console.log(
      "Catalogue metadata:"
    );

    console.log(
      `  Film: ${film}`
    );

    console.log(
      `  Actors: ${
        actors.length
          ? actors.join(", ")
          : "(none detected)"
      }`
    );


    if (
      actors.length === 0
    ) {

      throw new Error(
        `Could not infer actors from candidate title "${film}". Nothing has been uploaded.`
      );
    }


    /*
     * Tags are intentionally empty for this first controlled test.
     */
    const tags = [];


    /* ---------------------------------------------------------------
       3. CHECK FOR INTERRUPTED/RESUMABLE IMPORT
    --------------------------------------------------------------- */

    const expectedCanonicalFilename =
      `${film}.mp4`;


    const resumableIngestion =
      await findResumableIngestion({
        film,

        canonicalFilename:
          expectedCanonicalFilename
      });


    if (
      resumableIngestion
    ) {

      /*
       * Candidate #1 has already reached Backblaze.
       *
       * Do NOT download or upload the MP4 again.
       */
      ingestionId =
        resumableIngestion.id;


      currentStage =
        "cataloguing";


      await resumeVideoUploadedIngestion({
        ingestion:
          resumableIngestion,

        film,

        actors,

        tags,

        mediaUrl:
          candidate.media_url
      });


      /*
       * The resumed import is complete.
       *
       * Returning here is important: none of the normal download /
       * analysis / Backblaze code below should execute.
       */
      return;
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
       4. CREATE INGESTION JOURNAL
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
     * Analysis begins.
     *
     * We are not generating a thumbnail during this first automated
     * test, so thumbnail_status remains pending for now.
     */
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
       5. FFPROBE
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
       6. FINGERPRINT
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
       7. DUPLICATE CHECK
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
            `Fingerprint already exists as video UID ${duplicate.uid}.`,

          video_uid:
            duplicate.uid
        }
      );


      console.log(
        "Stopping before Backblaze upload."
      );


      return;
    }


    console.log(
      "NO DUPLICATE FOUND"
    );

      /* ---------------------------------------------------------------
       8. B2 SHA-1
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


    /*
     * The ingestion enters uploading BEFORE contacting Backblaze.
     */
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
       9. BACKBLAZE AUTH
    --------------------------------------------------------------- */

    const {
      apiUrl,
      authorizationToken
    } =
      await authorizeBackblaze();


    /* ---------------------------------------------------------------
       10. GET B2 UPLOAD URL
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
       11. UPLOAD MP4
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
       12. MARK VIDEO_UPLOADED
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
       13. FINALIZE CATALOGUE
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


    /*
     * IMPORTANT:
     *
     * We do NOT insert zulu_videos or zulu_actors here.
     *
     * zulu-finalize-video remains the single authoritative catalogue
     * finalization path.
     */
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

    console.log(
      `Ingestion status returned: ${finalizeData.ingestion_status}`
    );


    /* ---------------------------------------------------------------
       14. COMPLETE WITHOUT THUMBNAIL
    --------------------------------------------------------------- */

    currentStage =
      "completion";


    /*
     * Thumbnail automation is deliberately outside this first test.
     *
     * The MP4 and catalogue are now both valid, so the correct final
     * ingestion state is complete_without_thumbnail rather than failed.
     */
    await markIngestionCompleteWithoutThumbnail(
      ingestionId
    );


    console.log(
      "Ingestion marked complete_without_thumbnail."
    );


    /* ---------------------------------------------------------------
       15. VERIFY RESULT
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


    console.log("");
    console.log(
      "============================================================"
    );

    console.log(
      "END-TO-END IMPORT SUCCESSFUL"
    );

    console.log(
      "============================================================"
    );

    console.log(
      `Candidate: ${CANDIDATE_ID}`
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

    console.log("");
    console.log(
      "Candidate import_status has deliberately NOT been changed yet."
    );

    console.log(
      "Thumbnail generation/upload has deliberately NOT been run yet."
    );

    console.log(
      "============================================================"
    );


  } catch (error) {

    console.error("");
    console.error(
      "============================================================"
    );

    console.error(
      "TEST FAILED"
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
     * zulu-finalize-video manages its own catalogue-stage failures.
     *
     * For failures before catalogue finalization, this script records
     * the failure itself.
     *
     * We avoid overwriting a duplicate state returned by the finalizer.
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

      console.error(
        "Finalizer reported duplicate:",
        error.duplicateData
      );
    }


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
        "Candidate import test terminated:"
      );

      console.error(
        errorMessage(error)
      );


      process.exit(1);
    }
  );
