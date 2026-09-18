/* =====================================================================
   UTILS.JS
   =====================================================================

   PURPOSE
   -------

   Shared utility functions used throughout the Zulu Videos frontend.

   This module contains small, reusable helpers that are not specific
   to any one feature or interface.

   Current utilities:

       sleep()
           Pause asynchronous execution for a specified time.

       formatVideoQuality()
           Convert video dimensions into a display quality such as
           "1080p".

       formatVideoDuration()
           Convert seconds into a readable duration such as "42:15"
           or "1:12:34".

       formatBytes()
           Convert byte counts into readable file sizes such as
           "842.3 MB" or "1.4 GB".

       escapeHTML()
           Escape user/database text before inserting it into generated
           HTML.

   ===================================================================== */


/* =====================================================================
   01. ASYNC HELPERS
===================================================================== */

/**
 * Waits for a specified number of milliseconds.
 *
 * Primarily used by upload.js to pause between multipart upload retry
 * attempts.
 *
 * Example:
 *
 *     await sleep(1500);
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(
  ms
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}


/* =====================================================================
   02. VIDEO FORMATTING
===================================================================== */

/**
 * Converts video dimensions into a simple vertical-resolution label.
 *
 * Examples:
 *
 *     1920 × 1080 → "1080p"
 *     1280 × 720  → "720p"
 *
 * Both width and height must be available. If either value is missing
 * or zero, an empty string is returned so the catalogue can omit the
 * quality value cleanly.
 *
 * @param {number|string} width
 * @param {number|string} height
 * @returns {string}
 */
export function formatVideoQuality(
  width,
  height
) {

  const w =
    Number(
      width || 0
    );

  const h =
    Number(
      height || 0
    );


  if (
    !w ||
    !h
  ) {
    return "";
  }


  return `${h}p`;
}


/**
 * Converts a duration in seconds into a readable time string.
 *
 * Durations below one hour:
 *
 *     65 seconds
 *         → "1:05"
 *
 *     754 seconds
 *         → "12:34"
 *
 * Durations of one hour or more:
 *
 *     4354 seconds
 *         → "1:12:34"
 *
 * Invalid, missing or zero durations return an empty string.
 *
 * @param {number|string} seconds
 * @returns {string}
 */
export function formatVideoDuration(
  seconds
) {

  const totalSeconds =
    Math.round(
      Number(
        seconds || 0
      )
    );


  if (!totalSeconds) {
    return "";
  }


  const hours =
    Math.floor(
      totalSeconds /
      3600
    );


  const minutes =
    Math.floor(
      (
        totalSeconds %
        3600
      ) /
      60
    );


  const secs =
    totalSeconds %
    60;


  /*
   * Include the hours component only when required.
   */
  if (
    hours > 0
  ) {

    return [
      hours,

      String(
        minutes
      ).padStart(
        2,
        "0"
      ),

      String(
        secs
      ).padStart(
        2,
        "0"
      )
    ].join(":");
  }


  return [
    minutes,

    String(
      secs
    ).padStart(
      2,
      "0"
    )
  ].join(":");
}


/* =====================================================================
   03. FILE-SIZE FORMATTING
===================================================================== */

/**
 * Converts a byte count into a human-readable file size.
 *
 * Uses powers of 1024:
 *
 *     B
 *     KB
 *     MB
 *     GB
 *     TB
 *
 * Examples:
 *
 *     1024
 *         → "1.0 KB"
 *
 *     1048576
 *         → "1.0 MB"
 *
 *     1073741824
 *         → "1.0 GB"
 *
 * Values are displayed to one decimal place.
 *
 * Missing or zero values return "0 B".
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(
  bytes
) {

  if (!bytes) {
    return "0 B";
  }


  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];


  let value =
    bytes;

  let unit =
    0;


  /*
   * Repeatedly divide by 1024 until the value fits the most appropriate
   * unit, stopping at TB.
   */
  while (
    value >= 1024 &&
    unit < units.length - 1
  ) {

    value /=
      1024;

    unit++;
  }


  return `${value.toFixed(1)} ${units[unit]}`;
}


/* =====================================================================
   04. HTML SAFETY
===================================================================== */

/**
 * Escapes characters with special meaning in HTML.
 *
 * This should be used whenever text originating from a database, file
 * name or user input is inserted into an HTML string.
 *
 * Escaped characters:
 *
 *     &  → &amp;
 *     <  → &lt;
 *     >  → &gt;
 *     "  → &quot;
 *     '  → &#039;
 *
 * null and undefined are converted to an empty string.
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeHTML(
  value
) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}
