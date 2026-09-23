/*
 * ============================================================
 * INSPECT A JUSTTHEGAYS VIDEO PAGE
 * ============================================================
 *
 * PURPOSE
 * -------
 * This is a diagnostic / investigation script.
 *
 * It downloads the HTML for one specific video page and then
 * searches through that HTML to find clues about how the video
 * player works and, particularly, where the actual video file
 * or video stream is located.
 *
 * It looks for:
 *
 *   • <video> elements
 *   • <source> elements
 *   • direct .mp4 URLs
 *   • .m3u8 streaming URLs
 *   • JSON-LD metadata
 *   • HTML / JavaScript lines mentioning video players
 *
 * Nothing is downloaded other than the HTML page itself.
 *
 * The script simply prints what it discovers to the console.
 *
 * This makes it useful when developing or debugging the main
 * JustTheGays scraper. If the website changes how its player
 * works, this script can help show what information is now
 * present in the page.
 * ============================================================
 */


/* ------------------------------------------------------------
   PAGE TO INSPECT
------------------------------------------------------------ */

/*
 * This is the individual video page that we want to examine.
 *
 * To investigate a different page, this URL can simply be
 * replaced with another JustTheGays video-page URL.
 */

const PAGE_URL =
  "https://justthegays.com/video/204746-themaskedsukr-a-blowjob-through-the-glorygole/";


/* ------------------------------------------------------------
   MAIN PROGRAM
------------------------------------------------------------ */

/*
 * "async" allows this function to wait for internet requests
 * to finish before continuing.
 *
 * Almost everything in this script happens inside main().
 */

