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

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error(
    "Missing Supabase environment variables."
  );
}

const supabase =
  createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  );


function sha256Buffer(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}


async function calculateCompatibleFingerprint(
  filename
) {

  const stat =
    await fsp.stat(filename);

  const fileSize =
    stat.size;

  const sampleSize =
    4 * 1024 * 1024;

  const middleStart =
    Math.max(
      0,
      Math.floor(
        fileSize / 2 -
        sampleSize / 2
      )
    );

  const lastStart =
    Math.max(
      0,
      fileSize - sampleSize
    );

  const handle =
    await fsp.open(
      filename,
      "r"
    );

  try {

    async function readChunk(
      start,
      length
    ) {

      const actualLength =
        Math.min(
          length,
          fileSize - start
        );

      const buffer =
        Buffer.alloc(
          actualLength
        );

      await handle.read(
        buffer,
        0,
        actualLength,
        start
      );

      return buffer;
    }


    const firstChunk =
      await readChunk(
        0,
        Math.min(
          sampleSize,
          fileSize
        )
      );

    const middleChunk =
      await readChunk(
        middleStart,
        sampleSize
      );

    const lastChunk =
      await readChunk(
        lastStart,
        sampleSize
      );


    const firstSha256 =
      sha256Buffer(
        firstChunk
      );

    const middleSha256 =
      sha256Buffer(
        middleChunk
      );

    const lastSha256 =
      sha256Buffer(
        lastChunk
      );


    const fingerprintSource =
      [
        fileSize,
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


async function probeVideo(
  filename
) {

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
    JSON.parse(
      stdout
    );

  const video =
    result.streams?.[0];

  return {
    durationSeconds:
      Number(
        result.format?.duration
      ),

    width:
      Number(
        video?.width
      ),

    height:
      Number(
        video?.height
      )
  };
}


async function main() {

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


  if (error) {
    throw error;
  }


  if (
    candidate.status !==
      "accepted"
  ) {
    throw new Error(
      "Candidate is not accepted."
    );
  }


  if (
    !candidate.media_url
  ) {
    throw new Error(
      "Candidate has no resolved media URL."
    );
  }


  console.log(
    "Title:",
    candidate.title
  );

  console.log(
    "Media:",
    candidate.media_url
  );


  const tempFile =
    path.join(
      process.cwd(),
      `candidate-${candidate.id}.mp4`
    );


  console.log(
    "Downloading MP4..."
  );


  const response =
    await fetch(
      candidate.media_url,
      {
        redirect:
          "follow",

        headers: {
          "User-Agent":
            "Mozilla/5.0"
        }
      }
    );


  if (!response.ok) {
    throw new Error(
      `Download failed: HTTP ${response.status}`
    );
  }


  await pipeline(
    Readable.fromWeb(
      response.body
    ),
    fs.createWriteStream(
      tempFile
    )
  );


  try {

    const stat =
      await fsp.stat(
        tempFile
      );


    console.log(
      "Downloaded bytes:",
      stat.size
    );


    if (
      candidate.media_size_bytes &&
      Number(
        candidate.media_size_bytes
      ) !==
        stat.size
    ) {

      throw new Error(
        `Downloaded size mismatch. ` +
        `Expected ${candidate.media_size_bytes}, ` +
        `received ${stat.size}.`
      );
    }


    console.log(
      "Running ffprobe..."
    );


    const metadata =
      await probeVideo(
        tempFile
      );


    console.log(
      "Duration:",
      metadata.durationSeconds
    );

    console.log(
      "Dimensions:",
      `${metadata.width}x${metadata.height}`
    );


    console.log(
      "Calculating Pornflix-compatible fingerprint..."
    );


    const fingerprint =
      await calculateCompatibleFingerprint(
        tempFile
      );


    console.log(
      "Fingerprint:",
      fingerprint
    );


    console.log(
      "Checking zulu_videos..."
    );


    const {
      data: duplicates,
      error: duplicateError
    } =
      await supabase
        .from(
          "zulu_videos"
        )
        .select(
          "uid, film, fingerprint"
        )
        .eq(
          "fingerprint",
          fingerprint
        )
        .limit(1);


    if (duplicateError) {
      throw duplicateError;
    }


    if (
      duplicates?.length
    ) {

      console.log(
        "DUPLICATE FOUND"
      );

      console.log(
        duplicates[0]
      );

    } else {

      console.log(
        "NO DUPLICATE FOUND"
      );
    }


    console.log("");
    console.log(
      "TEST COMPLETE — NOTHING UPLOADED."
    );

  } finally {

    await fsp.rm(
      tempFile,
      {
        force:
          true
      }
    );
  }
}


main().catch(error => {

  console.error(
    "TEST FAILED:",
    error
  );

  process.exit(1);
});
