/*
 * ============================================================
 * RESOLVE CANDIDATE MEDIA
 * ============================================================
 *
 * PURPOSE
 * -------
 * This script takes candidate videos that have already been:
 *
 *     1. discovered by one of the scrapers
 *     2. saved into the zulu_candidates table
 *     3. reviewed
 *     4. marked as "accepted"
 *
 * and attempts to discover the ACTUAL MP4 file belonging to
 * each candidate.
 *
 * A candidate initially has a normal web-page address such as:
 *
 *     https://example.com/video/some-video/
 *
 * That is NOT the actual video file.
 *
 * This script visits that page, examines its HTML and finds the
 * MP4 file being used by the page's main video player.
 *
 * It then tries to discover some basic information about the
 * MP4:
 *
 *     • direct media URL
 *     • filename
 *     • file size
 *     • Content-Type
 *
 * Finally, that information is saved back into the existing
 * record in the Supabase "zulu_candidates" table.
 *
 *
 * IMPORTANT
 * ---------
 * This script does NOT import the video into the main Pornflix
 * collection.
 *
 * Its job is to RESOLVE the candidate — i.e. turn a normal
 * source-page URL into information about the actual media file
 * that a later import process can use.
 * ============================================================
 */


/* ------------------------------------------------------------
   LOAD REQUIRED NODE.JS PACKAGES
------------------------------------------------------------ */

/*
 * Import the Supabase JavaScript client.
 *
 * This allows the script to read and update records in the
 * project's Supabase database.
 */

const { createClient } = require("@supabase/supabase-js");


/*
 * Import Cheerio.
 *
 * Cheerio allows us to load HTML and search through it using
 * CSS selectors, similar to using jQuery in a web browser.
 *
 * For example:
 *
 *     $("video source")
 *
 * can be used to find <source> elements inside <video>
 * elements.
 */

const cheerio = require("cheerio");



/* ------------------------------------------------------------
   SUPABASE CREDENTIALS
------------------------------------------------------------ */

/*
 * Read the Supabase connection details from environment
 * variables.
 *
 * When this runs through GitHub Actions, these values are
 * supplied from GitHub Secrets.
 *
 * This means the sensitive Service Role key does NOT need to
 * be written directly into this JavaScript file.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
 * Stop immediately if either required setting is missing.
 *
 * There is no point continuing because the script would not
 * be able to read or update the candidate database.
 */

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
}



/* ------------------------------------------------------------
   CREATE SUPABASE CONNECTION
------------------------------------------------------------ */

/*
 * Create the Supabase client that will be used throughout the
 * rest of the script.
 *
 * Because this uses the Service Role key, this connection is
 * highly privileged.
 *
 * The Service Role key should therefore NEVER be exposed in
 * browser-side JavaScript or committed directly to GitHub.
 */

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);



/* ------------------------------------------------------------
   BROWSER IDENTIFICATION
------------------------------------------------------------ */

/*
 * Some websites behave differently depending on what software
 * appears to be visiting them.
 *
 * This User-Agent makes our requests resemble Chrome running
 * on a Mac rather than an unidentified automated script.
 *
 * The same value is reused for both the page request and the
 * later request to the actual media file.
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 Chrome/153 Safari/537.36";



/* ============================================================
   RESOLVE ONE CANDIDATE
   ============================================================
 *
 * This function performs all of the work required for ONE
 * candidate.
 *
 * It receives a candidate record containing:
 *
 *     candidate.id
 *     candidate.title
 *     candidate.source_url
 *
 * and attempts to find and save its actual media information.
 * ============================================================ */

