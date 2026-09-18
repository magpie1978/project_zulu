import { supabase } from "../supabaseClient.js";

import {
  sleep,
  formatBytes
} from "./utils.js";


/* =====================================================================
   UPLOAD.JS
   =====================================================================

   PURPOSE
   -------

   This module contains the low-level Backblaze B2 upload logic used by
   the Zulu Videos ingestion system.

   It supports two upload strategies:


   1. STANDARD UPLOAD

      Used for files smaller than 500 MiB.

      The complete file is:

          - SHA-1 hashed;
          - uploaded in a single Backblaze request;
          - monitored using XMLHttpRequest upload progress events.


   2. LARGE / MULTIPART UPLOAD

      Used for files of 500 MiB or larger.

      The file is divided into 100 MiB parts.

      Each part is:

          - SHA-1 hashed independently;
          - given fresh Backblaze upload authorisation;
          - uploaded sequentially;
          - retried automatically for temporary failures.

      Once every part has uploaded successfully, the array of part
      SHA-1 hashes is sent to Backblaze to finalise the large file.


   SECURITY
   --------

   Permanent Backblaze credentials are not stored in this browser
   module.

   Server-side Backblaze operations are delegated to the Supabase Edge
   Function:

       zulu-upload-authorize

   Depending on the requested action, that Edge Function can:

       - authorise a normal upload;
       - start a large-file upload;
       - provide a part-upload URL/token;
       - finish a large-file upload.


   RELATED MODULES
   ---------------

   add-video.js

       Uses:

           isLargeFile()
           encodeB2Filename()
           calculateFileSha1()
           uploadFileToBackblaze()
           uploadLargeFileToBackblaze()

       to upload MP4 files.


   thumbnails.js

       Uses:

           calculateFileSha1()
           uploadFileToBackblaze()

       to publish generated PNG thumbnails.


   utils.js

       Provides:

           sleep()
               Used by multipart retry backoff.

           formatBytes()
               Used in upload progress messages.

   ===================================================================== */


/* =====================================================================
   01. UPLOAD CONFIGURATION
   =====================================================================

   LARGE_FILE_THRESHOLD
       Files at or above this size use Backblaze's multipart upload
       process.

       500 MiB.


   LARGE_FILE_PART_SIZE
       Size of each multipart chunk.

       100 MiB.


   LARGE_FILE_MAX_RETRIES
       Maximum number of attempts allowed for each individual part.

       This includes the initial attempt.


   LARGE_FILE_RETRY_BASE_DELAY
       Starting retry delay in milliseconds.

       Exponential backoff is applied:

           attempt 1 failure → 1.5 seconds
           attempt 2 failure → 3 seconds
           attempt 3 failure → 6 seconds
           attempt 4 failure → 12 seconds

       The fifth attempt is the final attempt and is not followed by
       another retry.
===================================================================== */

const LARGE_FILE_THRESHOLD =
  500 * 1024 * 1024; // 500 MiB


const LARGE_FILE_PART_SIZE =
  100 * 1024 * 1024; // 100 MiB


const LARGE_FILE_MAX_RETRIES =
  5;


const LARGE_FILE_RETRY_BASE_DELAY =
  1500;


/* =====================================================================
   02. PUBLIC FILE HELPERS
===================================================================== */

/**
 * Determines whether a file should use the multipart upload system.
 *
 * Files of exactly 500 MiB are considered large.
 *
 * @param {File|Blob} file
 * @returns {boolean}
 */
export function isLargeFile(file) {

  return (
    file.size >=
    LARGE_FILE_THRESHOLD
  );
}


/**
 * Encodes a filename for use in Backblaze's X-Bz-File-Name header and
 * in public B2/media URLs.
 *
 * encodeURIComponent() handles the majority of URL-sensitive
 * characters.
 *
 * The additional replacement ensures these characters are also
 * percent-encoded:
 *
 *     ! ' ( ) *
 *
 * Example:
 *
 *     Actor's Film (2026).mp4
 *
 * becomes an appropriately percent-encoded Backblaze filename.
 *
 * @param {string} filename
 * @returns {string}
 */
