import { supabase } from "../supabaseClient.js";

import {
  sleep,
  formatBytes
} from "./utils.js";


const LARGE_FILE_THRESHOLD =
  500 * 1024 * 1024; // 500 MiB

const LARGE_FILE_PART_SIZE =
  100 * 1024 * 1024; // 100 MiB

const LARGE_FILE_MAX_RETRIES = 5;

const LARGE_FILE_RETRY_BASE_DELAY = 1500;



/* =================================================================================================================
   PUBLIC HELPERS
==================================================================================================================== */

export function isLargeFile(file) {
  return (
    file.size >=
    LARGE_FILE_THRESHOLD
  );
}


export function encodeB2Filename(filename) {
  return encodeURIComponent(filename)
    .replace(
      /[!'()*]/g,
      char =>
        "%" +
        char
          .charCodeAt(0)
          .toString(16)
          .toUpperCase()
    );
}


async function calculateBlobSha1(blob) {
  const buffer =
    await blob.arrayBuffer();

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-1",
      buffer
    );

  return [...new Uint8Array(hashBuffer)]
    .map(byte =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}


export async function calculateFileSha1(file) {
  return calculateBlobSha1(file);
}


/* =================================================================================================================
   SMALL FILE UPLOAD
==================================================================================================================== */

export function uploadFileToBackblaze({
  uploadUrl,
  authorizationToken,
  file,
  filename,
  sha1,
  onProgress
}) {
  return new Promise((resolve, reject) => {
    const xhr =
      new XMLHttpRequest();

    xhr.open(
      "POST",
      uploadUrl,
      true
    );

    xhr.setRequestHeader(
      "Authorization",
      authorizationToken
    );

    xhr.setRequestHeader(
      "X-Bz-File-Name",
      encodeB2Filename(filename)
    );

    xhr.setRequestHeader(
      "Content-Type",
      file.type ||
        "application/octet-stream"
    );

    xhr.setRequestHeader(
      "X-Bz-Content-Sha1",
      sha1
    );

    xhr.setRequestHeader(
      "X-Bz-Info-src_last_modified_millis",
      String(file.lastModified)
    );


    xhr.upload.addEventListener(
      "progress",
      event => {
        if (!event.lengthComputable) {
          return;
        }

        const percent =
          (event.loaded /
            event.total) *
          100;

        onProgress?.({
          percent,
          loaded: event.loaded,
          total: event.total,
          text:
            `${percent.toFixed(1)}% — ` +
            `${formatBytes(event.loaded)} / ` +
            `${formatBytes(event.total)}`
        });
      }
    );


    xhr.addEventListener(
      "load",
      () => {
        let response;

        try {
          response =
            JSON.parse(
              xhr.responseText
            );
        } catch {
          response = {
            raw: xhr.responseText
          };
        }

        if (
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          resolve(response);
        } else {
          reject(
            new Error(
              response?.message ||
              response?.code ||
              `Backblaze returned HTTP ${xhr.status}`
            )
          );
        }
      }
    );


    xhr.addEventListener(
      "error",
      () => {
        reject(
          new Error(
            "Network error while uploading to Backblaze."
          )
        );
      }
    );


    xhr.addEventListener(
      "abort",
      () => {
        reject(
          new Error(
            "Upload cancelled."
          )
        );
      }
    );


    xhr.send(file);
  });
}


/* =================================================================================================================
   LARGE FILE PART UPLOAD
==================================================================================================================== */

function uploadPartToBackblaze({
  uploadUrl,
  authorizationToken,
  blob,
  partNumber,
  sha1,
  bytesAlreadyUploaded,
  totalFileSize,
  onProgress
}) {
  return new Promise((resolve, reject) => {
    const xhr =
      new XMLHttpRequest();

    xhr.open(
      "POST",
      uploadUrl,
      true
    );

    xhr.setRequestHeader(
      "Authorization",
      authorizationToken
    );

    xhr.setRequestHeader(
      "X-Bz-Part-Number",
      String(partNumber)
    );

    xhr.setRequestHeader(
      "X-Bz-Content-Sha1",
      sha1
    );

    xhr.setRequestHeader(
      "Content-Type",
      "application/octet-stream"
    );


    xhr.upload.addEventListener(
      "progress",
      event => {
        if (!event.lengthComputable) {
          return;
        }

        const loaded =
          bytesAlreadyUploaded +
          event.loaded;

        const percent =
          totalFileSize > 0
            ? (
                loaded /
                totalFileSize
              ) * 100
            : 0;

        onProgress?.({
          percent,
          loaded,
          total: totalFileSize,
          text:
            `${percent.toFixed(1)}% — ` +
            `${formatBytes(loaded)} / ` +
            `${formatBytes(totalFileSize)}`
        });
      }
    );


    xhr.addEventListener(
      "load",
      () => {
        let response = {};

        try {
          response =
            JSON.parse(
              xhr.responseText
            );
        } catch {
          response = {
            raw: xhr.responseText
          };
        }

        if (
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          resolve(response);
          return;
        }

        const error =
          new Error(
            response?.message ||
            response?.code ||
            `Backblaze returned HTTP ${xhr.status}`
          );

        error.status =
          xhr.status;

        error.code =
          response?.code || null;

        error.response =
          response;

        reject(error);
      }
    );


    xhr.addEventListener(
      "error",
      () => {
        const error =
          new Error(
            `Network error uploading part ${partNumber}.`
          );

        error.networkError = true;

        reject(error);
      }
    );


    xhr.addEventListener(
      "abort",
      () => {
        const error =
          new Error(
            `Upload cancelled during part ${partNumber}.`
          );

        error.aborted = true;

        reject(error);
      }
    );


    xhr.send(blob);
  });
}


/* =================================================================================================================
   LARGE FILE AUTHORIZATION
==================================================================================================================== */

async function getFreshPartUploadAuthorization(
  fileId
) {
  const {
    data,
    error
  } = await supabase.functions.invoke(
    "zulu-upload-authorize",
    {
      body: {
        action: "get-part-url",
        fileId
      }
    }
  );

  if (error) {
    throw error;
  }

  if (
    !data?.uploadUrl ||
    !data?.authorizationToken
  ) {
    throw new Error(
      "Backblaze did not return part upload authorization."
    );
  }

  return data;
}


/* =================================================================================================================
   LARGE FILE RETRY LOGIC
==================================================================================================================== */

function shouldRetryPartUpload(error) {
  if (error?.aborted) {
    return false;
  }

  if (error?.networkError) {
    return true;
  }

  if (
    error?.status === 401 ||
    error?.status === 408 ||
    error?.status === 429
  ) {
    return true;
  }

  if (
    error?.status >= 500 &&
    error?.status <= 599
  ) {
    return true;
  }

  return false;
}


/* =================================================================================================================
   LARGE FILE ORCHESTRATION
==================================================================================================================== */

export async function uploadLargeFileToBackblaze(
  file,
  canonicalFilename,
  {
    onProgress,
    onStatus
  } = {}
) {

  onStatus?.(
    "Starting large-file upload…"
  );

  const {
    data: startData,
    error: startError
  } = await supabase.functions.invoke(
    "zulu-upload-authorize",
    {
      body: {
        action: "start-large",
        filename:
          canonicalFilename
      }
    }
  );

  if (startError) {
    throw startError;
  }

  if (!startData?.fileId) {
    throw new Error(
      "Backblaze did not return a large-file ID."
    );
  }

  const fileId =
    startData.fileId;

  const partSha1Array = [];

  const totalParts =
    Math.ceil(
      file.size /
      LARGE_FILE_PART_SIZE
    );

  let bytesUploaded = 0;


  for (
    let partIndex = 0;
    partIndex < totalParts;
    partIndex++
  ) {
    const partNumber =
      partIndex + 1;

    const start =
      partIndex *
      LARGE_FILE_PART_SIZE;

    const end =
      Math.min(
        start +
          LARGE_FILE_PART_SIZE,
        file.size
      );

    const blob =
      file.slice(start, end);


    onStatus?.(
      `Hashing part ${partNumber} of ${totalParts}…`
    );

    const sha1 =
      await calculateBlobSha1(blob);

    partSha1Array.push(sha1);


    let uploaded = false;
    let lastError = null;


    for (
      let attempt = 1;
      attempt <=
        LARGE_FILE_MAX_RETRIES;
      attempt++
    ) {
      try {
        const partAuth =
          await getFreshPartUploadAuthorization(
            fileId
          );

        if (attempt === 1) {
          onStatus?.(
            `Uploading part ${partNumber} of ${totalParts}…`
          );
        } else {
          onStatus?.(
            `Retrying part ${partNumber} of ${totalParts} — attempt ${attempt}/${LARGE_FILE_MAX_RETRIES}…`
          );
        }

        console.log(
          `Uploading part ${partNumber}/${totalParts}, attempt ${attempt}`
        );


        await uploadPartToBackblaze({
          uploadUrl:
            partAuth.uploadUrl,

          authorizationToken:
            partAuth.authorizationToken,

          blob,

          partNumber,

          sha1,

          bytesAlreadyUploaded:
            bytesUploaded,

          totalFileSize:
            file.size,

          onProgress
        });


        uploaded = true;

        break;

      } catch (error) {
        lastError = error;

        console.warn(
          `Part ${partNumber} attempt ${attempt} failed:`,
          error
        );


        if (
          !shouldRetryPartUpload(
            error
          )
        ) {
          throw error;
        }


        if (
          attempt ===
          LARGE_FILE_MAX_RETRIES
        ) {
          break;
        }


        const delay =
          LARGE_FILE_RETRY_BASE_DELAY *
          Math.pow(
            2,
            attempt - 1
          );

        onStatus?.(
          `Part ${partNumber} failed. Retrying in ${Math.round(
            delay / 1000
          )} seconds…`
        );

        await sleep(delay);
      }
    }


    if (!uploaded) {
      throw new Error(
        `Part ${partNumber} failed after ${LARGE_FILE_MAX_RETRIES} attempts: ${
          lastError?.message ||
          "unknown error"
        }`
      );
    }


    bytesUploaded +=
      blob.size;

    const percent =
      (
        bytesUploaded /
        file.size
      ) * 100;

    onProgress?.({
      percent,
      loaded: bytesUploaded,
      total: file.size,
      text:
        `${percent.toFixed(1)}% — ` +
        `${formatBytes(bytesUploaded)} / ` +
        `${formatBytes(file.size)}`
    });
  }


  onStatus?.(
    "Finalizing large file…"
  );

  const {
    data: finishData,
    error: finishError
  } = await supabase.functions.invoke(
    "zulu-upload-authorize",
    {
      body: {
        action:
          "finish-large",

        fileId,

        partSha1Array
      }
    }
  );

  if (finishError) {
    throw finishError;
  }

  if (!finishData?.success) {
    throw new Error(
      finishData?.error ||
      "Backblaze could not finalize the large file."
    );
  }


  onProgress?.({
    percent: 100,
    loaded: file.size,
    total: file.size,
    text:
      `100.0% — ` +
      `${formatBytes(file.size)} / ` +
      `${formatBytes(file.size)}`
  });

  onStatus?.(
    "Large-file upload complete."
  );

  return finishData;
}