async function resolveCandidate(candidate) {


  /* ----------------------------------------------------------
     DISPLAY WHICH CANDIDATE WE'RE WORKING ON
  ---------------------------------------------------------- */

  console.log("");
  console.log("----------------------------------------");
  console.log(`Candidate ${candidate.id}`);
  console.log(candidate.title);
  console.log(candidate.source_url);



  /* ----------------------------------------------------------
     PREPARE TO FETCH THE SOURCE PAGE
  ----------------------------------------------------------
   *
   * Start with the URL stored in zulu_candidates.source_url.
   *
   * This may turn out to redirect somewhere else, so pageUrl
   * can change as we follow those redirects.
   */

  let pageUrl =
    candidate.source_url;


  /*
   * This will eventually contain the HTTP response for the
   * final page.
   */

  let pageResponse = null;


  /*
   * Prevent an unexpected redirect loop.
   *
   * We allow up to five redirects before giving up.
   */

  const MAX_REDIRECTS = 5;



  /* ----------------------------------------------------------
     FOLLOW PAGE REDIRECTS MANUALLY
  ----------------------------------------------------------
   *
   * Normally fetch() can automatically follow redirects.
   *
   * Here we deliberately handle them ourselves so that we can:
   *
   *     • see each redirect in the log
   *     • keep track of the final page URL
   *     • detect unusual redirect behaviour
   *
   * Common redirect HTTP codes include:
   *
   *     301 = permanently moved
   *     302 = temporarily moved
   *     303 = see another URL
   *     307 = temporary redirect
   *     308 = permanent redirect
   */

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount++
  ) {


    // Show which URL we're currently requesting.

    console.log(
      `Fetching page: ${pageUrl}`
    );


    /*
     * Download the candidate's web page.
     */

    pageResponse =
      await fetch(
        pageUrl,
        {
          headers: {


            // Identify ourselves as a normal-looking browser.

            "User-Agent":
              USER_AGENT,


            // Tell the server that we expect an HTML page.

            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",


            // Prefer British English if the site has different
            // language versions.

            "Accept-Language":
              "en-GB,en;q=0.9",


            // Ask for a fresh response rather than deliberately
            // requesting a cached copy.

            "Cache-Control":
              "no-cache"
          },


          /*
           * Do NOT automatically follow redirects.
           *
           * We want to inspect them ourselves.
           */

          redirect:
            "manual"
        }
      );


    // Report the HTTP status returned by the website.

    console.log(
      `Page response: HTTP ${pageResponse.status}`
    );



    /* --------------------------------------------------------
       IS THIS RESPONSE A REDIRECT?
    -------------------------------------------------------- */

    if (
      [
        301,
        302,
        303,
        307,
        308
      ].includes(
        pageResponse.status
      )
    ) {


      /*
       * A redirect response should contain a "Location"
       * header telling us where to go next.
       */

      const location =
        pageResponse.headers.get(
          "location"
        );


      /*
       * If the server says "redirect" but doesn't actually
       * provide a destination, something is wrong.
       */

      if (
        !location
      ) {

        throw new Error(
          `HTTP ${pageResponse.status} redirect had no Location header`
        );
      }


      /*
       * Convert the redirect destination into a complete URL.
       *
       * This also handles relative redirects.
       *
       * For example:
       *
       *     /video/123/
       *
       * can become:
       *
       *     https://example.com/video/123/
       */

      const nextUrl =
        new URL(
          location,
          pageUrl
        ).href;


      // Show the redirect in the workflow log.

      console.log(
        `Redirect → ${nextUrl}`
      );


      // Make the redirected URL our new page URL.

      pageUrl =
        nextUrl;


      // Go around the loop again and fetch the new URL.

      continue;
    }


    /*
     * If the response wasn't a redirect, we've reached the
     * final page.
     */

    break;
  }



  /* ----------------------------------------------------------
     MAKE SURE WE ACTUALLY RECEIVED SOMETHING
  ---------------------------------------------------------- */

  if (
    !pageResponse
  ) {

    throw new Error(
      "No response received from candidate page"
    );
  }



  /* ----------------------------------------------------------
     CHECK THAT THE FINAL PAGE LOADED SUCCESSFULLY
  ----------------------------------------------------------
   *
   * response.ok is normally true for HTTP responses in the
   * 200–299 range.
   *
   * Examples of errors we might encounter:
   *
   *     403 = access forbidden
   *     404 = page no longer exists
   *     429 = too many requests
   *     500 = website/server problem
   */

  if (
    !pageResponse.ok
  ) {

    throw new Error(
      `Page returned HTTP ${pageResponse.status} (${pageUrl})`
    );
  }


  // Record the final URL in the log.

  console.log(
    `Final page URL: ${pageUrl}`
  );



  /* ----------------------------------------------------------
     READ AND PARSE THE HTML
  ---------------------------------------------------------- */

  /*
   * Convert the downloaded web page into ordinary text.
   */

  const html = await pageResponse.text();


  /*
   * Give the HTML to Cheerio.
   *
   * "$" now allows us to search the page using CSS selectors.
   */

  const $ = cheerio.load(html);



  /* ==========================================================
     FIND THE ACTUAL MP4
     ==========================================================
   *
   * IMPORTANT:
   *
   * We deliberately DO NOT simply search the entire HTML page
   * for ".mp4".
   *
   * A video page may contain other videos, such as:
   *
   *     • recommendations
   *     • previews
   *     • advertisements
   *     • related videos
   *
   * Those could also contain MP4 URLs.
   *
   * We specifically want the MP4 belonging to the MAIN video
   * player.
   * ========================================================== */


  /*
   * FIRST ATTEMPT
   * -------------
   *
   * Look for:
   *
   *     #video_kgvid_0
   *
   * and, inside it, find:
   *
   *     <source type="video/mp4">
   *
   * Then take the first matching source and read its "src"
   * attribute.
   */

  let mediaUrl =
    $("#video_kgvid_0 source[type='video/mp4']")
      .first()
      .attr("src");



  /* ----------------------------------------------------------
     FALLBACK PLAYER SEARCH
  ----------------------------------------------------------
   *
   * Website HTML can change.
   *
   * If the exact video ID above disappears, try a slightly
   * broader selector.
   *
   * This still restricts the search to a likely main-player
   * area rather than blindly taking any MP4 from the page.
   */

  if (!mediaUrl) {
    mediaUrl =
      $(".player-embed video source[type='video/mp4']")
        .first()
        .attr("src");
  }



  /* ----------------------------------------------------------
     DID WE FIND AN MP4?
  ---------------------------------------------------------- */

  if (!mediaUrl) {
    throw new Error(
      "Could not locate main MP4 source"
    );
  }



  /* ----------------------------------------------------------
     NORMALISE THE MEDIA URL
  ----------------------------------------------------------
   *
   * The HTML might contain either:
   *
   *     https://media.example.com/video.mp4
   *
   * OR a relative URL such as:
   *
   *     /media/video.mp4
   *
   * new URL() converts either form into a complete absolute
   * address using the final page URL as the reference point.
   */

  mediaUrl = new URL(
    mediaUrl,
    pageUrl
  ).href;


  // Show the discovered video URL.

  console.log(`Media URL: ${mediaUrl}`);



  /* ==========================================================
     GET FILE METADATA
     ==========================================================
   *
   * We now know where the MP4 is.
   *
   * Next, try to find out a little more about the file without
   * downloading the entire video.
   *
   * A HEAD request asks the server for the HTTP headers only.
   *
   * Ideally this gives us:
   *
   *     Content-Length
   *         = size of the video in bytes
   *
   *     Content-Type
   *         = type of file, e.g. video/mp4
   *
   * This is much more efficient than downloading a potentially
   * very large video just to discover its size.
   * ========================================================== */


  // Assume these values are unknown until we discover them.

  let mediaSize = null;
  let mediaContentType = null;


  /*
   * Put the HEAD request inside try/catch because failure to
   * obtain metadata should NOT necessarily make the entire
   * resolution fail.
   *
   * We already have the important part: the media URL.
   */

  try {

    const headResponse = await fetch(mediaUrl, {

      // Request headers only — not the entire video.
      method: "HEAD",

      headers: {

        "User-Agent": USER_AGENT,


        /*
         * Tell the media server which page led us to the file.
         *
         * Some media hosts check the Referer header before
         * allowing access.
         */

        "Referer": candidate.source_url
      },


      // Automatically follow redirects for the media file.
      redirect: "follow"
    });


    // Record the result of the HEAD request.

    console.log(
      `Media HEAD: HTTP ${headResponse.status}`
    );


    /*
     * Only examine the headers if the request succeeded.
     */

    if (headResponse.ok) {


      // Ask the server for the file size.

      const length =
        headResponse.headers.get("content-length");


      // Ask the server what type of file it is.

      const type =
        headResponse.headers.get("content-type");


      /*
       * Only accept Content-Length if it consists entirely of
       * digits.
       *
       * Then convert it from text into a JavaScript number.
       */

      if (length && /^\d+$/.test(length)) {
        mediaSize = Number(length);
      }


      // Save the Content-Type if one was supplied.

      if (type) {
        mediaContentType = type;
      }
    }

  } catch (error) {


    /*
     * A failed HEAD request is treated as a warning rather than
     * a fatal error.
     *
     * This means we can still save the candidate's media URL
     * even if the remote server refuses HEAD requests or fails
     * to provide metadata.
     */

    console.warn(
      `HEAD request failed: ${error.message}`
    );
  }



  /* ==========================================================
     DETERMINE THE FILENAME
     ==========================================================
   *
   * Extract the filename from the end of the media URL.
   *
   * For example:
   *
   *     https://example.com/videos/My%20Video.mp4
   *
   * becomes:
   *
   *     My Video.mp4
   * ========================================================== */


  /*
   * Extract only the path portion of the URL.
   *
   * This excludes things such as the domain name and query
   * parameters.
   */

  const pathname =
    new URL(mediaUrl).pathname;


  /*
   * Split the path at each "/" and take the final section.
   *
   * decodeURIComponent() converts URL encoding such as:
   *
   *     %20
   *
   * back into:
   *
   *     [space]
   */

  const mediaFilename =
    decodeURIComponent(
      pathname.split("/").pop() || ""
    );



  /* ==========================================================
     SAVE THE RESOLVED INFORMATION TO SUPABASE
     ==========================================================
   *
   * We now have everything we're going to save:
   *
   *     media URL
   *     filename
   *     size (if available)
   *     Content-Type (if available)
   *     date/time it was resolved
   *
   * Update the SAME zulu_candidates record we started with.
   * ========================================================== */

  const { error } = await supabase
    .from("zulu_candidates")
    .update({

      // Actual URL of the MP4.
      media_url: mediaUrl,


      // Filename extracted from the URL.
      media_filename: mediaFilename,


      // File size in bytes, or null if it couldn't be obtained.
      media_size_bytes: mediaSize,


      // Usually something such as "video/mp4".
      media_content_type: mediaContentType,


      // Record when the resolution happened.
      media_resolved_at:
        new Date().toISOString()
    })


    /*
     * VERY IMPORTANT:
     *
     * Only update the candidate we're currently processing.
     */

    .eq("id", candidate.id);



  // Stop if Supabase rejected the update.

  if (error) {
    throw error;
  }



  /* ----------------------------------------------------------
     REPORT THE RESULT
  ---------------------------------------------------------- */

  console.log(`Filename: ${mediaFilename}`);


  // Display the file size if we managed to obtain it.

  if (mediaSize !== null) {
    console.log(
      `Size: ${mediaSize.toLocaleString()} bytes`
    );
  } else {
    console.log("Size: unknown");
  }


  // Display the media type, or "unknown" if none was supplied.

  console.log(
    `Content-Type: ${mediaContentType || "unknown"}`
  );


  // Confirm that the database update succeeded.

  console.log("Saved.");
}