export function encodeB2Filename(
  filename
) {

  return encodeURIComponent(
    filename
  )
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


/* =====================================================================
   03. SHA-1 HASHING
   =====================================================================

   Backblaze uses SHA-1 checksums to verify uploaded content.

   Standard uploads hash the complete file.

   Multipart uploads calculate a separate SHA-1 for every part and send
   the ordered list of hashes when the large file is finalised.
===================================================================== */

/**
 * Calculates the SHA-1 digest of a Blob.
 *
 * The Blob is read into memory as an ArrayBuffer and hashed using the
 * browser Web Crypto API.
 *
 * The resulting binary digest is converted to a lowercase hexadecimal
 * string.
 *
 * This private helper is used for both:
 *
 *   - complete-file hashes;
 *   - individual multipart hashes.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function calculateBlobSha1(
  blob
) {

  const buffer =
    await blob.arrayBuffer();


  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-1",
      buffer
    );


  return [
    ...new Uint8Array(
      hashBuffer
    )
  ]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0"
          )
    )
    .join("");
}


/**
 * Public wrapper for calculating the SHA-1 hash of a complete file.
 *
 * Used by:
 *
 *   add-video.js
 *       Before standard MP4 uploads.
 *
 *   thumbnails.js
 *       Before PNG thumbnail uploads.
 *
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export async function calculateFileSha1(
  file
) {

  return calculateBlobSha1(
    file
  );
}


/* =====================================================================
   04. STANDARD BACKBLAZE UPLOAD
   =====================================================================

   Used for:

       - MP4 files below 500 MiB;
       - generated PNG thumbnails.

   XMLHttpRequest is used instead of fetch() because XHR exposes
   upload-progress events.
===================================================================== */

/**
 * Uploads one complete file to a Backblaze upload URL.
 *
 * The caller must already have:
 *
 *   - a Backblaze upload URL;
 *   - a temporary authorisation token;
 *   - the SHA-1 hash of the file.
 *
 * Required Backblaze headers are added here.
 *
 * Upload progress is reported through the optional onProgress callback.
 *
 * @param {Object} options
 *
 * @param {string} options.uploadUrl
 *        Temporary Backblaze upload URL.
 *
 * @param {string} options.authorizationToken
 *        Temporary Backblaze upload token.
 *
 * @param {File|Blob} options.file
 *        File/blob being uploaded.
 *
 * @param {string} options.filename
 *        Destination filename in Backblaze.
 *
 * @param {string} options.sha1
 *        SHA-1 hash of the complete file.
 *
 * @param {Function} [options.onProgress]
 *        Optional progress callback.
 *
 * @returns {Promise<Object>}
 *        Parsed Backblaze response.
 */
export function uploadFileToBackblaze({
  uploadUrl,
  authorizationToken,
  file,
  filename,
  sha1,
  onProgress
}) {

  return new Promise(
    (resolve, reject) => {

      const xhr =
        new XMLHttpRequest();


      xhr.open(
        "POST",
        uploadUrl,
        true
      );


      /* -------------------------------------------------------------
         BACKBLAZE REQUEST HEADERS
      ------------------------------------------------------------- */

      xhr.setRequestHeader(
        "Authorization",
        authorizationToken
      );


      xhr.setRequestHeader(
        "X-Bz-File-Name",
        encodeB2Filename(
          filename
        )
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


      /*
       * Preserve the local file's last-modified timestamp as Backblaze
       * file metadata.
       *
       * Blob objects such as generated thumbnails may not have a
       * lastModified value; this preserves the existing behaviour.
       */
      xhr.setRequestHeader(
        "X-Bz-Info-src_last_modified_millis",
        String(
          file.lastModified
        )
      );


      /* -------------------------------------------------------------
         UPLOAD PROGRESS
      ------------------------------------------------------------- */

      xhr.upload.addEventListener(
        "progress",
        event => {

          if (
            !event.lengthComputable
          ) {
            return;
          }


          const percent =
            (
              event.loaded /
              event.total
            ) *
            100;


          onProgress?.({
            percent,

            loaded:
              event.loaded,

            total:
              event.total,

            text:
              `${percent.toFixed(1)}% — ` +
              `${formatBytes(event.loaded)} / ` +
              `${formatBytes(event.total)}`
          });
        }
      );


      /* -------------------------------------------------------------
         BACKBLAZE RESPONSE
      ------------------------------------------------------------- */

      xhr.addEventListener(
        "load",
        () => {

          let response;


          /*
           * Backblaze normally returns JSON, but retain the raw body if
           * parsing fails so error information is not discarded.
           */
          try {

            response =
              JSON.parse(
                xhr.responseText
              );

          } catch {

            response = {
              raw:
                xhr.responseText
            };
          }


          if (
            xhr.status >= 200 &&
            xhr.status < 300
          ) {

            resolve(
              response
            );

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


      /* -------------------------------------------------------------
         NETWORK FAILURE
      ------------------------------------------------------------- */

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


      /* -------------------------------------------------------------
         UPLOAD ABORTED
      ------------------------------------------------------------- */

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


      /* -------------------------------------------------------------
         SEND FILE
      ------------------------------------------------------------- */

      xhr.send(
        file
      );
    }
  );
}


/* =====================================================================
   05. MULTIPART PART UPLOAD
   =====================================================================

   This is the low-level equivalent of uploadFileToBackblaze() for one
   part of a Backblaze large-file upload.

   It is deliberately private because callers should normally use:

       uploadLargeFileToBackblaze()

   rather than manage multipart state themselves.
===================================================================== */

/**
 * Uploads one part of a Backblaze large-file upload.
 *
 * Progress from the individual part is translated into progress for
 * the COMPLETE file using:
 *
 *     bytesAlreadyUploaded + currentPartBytesUploaded
 *
 * This allows the Add Video interface to show one continuous progress
 * percentage across all parts.
 *
 * Errors are enriched with properties used by the retry system:
 *
 *     status
 *     code
 *     response
 *     networkError
 *     aborted
 *
 * @param {Object} options
 *
 * @param {string} options.uploadUrl
 * @param {string} options.authorizationToken
 * @param {Blob} options.blob
 * @param {number} options.partNumber
 * @param {string} options.sha1
 * @param {number} options.bytesAlreadyUploaded
 * @param {number} options.totalFileSize
 * @param {Function} [options.onProgress]
 *
 * @returns {Promise<Object>}
 */
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

  return new Promise(
    (resolve, reject) => {

      const xhr =
        new XMLHttpRequest();


      xhr.open(
        "POST",
        uploadUrl,
        true
      );


      /* -------------------------------------------------------------
         BACKBLAZE PART HEADERS
      ------------------------------------------------------------- */

      xhr.setRequestHeader(
        "Authorization",
        authorizationToken
      );


      xhr.setRequestHeader(
        "X-Bz-Part-Number",
        String(
          partNumber
        )
      );


      xhr.setRequestHeader(
        "X-Bz-Content-Sha1",
        sha1
      );


      xhr.setRequestHeader(
        "Content-Type",
        "application/octet-stream"
      );


      /* -------------------------------------------------------------
         WHOLE-FILE PROGRESS
      ------------------------------------------------------------- */

      xhr.upload.addEventListener(
        "progress",
        event => {

          if (
            !event.lengthComputable
          ) {
            return;
          }


          /*
           * Combine bytes from completed parts with bytes transferred
           * from the currently active part.
           */
          const loaded =
            bytesAlreadyUploaded +
            event.loaded;


          const percent =
            totalFileSize > 0
              ? (
                  loaded /
                  totalFileSize
                ) *
                100
              : 0;


          onProgress?.({
            percent,
            loaded,

            total:
              totalFileSize,

            text:
              `${percent.toFixed(1)}% — ` +
              `${formatBytes(loaded)} / ` +
              `${formatBytes(totalFileSize)}`
          });
        }
      );


      /* -------------------------------------------------------------
         BACKBLAZE RESPONSE
      ------------------------------------------------------------- */

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
              raw:
                xhr.responseText
            };
          }


          if (
            xhr.status >= 200 &&
            xhr.status < 300
          ) {

            resolve(
              response
            );

            return;
          }


          /*
           * Preserve HTTP information on the Error object so
           * shouldRetryPartUpload() can decide whether this particular
           * failure is temporary/retryable.
           */
          const error =
            new Error(
              response?.message ||
              response?.code ||
              `Backblaze returned HTTP ${xhr.status}`
            );


          error.status =
            xhr.status;

          error.code =
            response?.code ||
            null;

          error.response =
            response;


          reject(
            error
          );
        }
      );


      /* -------------------------------------------------------------
         NETWORK FAILURE
      ------------------------------------------------------------- */

      xhr.addEventListener(
        "error",
        () => {

          const error =
            new Error(
              `Network error uploading part ${partNumber}.`
            );


          /*
           * Custom flag consumed by shouldRetryPartUpload().
           */
          error.networkError =
            true;


          reject(
            error
          );
        }
      );


      /* -------------------------------------------------------------
         UPLOAD ABORTED
      ------------------------------------------------------------- */

      xhr.addEventListener(
        "abort",
        () => {

          const error =
            new Error(
              `Upload cancelled during part ${partNumber}.`
            );


          /*
           * Aborted uploads are explicitly NOT retried.
           */
          error.aborted =
            true;


          reject(
            error
          );
        }
      );


      /* -------------------------------------------------------------
         SEND PART
      ------------------------------------------------------------- */

      xhr.send(
        blob
      );
    }
  );
}