async function main() {


  /* ----------------------------------------------------------
     DOWNLOAD THE WEB PAGE
  ---------------------------------------------------------- */

  // Display the URL we're about to request.
  // This makes the GitHub Actions log easier to understand.

  console.log("Fetching:");
  console.log(PAGE_URL);


  /*
   * Ask the website for the page.
   *
   * fetch() performs an HTTP request, similar to what happens
   * when a browser visits a web page.
   *
   * We supply a couple of normal browser-style HTTP headers.
   */

  const response = await fetch(PAGE_URL, {

    headers: {

      /*
       * User-Agent tells the web server what sort of software
       * is making the request.
       *
       * Here we're identifying the request as something
       * resembling Chrome on a Mac.
       */

      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/153 Safari/537.36",


      /*
       * Accept tells the server which types of response we can
       * understand.
       *
       * In this case we're primarily asking for a normal HTML
       * web page.
       */

      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });


  /*
   * Print the HTTP response code.
   *
   * Common examples:
   *
   *   200 = page retrieved successfully
   *   403 = access forbidden
   *   404 = page not found
   *   429 = too many requests
   *   500 = website/server error
   */

  console.log("HTTP:", response.status);


  /*
   * response.ok is normally true for successful HTTP responses
   * in the 200–299 range.
   *
   * If the page wasn't retrieved successfully, stop here.
   */

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }


  /*
   * Convert the downloaded response into ordinary text.
   *
   * "html" now contains the complete HTML source returned by
   * the website.
   */

  const html = await response.text();


  /*
   * Print the number of characters in the downloaded HTML.
   *
   * This can be useful when debugging. For example, a very
   * small response could indicate that we've received an error
   * page, challenge page or unexpected response instead of the
   * full video page.
   */

  console.log("HTML length:", html.length);



  /* ============================================================
     1. VIDEO TAGS
     ============================================================
   *
   * First, look for complete HTML <video> elements.
   *
   * A typical page might contain something like:
   *
   *   <video controls>
   *     <source src="video.mp4">
   *   </video>
   *
   * If the site's player exposes its video source directly in
   * the HTML, this can be one of the easiest places to find it.
   * ============================================================ */


  /*
   * Search the entire page for:
   *
   *     <video ...> ... </video>
   *
   * The "gi" flags mean:
   *
   *   g = find ALL matches, not just the first
   *   i = ignore upper/lower case
   *
   * If no video elements are found, use an empty array instead
   * of returning null.
   */

  const videoTags =
    html.match(/<video[\s\S]*?<\/video>/gi) || [];


  // Print a clear heading in the console.

  console.log("\n==============================");
  console.log("VIDEO TAGS");
  console.log("==============================");


  // Show how many <video> elements were discovered.

  console.log("Found:", videoTags.length);


  /*
   * Print each discovered <video> element.
   *
   * Numbering them makes multiple players easier to distinguish
   * in the GitHub Actions log.
   */

  videoTags.forEach((tag, i) => {
    console.log(`\n--- VIDEO ${i + 1} ---`);
    console.log(tag);
  });



  /* ============================================================
     2. SOURCE TAGS
     ============================================================
   *
   * Next, search separately for HTML <source> elements.
   *
   * These are commonly used inside video players:
   *
   *   <source src="movie.mp4" type="video/mp4">
   *
   * Even if our earlier <video> search doesn't reveal anything
   * useful, individual source elements might.
   * ============================================================ */


  const sourceTags =
    html.match(/<source\b[^>]*>/gi) || [];


  console.log("\n==============================");
  console.log("SOURCE TAGS");
  console.log("==============================");


  // Report how many source tags were found.

  console.log("Found:", sourceTags.length);


  // Print every source tag.

  sourceTags.forEach((tag, i) => {
    console.log(`\n--- SOURCE ${i + 1} ---`);
    console.log(tag);
  });



  /* ============================================================
     3. DIRECT MP4 REFERENCES
     ============================================================
   *
   * Now search the ENTIRE HTML document for URLs ending in
   * ".mp4".
   *
   * This is broader than looking at <video> and <source> tags.
   *
   * An MP4 address might instead be hidden inside:
   *
   *   • JavaScript
   *   • JSON
   *   • player configuration
   *   • page metadata
   *
   * So this search attempts to find MP4 URLs wherever they
   * appear in the page source.
   * ============================================================ */


  const mp4Matches =
    html.match(
      /https?:\/\/[^"'<>\\\s]+\.mp4(?:\?[^"'<>\\\s]*)?/gi
    ) || [];


  /*
   * Clean up the URLs we found.
   *
   * Web pages and JavaScript sometimes escape characters.
   *
   * For example:
   *
   *     \u0026
   *
   * represents:
   *
   *     &
   *
   * and:
   *
   *     \/
   *
   * simply represents:
   *
   *     /
   *
   * We convert these back into normal URL characters.
   *
   *
   * new Set(...) also removes duplicate URLs.
   *
   * The final [... ] converts the Set back into a normal
   * JavaScript array.
   */

  const mp4Urls =
    [...new Set(
      mp4Matches.map(url =>
        url
          .replace(/\\u0026/g, "&")
          .replace(/\\\//g, "/")
      )
    )];


  console.log("\n==============================");
  console.log("MP4 URLS");
  console.log("==============================");


  // Show the number of unique MP4 URLs found.

  console.log("Found:", mp4Urls.length);


  // Print each MP4 URL with a simple numbered list.

  mp4Urls.forEach((url, i) => {
    console.log(`${i + 1}. ${url}`);
  });



  /* ============================================================
     4. M3U8 STREAMING REFERENCES
     ============================================================
   *
   * Not every website provides a simple MP4 file.
   *
   * Some sites use HLS streaming instead.
   *
   * HLS streams commonly use an ".m3u8" playlist.
   *
   * For example:
   *
   *     https://example.com/video/master.m3u8
   *
   * An M3U8 file isn't normally the video itself. It is a
   * playlist that tells a video player where to obtain the
   * pieces of the video stream.
   *
   * This section therefore searches the page for any M3U8
   * addresses.
   * ============================================================ */


  const m3u8Matches =
    html.match(
      /https?:\/\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?/gi
    ) || [];


  /*
   * As with the MP4 URLs:
   *
   *   • clean escaped characters
   *   • remove duplicate URLs
   */

  const m3u8Urls =
    [...new Set(
      m3u8Matches.map(url =>
        url
          .replace(/\\u0026/g, "&")
          .replace(/\\\//g, "/")
      )
    )];


  console.log("\n==============================");
  console.log("M3U8 URLS");
  console.log("==============================");


  // Number of unique streaming playlists found.

  console.log("Found:", m3u8Urls.length);


  // Print each playlist URL.

  m3u8Urls.forEach((url, i) => {
    console.log(`${i + 1}. ${url}`);
  });



  /* ============================================================
     5. JSON-LD METADATA
     ============================================================
   *
   * Many websites include structured information in their HTML
   * using JSON-LD.
   *
   * It normally looks something like:
   *
   *   <script type="application/ld+json">
   *     {
   *       "@type": "VideoObject",
   *       "name": "...",
   *       "thumbnailUrl": "...",
   *       "contentUrl": "..."
   *     }
   *   </script>
   *
   * Search engines such as Google use this information to
   * understand what a page contains.
   *
   * For us it can be useful because video websites sometimes
   * expose useful metadata or media URLs here.
   * ============================================================ */


  const jsonLd =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ) || [];


  console.log("\n==============================");
  console.log("JSON-LD");
  console.log("==============================");


  // Show how many JSON-LD blocks exist on the page.

  console.log("Found:", jsonLd.length);


  // Print each block in full.

  jsonLd.forEach((block, i) => {
    console.log(`\n--- JSON-LD ${i + 1} ---`);
    console.log(block);
  });



  /* ============================================================
     6. PLAYER-RELATED HTML / JAVASCRIPT
     ============================================================
   *
   * Finally, perform a much broader search.
   *
   * Instead of looking for a particular HTML element, split
   * the entire page into individual lines and look for words
   * commonly associated with web video players.
   *
   * This can reveal player configuration that the earlier
   * searches didn't recognise.
   * ============================================================ */


  // Break the page source into individual lines.

  const lines =
    html.split("\n");


  /*
   * Keep any line containing one or more of these terms:
   *
   *   mp4
   *      Possible direct MP4 file.
   *
   *   m3u8
   *      Possible HLS streaming playlist.
   *
   *   video_url / videoUrl
   *      Common variable names used for a video address.
   *
   *   file:
   *      Often used in JavaScript player configuration.
   *
   *   sources
   *      Could indicate a list of video sources.
   *
   *   player
   *      General video-player code.
   *
   *   jwplayer
   *      JW Player, a commonly used web video player.
   *
   *   fluidPlayer
   *      Fluid Player, another web video player.
   *
   *   videojs
   *      Video.js, another common player library.
   */

  const interesting =
    lines.filter(line =>
      /mp4|m3u8|video_url|videoUrl|file:|sources|player|jwplayer|fluidPlayer|videojs/i.test(
        line
      )
    );


  console.log("\n==============================");
  console.log("PLAYER-RELATED HTML");
  console.log("==============================");


  // Show the total number of matching lines.

  console.log("Matching lines:", interesting.length);


  /*
   * Print the first 100 interesting lines.
   *
   * The 100-line limit prevents an unusually complicated page
   * from flooding the GitHub Actions log with thousands of
   * lines of HTML or JavaScript.
   *
   * trim() removes unnecessary whitespace from the beginning
   * and end of each line before printing it.
   */

  interesting
    .slice(0, 100)
    .forEach(line => {
      console.log(line.trim());
    });
}


/* ============================================================
   START THE PROGRAM
   ============================================================
 *
 * Everything above defines what main() should do.
 *
 * This line actually starts it.
 * ============================================================ */

main().catch(error => {

  /*
   * If ANY unhandled error occurs during the process — for
   * example:
   *
   *   • the website cannot be reached
   *   • an HTTP error occurs
   *   • some unexpected JavaScript error occurs
   *
   * print the error to the console.
   */

  console.error(error);


  /*
   * Exit with status code 1.
   *
   * In command-line programs:
   *
   *     0 = success
   *     1 = failure
   *
   * This is especially important when the script is run from
   * GitHub Actions because GitHub will recognise the non-zero
   * exit code and mark the step as failed.
   */

  process.exit(1);
});