/* ============================================================
   MAIN PROGRAM
   ============================================================
 *
 * resolveCandidate() handles ONE candidate.
 *
 * main() handles the entire queue.
 *
 * Its job is to:
 *
 *     1. ask Supabase which candidates need resolving
 *     2. process them one at a time
 *     3. count successes and failures
 *     4. print a final summary
 * ============================================================ */

async function main() {


  console.log(
    "Looking for accepted unresolved candidates..."
  );



  /* ----------------------------------------------------------
     FIND CANDIDATES THAT NEED RESOLVING
  ----------------------------------------------------------
   *
   * Query the zulu_candidates table.
   */

  const { data: candidates, error } =
    await supabase
      .from("zulu_candidates")


      /*
       * We only need these three fields for the resolution
       * process.
       */

      .select(`
        id,
        title,
        source_url
      `)


      /*
       * Only candidates that have already been reviewed and
       * ACCEPTED should be processed.
       */

      .eq("status", "accepted")


      /*
       * media_url being NULL means that this candidate has not
       * yet had its actual media file resolved.
       */

      .is("media_url", null)


      /*
       * Process candidates in review order.
       *
       * The oldest reviewed candidates are handled first.
       */

      .order("reviewed_at", {
        ascending: true
      });



  // Stop completely if the database query itself failed.

  if (error) {
    throw error;
  }


  // Report the size of the queue.

  console.log(
    `Found ${candidates.length} candidate(s).`
  );



  /* ----------------------------------------------------------
     NOTHING TO DO?
  ----------------------------------------------------------
   *
   * If no accepted unresolved candidates exist, simply finish
   * successfully.
   */

  if (!candidates.length) {
    return;
  }



  /* ----------------------------------------------------------
     SUCCESS / FAILURE COUNTERS
  ---------------------------------------------------------- */

  let resolved = 0;
  let failed = 0;



  /* ----------------------------------------------------------
     PROCESS EACH CANDIDATE
  ----------------------------------------------------------
   *
   * Candidates are deliberately handled one at a time.
   */

  for (const candidate of candidates) {

    try {


      // Attempt to resolve this candidate.

      await resolveCandidate(candidate);


      // If we got here, it succeeded.

      resolved++;

    } catch (error) {


      /*
       * A problem with ONE candidate does not stop the entire
       * queue.
       *
       * Instead:
       *
       *     • count it as failed
       *     • print the error
       *     • continue to the next candidate
       *
       * This is useful because one deleted/broken source page
       * shouldn't prevent all the other candidates from being
       * resolved.
       */

      failed++;


      console.error(
        `Candidate ${candidate.id} FAILED:`,
        error.message
      );
    }
  }



  /* ==========================================================
     FINAL SUMMARY
     ========================================================== */

  console.log("");
  console.log("========================================");
  console.log("COMPLETE");
  console.log("========================================");

  console.log(`Resolved: ${resolved}`);
  console.log(`Failed:   ${failed}`);
}



/* ============================================================
   START THE PROGRAM
   ============================================================
 *
 * Everything above defines the resolver.
 *
 * This actually starts main().
 * ============================================================ */

main().catch(error => {


  /*
   * This catches a fatal error affecting the overall program.
   *
   * For example:
   *
   *     • Supabase cannot be queried
   *     • credentials are invalid
   *     • some unexpected error occurs outside the individual
   *       candidate processing
   */

  console.error(error);


  /*
   * Exit with status 1.
   *
   * This tells GitHub Actions that the script itself failed.
   *
   * By convention:
   *
   *     0 = success
   *     1 = failure
   */

  process.exit(1);
});
