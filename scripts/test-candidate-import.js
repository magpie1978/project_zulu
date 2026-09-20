const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const CANDIDATE_ID = 1;
const SAMPLE_SIZE = 4 * 1024 * 1024;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const B2_APPLICATION_KEY_ID =
  process.env.B2_APPLICATION_KEY_ID;

const B2_APPLICATION_KEY =
  process.env.B2_APPLICATION_KEY;

const B2_BUCKET_ID =
  process.env.B2_BUCKET_ID;

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !B2_APPLICATION_KEY_ID ||
  !B2_APPLICATION_KEY ||
  !B2_BUCKET_ID
) {
  throw new Error(
    "Missing required Supabase or Backblaze environment variables."
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);


/* ================================================================
   HASH HELPERS
================================================================ */

function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}


async function sha1File(filename) {

  return new Promise((resolve, reject) => {

    const hash =
      crypto.createHash("sha1");

    const stream =
      fs.createReadStream(filename);

    stream.on(
      "data",
      chunk => hash.update(chunk)
    );

    stream.on(
      "end",
      () => resolve(hash.digest("hex"))
    );

    stream.on(
      "error",
      reject
    );

  });

}


/* ================================================================
   PORNFLIX-COMPATIBLE FINGERPRINT
================================================================ */

async function calculateCompatibleFingerprint(filename) {

  const handle =
    await fsp.open(filename, "r");

  try {

    const stat =
      await handle.stat();

    const size =
      stat.size;


    async function readRange(start, length) {

      const actualLength =
        Math.max(
          0,
          Math.min(length, size - start)
        );

      const buffer =
        Buffer.alloc(actualLength);

      if (actualLength > 0) {

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


/* ================================================================
   FFPROBE
================================================================ */

async function probeVideo(filename) {

  const {
    stdout
  } = await execFileAsync(
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

  return {
    duration:
      Math.round(
        Number(
          result.format?.duration || 0
        )
      ),

    width:
      Number(
        stream?.width || 0
      ),

    height:
      Number(
        stream?.height || 0
      )
  };

}


/* ================================================================
   B2 AUTHORIZATION
================================================================ */

async function authorizeBackblaze() {

  console.log(
    "Authorizing with Backblaze..."
  );

  const credentials =
    Buffer.from(
      `${B2_APPLICATION_KEY_ID}:${B2_APPLICATION_KEY}`
    ).toString("base64");


  const response =
    await fetch(
      "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
      {
        method: "GET",

        headers: {
          Authorization:
            `Basic ${credentials}`
        }
      }
    );


  if (!response.ok) {

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


/* ================================================================
   B2 GET UPLOAD URL
================================================================ */

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
        method: "GET",

        headers: {
          Authorization:
            authorizationToken
        }
      }
    );


  if (!response.ok) {

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


/* ================================================================
   B2 FILENAME
================================================================ */

function encodeB2Filename(filename) {

  return encodeURIComponent(filename)
    .replace(/%2F/gi, "/");

}


/* ================================================================
   B2 NORMAL UPLOAD
================================================================ */

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
        method: "POST",

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


  if (!response.ok) {

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


/* ================================================================
   MAIN
================================================================ */

async function main() {

  const tempFilename =
    path.join(
      process.cwd(),
      `candidate-${CANDIDATE_ID}.mp4`
    );


  try {

    console.log(
      `Loading candidate ${CANDIDATE_ID}...`
    );


    const {
      data: candidate,
      error
    } =
      await supabase
        .from("zulu_candidates")
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


    if (error) {
      throw error;
    }


    if (!candidate) {
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


    if (!candidate.media_url) {

      throw new Error(
        "Candidate has no resolved media URL."
      );

    }


    console.log(
      `Title: ${candidate.title}`
    );

    console.log(
      `Media: ${candidate.media_url}`
    );


    /* ------------------------------------------------------------
       DOWNLOAD
    ------------------------------------------------------------ */

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


    if (!downloadResponse.ok) {

      throw new Error(
        `Download failed: HTTP ${downloadResponse.status}`
      );

    }


    if (!downloadResponse.body) {

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
      ) !== stat.size
    ) {

      throw new Error(
        `Downloaded size mismatch. Expected ${candidate.media_size_bytes}, received ${stat.size}.`
      );

    }


    /* ------------------------------------------------------------
       PROBE
    ------------------------------------------------------------ */

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


    /* ------------------------------------------------------------
       FINGERPRINT
    ------------------------------------------------------------ */

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


    /* ------------------------------------------------------------
       DUPLICATE CHECK
    ------------------------------------------------------------ */

    console.log(
      "Checking zulu_videos..."
    );


    const {
      data: duplicates,
      error: duplicateError
    } =
      await supabase
        .from("zulu_videos")
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


    if (duplicateError) {
      throw duplicateError;
    }


    if (
      duplicates &&
      duplicates.length > 0
    ) {

      console.log(
        "DUPLICATE FOUND"
      );

      console.log(
        duplicates[0]
      );

      console.log(
        "Stopping before upload."
      );

      return;

    }


    console.log(
      "NO DUPLICATE FOUND"
    );


    /* ------------------------------------------------------------
       SHA-1 REQUIRED BY B2
    ------------------------------------------------------------ */

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


    /* ------------------------------------------------------------
       CANONICAL PORNFLIX FILENAME
    ------------------------------------------------------------ */

    const remoteFilename =
      `${candidate.title}.mp4`;


    console.log(
      `Canonical filename: ${remoteFilename}`
    );


    /* ------------------------------------------------------------
       BACKBLAZE AUTH
    ------------------------------------------------------------ */

    const {
      apiUrl,
      authorizationToken
    } =
      await authorizeBackblaze();


    /* ------------------------------------------------------------
       GET UPLOAD URL
    ------------------------------------------------------------ */

    const {
      uploadUrl,
      authorizationToken:
        uploadAuthorizationToken
    } =
      await getB2UploadUrl(
        apiUrl,
        authorizationToken
      );


    /* ------------------------------------------------------------
       UPLOAD
    ------------------------------------------------------------ */

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


    console.log("");
    console.log(
      `Public URL: ${publicUrl}`
    );

    console.log("");
    console.log(
      "B2 TEST COMPLETE — VIDEO WAS UPLOADED."
    );

    console.log(
      "No zulu_videos record was created."
    );

    console.log(
      "Candidate import status was not changed."
    );


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


main().catch(error => {

  console.error(
    "TEST FAILED:"
  );

  console.error(
    error
  );

  process.exit(1);

});