/* =====================================================================
   06. MULTIPART UPLOAD AUTHORISATION
===================================================================== */

/**
 * Requests a fresh Backblaze upload URL and authorisation token for a
 * large-file part.
 *
 * A fresh part authorisation is requested for every attempt rather than
 * permanently reusing the previous token.
 *
 * This is particularly useful when retrying after authentication or
 * temporary Backblaze failures.
 *
 * @param {string} fileId
 *        Backblaze large-file ID.
 *
 * @returns {Promise<Object>}
 *        Object containing uploadUrl and authorizationToken.
 */
async function getFreshPartUploadAuthorization(
  fileId
) {

  const {
    data,
    error
  } =
    await supabase
      .functions
      .invoke(
        "zulu-upload-authorize",
        {
          body: {
            action:
              "get-part-url",

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


/* =====================================================================
   07. MULTIPART RETRY POLICY
   =====================================================================

   Multipart uploads can fail temporarily because of network issues,
   expired authorisation, throttling or Backblaze server errors.

   Only failures likely to be temporary are retried.

   Retryable:

       network errors
       HTTP 401
       HTTP 408
       HTTP 429
       HTTP 5xx

   Not retryable:

       explicit upload abort
       other HTTP 4xx responses
       other unexpected failures
===================================================================== */

/**
 * Determines whether a failed multipart upload attempt should be
 * retried.
 *
 * @param {Error} error
 * @returns {boolean}
 */
function shouldRetryPartUpload(
  error
) {

  /* -----------------------------------------------------------------
     USER / PROGRAMMATIC ABORT
  ----------------------------------------------------------------- */

  if (
    error?.aborted
  ) {

    return false;
  }


  /* -----------------------------------------------------------------
     NETWORK FAILURE
  ----------------------------------------------------------------- */

  if (
    error?.networkError
  ) {

    return true;
  }


  /* -----------------------------------------------------------------
     SELECTED TEMPORARY HTTP FAILURES
  ----------------------------------------------------------------- */

  if (
    error?.status === 401 ||
    error?.status === 408 ||
    error?.status === 429
  ) {

    return true;
  }


  /* -----------------------------------------------------------------
     BACKBLAZE / SERVER ERRORS
  ----------------------------------------------------------------- */

  if (
    error?.status >= 500 &&
    error?.status <= 599
  ) {

    return true;
  }


  return false;
}


/* =====================================================================
   08. LARGE-FILE UPLOAD ORCHESTRATION
   =====================================================================

   This is the public entry point for multipart MP4 uploads.

   Complete workflow:

       Start Backblaze large file
                 ↓
       Receive fileId
                 ↓
       Divide local file into 100 MiB parts
                 ↓
       For each part:
           calculate SHA-1
                 ↓
           request fresh upload URL/token
                 ↓
           upload part
                 ↓
           if temporary failure:
               exponential backoff
                 ↓
               request fresh authorisation
                 ↓
               retry
                 ↓
       Store SHA-1 of every successful part
                 ↓
       Send ordered SHA-1 array to finish-large
                 ↓
       Backblaze finalises complete file
===================================================================== */

/**
 * Uploads a large file using Backblaze's multipart upload process.
 *
 * Files are divided into 100 MiB parts and uploaded sequentially.
 *
 * Each part can be attempted up to LARGE_FILE_MAX_RETRIES times.
 *
 * Retry delays use exponential backoff:
 *
 *     baseDelay × 2^(attempt - 1)
 *
 * With the current 1,500 ms base:
 *
 *     1.5s
 *     3s
 *     6s
 *     12s
 *
 * A fresh Backblaze part-upload URL/token is requested for every
 * attempt.
 *
 * @param {File} file
 *        Complete local video file.
 *
 * @param {string} canonicalFilename
 *        Final filename to create in Backblaze.
 *
 * @param {Object} options
 *
 * @param {Function} [options.onProgress]
 *        Receives continuous whole-file upload progress.
 *
 * @param {Function} [options.onStatus]
 *        Receives human-readable workflow status messages.
 *
 * @returns {Promise<Object>}
 *        Response from the finish-large operation.
 */
export async function uploadLargeFileToBackblaze(
  file,
  canonicalFilename,
  {
    onProgress,
    onStatus
  } = {}
) {

  /* =================================================================
     STEP 1: START LARGE FILE
  ================================================================= */

  onStatus?.(
    "Starting large-file upload…"
  );


  const {
    data: startData,
    error: startError
  } =
    await supabase
      .functions
      .invoke(
        "zulu-upload-authorize",
        {
          body: {
            action:
              "start-large",

            filename:
              canonicalFilename
          }
        }
      );


  if (startError) {
    throw startError;
  }


  if (
    !startData?.fileId
  ) {

    throw new Error(
      "Backblaze did not return a large-file ID."
    );
  }


  const fileId =
    startData.fileId;


  /*
   * Backblaze requires the ordered SHA-1 of every part when the large
   * file is finalised.
   */
  const partSha1Array = [];


  /* =================================================================
     STEP 2: CALCULATE NUMBER OF PARTS
  ================================================================= */

  const totalParts =
    Math.ceil(
      file.size /
      LARGE_FILE_PART_SIZE
    );


  /*
   * Tracks only FULLY COMPLETED parts.
   *
   * uploadPartToBackblaze() combines this value with progress from the
   * active part to calculate whole-file progress.
   */
  let bytesUploaded =
    0;


  /* =================================================================
     STEP 3: PROCESS EACH PART
  ================================================================= */

  for (
    let partIndex = 0;
    partIndex < totalParts;
    partIndex++
  ) {

    const partNumber =
      partIndex + 1;


    /* ---------------------------------------------------------------
       CALCULATE PART BYTE RANGE
    --------------------------------------------------------------- */

    const start =
      partIndex *
      LARGE_FILE_PART_SIZE;


    const end =
      Math.min(
        start +
        LARGE_FILE_PART_SIZE,
        file.size
      );


    /*
     * file.slice() creates the Blob representing this part without
     * modifying the original File.
     */
    const blob =
      file.slice(
        start,
        end
      );


    /* ---------------------------------------------------------------
       HASH PART
    --------------------------------------------------------------- */

    onStatus?.(
      `Hashing part ${partNumber} of ${totalParts}…`
    );


    const sha1 =
      await calculateBlobSha1(
        blob
      );


    /*
     * Preserve hashes in part-number order for finish-large.
     */
    partSha1Array.push(
      sha1
    );


    /* ---------------------------------------------------------------
       PREPARE RETRY LOOP
    --------------------------------------------------------------- */

    let uploaded =
      false;

    let lastError =
      null;


    /* ===============================================================
       STEP 4: ATTEMPT PART UPLOAD
    =============================================================== */

    for (
      let attempt = 1;
      attempt <= LARGE_FILE_MAX_RETRIES;
      attempt++
    ) {

      try {

        /* -----------------------------------------------------------
           GET FRESH PART AUTHORISATION
        ----------------------------------------------------------- */

        const partAuth =
          await getFreshPartUploadAuthorization(
            fileId
          );


        /* -----------------------------------------------------------
           UPDATE STATUS
        ----------------------------------------------------------- */

        if (
          attempt === 1
        ) {

          onStatus?.(
            `Uploading part ${partNumber} of ${totalParts}…`
          );

        } else {

          onStatus?.(
            `Retrying part ${partNumber} of ${totalParts} — ` +
            `attempt ${attempt}/${LARGE_FILE_MAX_RETRIES}…`
          );
        }


        console.log(
          `Uploading part ${partNumber}/${totalParts}, attempt ${attempt}`
        );


        /* -----------------------------------------------------------
           UPLOAD PART
        ----------------------------------------------------------- */

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


        /*
         * Successful upload exits the retry loop.
         */
        uploaded =
          true;


        break;

      } catch (error) {

        /* -----------------------------------------------------------
           HANDLE FAILED ATTEMPT
        ----------------------------------------------------------- */

        lastError =
          error;


        console.warn(
          `Part ${partNumber} attempt ${attempt} failed:`,
          error
        );


        /*
         * Permanent/non-retryable failures are surfaced immediately.
         */
        if (
          !shouldRetryPartUpload(
            error
          )
        ) {

          throw error;
        }


        /*
         * The final permitted attempt has already failed.
         */
        if (
          attempt ===
          LARGE_FILE_MAX_RETRIES
        ) {

          break;
        }


        /* -----------------------------------------------------------
           EXPONENTIAL BACKOFF
        ----------------------------------------------------------- */

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


        await sleep(
          delay
        );
      }
    }


    /* ===============================================================
       STEP 5: VERIFY PART SUCCEEDED
    =============================================================== */

    if (!uploaded) {

      throw new Error(
        `Part ${partNumber} failed after ` +
        `${LARGE_FILE_MAX_RETRIES} attempts: ` +
        `${
          lastError?.message ||
          "unknown error"
        }`
      );
    }


    /* ===============================================================
       STEP 6: COMMIT PART PROGRESS
    =============================================================== */

    /*
     * Only increment bytesUploaded after Backblaze has confirmed the
     * complete part.
     */
    bytesUploaded +=
      blob.size;


    const percent =
      (
        bytesUploaded /
        file.size
      ) *
      100;


    /*
     * Explicitly report completed-part progress as well as the XHR
     * progress events generated while a part is uploading.
     */
    onProgress?.({
      percent,

      loaded:
        bytesUploaded,

      total:
        file.size,

      text:
        `${percent.toFixed(1)}% — ` +
        `${formatBytes(bytesUploaded)} / ` +
        `${formatBytes(file.size)}`
    });
  }


  /* =================================================================
     STEP 7: FINALISE LARGE FILE
     =================================================================

     Every part has now been successfully uploaded.

     Send Backblaze the ordered array of part SHA-1 hashes so it can
     assemble/finalise the complete object.
  ================================================================= */

  onStatus?.(
    "Finalizing large file…"
  );


  const {
    data: finishData,
    error: finishError
  } =
    await supabase
      .functions
      .invoke(
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


  if (
    !finishData?.success
  ) {

    throw new Error(
      finishData?.error ||
      "Backblaze could not finalize the large file."
    );
  }


  /* =================================================================
     STEP 8: REPORT COMPLETION
  ================================================================= */

  onProgress?.({
    percent:
      100,

    loaded:
      file.size,

    total:
      file.size,

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
