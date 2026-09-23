/*
 * ============================================================
 * GAYXFANS CANDIDATE SCRAPER
 * ============================================================
 *
 * PURPOSE
 * -------
 * This script searches GayXFans for recently uploaded videos
 * that could potentially be added to Pornflix.
 *
 * It does NOT download or import the actual videos.
 *
 * Its job is the earlier "discovery" stage of the pipeline:
 *
 *     GayXFans
 *         ↓
 *     Find recently uploaded videos
 *         ↓
 *     Extract title / URL / age / thumbnail
 *         ↓
 *     Check whether we already know about them
 *         ↓
 *     Save/update them in zulu_candidates
 *
 * Newly discovered videos are saved with:
 *
 *     status = "pending"
 *
 * so they can subsequently be reviewed and, if accepted,
 * processed by the later candidate-resolution/import tools.
 *
 *
 * WHY PLAYWRIGHT IS USED
 * ----------------------
 * GayXFans cannot reliably be scraped by simply downloading
 * its raw HTML.
 *
 * This script therefore launches a real Chromium browser using
 * Playwright. This allows the page's JavaScript to run and also
 * gives Cloudflare's normal browser checks an opportunity to
 * complete.
 *
 *
 * TIME WINDOW
 * -----------
 * We are only interested in videos uploaded within the most
 * recent 24 hours.
 *
 * The scraper moves through GayXFans pages until it reaches
 * videos older than that window, or reaches the configured
 * maximum number of pages.
 * ============================================================
 */


/* ------------------------------------------------------------
   REQUIRED PACKAGES
------------------------------------------------------------ */

/*
 * Cheerio lets us search the final rendered HTML using CSS
 * selectors, rather like jQuery.
 */

const cheerio =
  require(
    "cheerio"
  );


/*
 * Playwright provides the Chromium browser used to load
 * GayXFans as a real web page.
 */

const {
  chromium
} =
  require(
    "playwright"
  );


/*
 * Supabase client used to read and write candidate records.
 */

const {
  createClient
} =
  require(
    "@supabase/supabase-js"
  );



/* ------------------------------------------------------------
   BASIC CONFIGURATION
------------------------------------------------------------ */

/*
 * Starting address for GayXFans.
 *
 * Page 1 uses this URL directly.
 *
 * Later pages are constructed as:
 *
 *     https://gayxfans.com/?page=2
 *     https://gayxfans.com/?page=3
 *     etc.
 */

const BASE_URL =
  "https://gayxfans.com/";


/*
 * Supabase credentials are NOT stored in this file.
 *
 * GitHub Actions supplies them securely through environment
 * variables populated from GitHub Secrets.
 */

const supabaseUrl =
  process.env.SUPABASE_URL;

const supabaseServiceRoleKey =
  process.env
    .SUPABASE_SERVICE_ROLE_KEY;


/*
 * Stop immediately if either Supabase setting is missing.
 *
 * Without these credentials the scraper would have nowhere
 * to save the candidates it discovers.
 */

if (
  !supabaseUrl
) {

  throw new Error(
    "SUPABASE_URL is not configured."
  );
}


if (
  !supabaseServiceRoleKey
) {

  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not configured."
  );
}



/* ------------------------------------------------------------
   CONNECT TO SUPABASE
------------------------------------------------------------ */

/*
 * Create our database connection.
 *
 * Session persistence and automatic token refreshing are
 * disabled because this is a short-lived server-side script,
 * rather than a user logged into a website.
 */

const supabase =
  createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        persistSession:
          false,

        autoRefreshToken:
          false
      }
    }
  );



/* ============================================================
   SCRAPING LIMITS
   ============================================================ */

/*
 * Only consider videos that appear to have been uploaded
 * within the last 24 hours.
 */

const WINDOW_HOURS =
  24;


/*
 * Absolute safety limit on pagination.
 *
 * Even if the scraper never encounters an old-enough video,
 * it will not continue beyond 10 pages.
 *
 * GayXFans currently displays many videos per page, so ten
 * pages should be considerably more than normally required
 * to cover a 24-hour period.
 */

const MAX_PAGES =
  10;



/* ============================================================
   HELPER: CLEAN TEXT
   ============================================================
 *
 * HTML often contains:
 *
 *     extra spaces
 *     tabs
 *     newlines
 *
 * This helper converts them into ordinary single spaces and
 * removes whitespace from the beginning/end.
 *
 * Example:
 *
 *     "  Some\n\nVideo   Title "
 *
 * becomes:
 *
 *     "Some Video Title"
 * ============================================================ */

function cleanText(
  value
) {

  return String(
    value ||
    ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}



/* ============================================================
   HELPER: CONVERT RELATIVE AGE INTO A TIMESTAMP
   ============================================================
 *
 * GayXFans does not give us an exact upload date/time.
 *
 * Instead it displays text such as:
 *
 *     "9 hours ago"
 *     "1 day ago"
 *     "2 days ago"
 *     "1 week ago"
 *
 * This function converts that description into an estimated
 * date/time by subtracting the stated period from "now".
 *
 * For example:
 *
 *     current time = 15:00
 *     age          = "2 hours ago"
 *
 * becomes approximately:
 *
 *     13:00
 *
 * The original text is ALSO retained later as source_age.
 *
 * Month/year calculations are necessarily approximate because
 * the website itself only gives an approximate relative age.
 * ============================================================ */

function relativeAgeToTimestamp(
  ageText,
  now
) {

  const text =
    cleanText(
      ageText
    ).toLowerCase();


  // No usable age supplied.

  if (
    !text
  ) {

    return null;
  }


  // "just now" effectively means the current time.

  if (
    text === "just now"
  ) {

    return now;
  }


  /*
   * Split something like:
   *
   *     "9 hours ago"
   *
   * into:
   *
   *     amount = 9
   *     unit   = hours
   */

  const match =
    text.match(
      /^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/
    );


  if (
    !match
  ) {

    return null;
  }


  const amount =
    Number(
      match[1]
    );

  const unit =
    match[2];


  if (
    !Number.isFinite(
      amount
    )
  ) {

    return null;
  }


  /*
   * Number of milliseconds represented by each unit.
   */

  const multipliers = {

    minute:
      60 * 1000,

    minutes:
      60 * 1000,

    hour:
      60 * 60 * 1000,

    hours:
      60 * 60 * 1000,

    day:
      24 * 60 * 60 * 1000,

    days:
      24 * 60 * 60 * 1000,

    week:
      7 * 24 * 60 * 60 * 1000,

    weeks:
      7 * 24 * 60 * 60 * 1000,

    /*
     * These are deliberately approximate because the source
     * website itself only provides a relative description.
     */

    month:
      30 * 24 * 60 * 60 * 1000,

    months:
      30 * 24 * 60 * 60 * 1000,

    year:
      365 * 24 * 60 * 60 * 1000,

    years:
      365 * 24 * 60 * 60 * 1000
  };


  const multiplier =
    multipliers[
      unit
    ];


  if (
    !multiplier
  ) {

    return null;
  }


  // Subtract the relative age from the current time.

  return (
    now -
    (
      amount *
      multiplier
    )
  );
}



/* ============================================================
   HELPER: FIND THE VIDEO'S RELATIVE AGE
   ============================================================
 *
 * A GayXFans video card contains ordinary text describing
 * when the video was uploaded.
 *
 * Search all of the card's text for expressions such as:
 *
 *     just now
 *     5 minutes ago
 *     3 hours ago
 *     1 day ago
 *
 * If more than one relative-time expression exists, the final
 * one is assumed to be the video's upload age.
 * ============================================================ */

function extractRelativeAge(
  card
) {

  const text =
    cleanText(
      card.text()
    );


  const matches =
    text.match(
      /\b(?:just now|\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago)\b/gi
    );


  if (
    !matches ||
    !matches.length
  ) {

    return null;
  }


  return matches[
    matches.length - 1
  ];
}



/* ============================================================
   HELPER: FIND THE VIDEO THUMBNAIL
   ============================================================
 *
 * Websites can store an image address in several attributes.
 *
 * In particular, lazy-loaded images may not immediately use
 * the normal:
 *
 *     src=
 *
 * attribute.
 *
 * Therefore we try, in order:
 *
 *     data-src
 *     data-original
 *     data-lazy-src
 *     src
 *
 * The resulting address is converted into a complete absolute
 * URL if necessary.
 * ============================================================ */

function extractThumbnailUrl(
  $,
  card,
  pageUrl
) {

  const image =
    card.find(
      "img"
    ).first();


  if (
    !image.length
  ) {

    return null;
  }


  const raw =
    image.attr(
      "data-src"
    ) ||
    image.attr(
      "data-original"
    ) ||
    image.attr(
      "data-lazy-src"
    ) ||
    image.attr(
      "src"
    ) ||
    null;


  if (
    !raw
  ) {

    return null;
  }


  try {

    return new URL(
      raw,
      pageUrl
    ).href;

  } catch {

    return null;
  }
}



/* ============================================================
   SCRAPE ONE GAYXFANS PAGE
   ============================================================
 *
 * This function is responsible for ONE page of GayXFans.
 *
 * It:
 *
 *     1. works out the page URL
 *     2. opens a Chromium browser context
 *     3. navigates to GayXFans
 *     4. waits for any Cloudflare check
 *     5. obtains the rendered HTML
 *     6. finds video links
 *     7. extracts video information
 *     8. keeps videos within our 24-hour window
 *
 * It returns the discovered videos to the main program.
 * ============================================================ */

async function scrapePage(
  browser,
  pageNumber,
  cutoff,
  now
) {

  /*
   * Page 1:
   *
   *     https://gayxfans.com/
   *
   * Later pages:
   *
   *     https://gayxfans.com/?page=2
   */

  const pageUrl =
    pageNumber === 1
      ? BASE_URL
      : `${BASE_URL}?page=${pageNumber}`;


  console.log(
    ""
  );

  console.log(
    `Fetching GayXFans page ${pageNumber}: ${pageUrl}`
  );



  /* ----------------------------------------------------------
     CREATE A BROWSER SESSION
  ----------------------------------------------------------
   *
   * Each scraped page gets its own browser context.
   *
   * The context resembles a normal Chrome browser using
   * British English and a normal desktop-sized screen.
   */

  const context =
    await browser.newContext(
      {
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",

        locale:
          "en-GB",

        viewport: {
          width:
            1440,

          height:
            1000
        }
      }
    );


  const page =
    await context.newPage();


  try {

    console.log(
      "Navigating with Chromium..."
    );


    /*
     * Open the page.
     *
     * Wait until the initial HTML document has loaded.
     *
     * Give the site a maximum of 60 seconds to respond.
     */

    const response =
      await page.goto(
        pageUrl,
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            60000
        }
      );


    if (
      !response
    ) {

      throw new Error(
        `GayXFans page ${pageNumber}: browser navigation returned no response.`
      );
    }


    console.log(
      `Initial HTTP status: ${response.status()}`
    );



    /* --------------------------------------------------------
       HANDLE A POSSIBLE CLOUDFLARE CHECK
    --------------------------------------------------------
     *
     * GayXFans may initially show a Cloudflare verification
     * page instead of the actual website.
     *
     * Typical text includes:
     *
     *     "Just a moment"
     *     "Performing security verification"
     *     "Verify you are human"
     *
     * Chromium is given up to 15 attempts, waiting two seconds
     * between attempts, for the normal browser verification
     * process to finish.
     */

    let challengeDetected =
      false;


    for (
      let attempt = 1;
      attempt <= 15;
      attempt++
    ) {

      const currentTitle =
        await page
          .title()
          .catch(
            () => ""
          );


      const bodyText =
        await page
          .locator(
            "body"
          )
          .innerText()
          .catch(
            () => ""
          );


      challengeDetected =
        /just a moment/i.test(
          currentTitle
        ) ||
        /performing security verification/i.test(
          bodyText
        ) ||
        /verify you are human/i.test(
          bodyText
        );


      // Challenge has cleared — continue normally.

      if (
        !challengeDetected
      ) {

        break;
      }


      if (
        attempt === 1
      ) {

        console.log(
          "Cloudflare challenge detected. Waiting for browser verification..."
        );
      }


      // Wait two seconds before checking again.

      await page.waitForTimeout(
        2000
      );
    }



    /* --------------------------------------------------------
       CONFIRM WE REACHED THE REAL PAGE
    -------------------------------------------------------- */

    const title =
      await page.title();


    const finalUrl =
      page.url();


    console.log(
      `Page title: ${title}`
    );

    console.log(
      `Final URL: ${finalUrl}`
    );


    const finalBodyText =
      await page
        .locator(
          "body"
        )
        .innerText()
        .catch(
          () => ""
        );


    const stillChallenged =
      /just a moment/i.test(
        title
      ) ||
      /performing security verification/i.test(
        finalBodyText
      ) ||
      /verify you are human/i.test(
        finalBodyText
      );


    console.log(
      `Cloudflare challenge: ${
        stillChallenged
          ? "YES"
          : "NO"
      }`
    );


    /*
     * If the verification page is still present, stop rather
     * than accidentally treating the Cloudflare page as the
     * GayXFans video listing.
     */

    if (
      stillChallenged
    ) {

      throw new Error(
        "GayXFans Cloudflare challenge did not clear in Chromium."
      );
    }



    /* --------------------------------------------------------
       WAIT FOR LAZY-LOADED CONTENT
    --------------------------------------------------------
     *
     * Some page elements may appear shortly after the initial
     * document has loaded.
     *
     * Give them another 1.5 seconds to settle.
     */

    await page.waitForTimeout(
      1500
    );


    /*
     * Obtain the final HTML AFTER Chromium has rendered the
     * page.
     */

    const html =
      await page.content();


    console.log(
      `Received ${html.length.toLocaleString()} rendered characters`
    );


    // Load the rendered HTML into Cheerio.

    const $ =
      cheerio.load(
        html
      );



    /* ========================================================
       DIAGNOSTIC CHECK: /watch/ LINKS
       ========================================================
     *
     * The scraper expects GayXFans individual video pages to
     * use URLs containing:
     *
     *     /watch/
     *
     * Before parsing the page, inspect the live browser DOM
     * and report how many such links exist.
     *
     * This is useful diagnostic information if GayXFans later
     * changes its page structure.
     */

    const watchLinks =
      await page
        .locator(
          'a[href*="/watch/"]'
        )
        .evaluateAll(
          elements =>
            elements.map(
              element => ({
                href:
                  element.href,

                text:
                  (
                    element.textContent ||
                    ""
                  )
                    .replace(
                      /\s+/g,
                      " "
                    )
                    .trim(),

                title:
                  element.getAttribute(
                    "title"
                  ) ||
                  ""
              })
            )
        );


    console.log(
      `/watch/ links found: ${watchLinks.length}`
    );


    /*
     * If /watch/ links exist, print five examples.
     *
     * This makes it easy to inspect the structure from the
     * GitHub Actions log.
     */

    if (
      watchLinks.length
    ) {

      console.log(
        ""
      );

      console.log(
        "Sample GayXFans watch links:"
      );


      watchLinks
        .slice(
          0,
          5
        )
        .forEach(
          (
            item,
            index
          ) => {

            console.log(
              `${index + 1}. ${
                item.text ||
                item.title ||
                "(no link text)"
              } -> ${item.href}`
            );
          }
        );

    } else {

      /*
       * If GayXFans no longer uses /watch/ URLs, print some
       * ordinary links from the page instead.
       *
       * This gives us clues about the site's new structure
       * without needing a separate debugging script.
       */

      const sampleLinks =
        await page
          .locator(
            "a[href]"
          )
          .evaluateAll(
            elements =>
              elements
                .slice(
                  0,
                  20
                )
                .map(
                  element => ({
                    href:
                      element.href,

                    text:
                      (
                        element.textContent ||
                        ""
                      )
                        .replace(
                          /\s+/g,
                          " "
                        )
                        .trim()
                  })
                )
          );


      console.log(
        ""
      );

      console.log(
        "No /watch/ links found. Sample page links:"
      );


      sampleLinks.forEach(
        (
          item,
          index
        ) => {

          console.log(
            `${index + 1}. ${
              item.text ||
              "(no link text)"
            } -> ${item.href}`
          );
        }
      );
    }



    /* ========================================================
       FIND VIDEO LINKS
       ========================================================
     *
     * Now perform the actual scrape using Cheerio.
     *
     * Every link containing "/watch/" is initially considered
     * a possible video link.
     */

    const videoLinks =
      $(
        'a[href*="/watch/"]'
      );


    console.log(
      `Found ${videoLinks.length} candidate watch links.`
    );


    // Videos successfully extracted from this page.

    const videos =
      [];


    /*
     * A video may have several links within the same card
     * (thumbnail, title, etc.).
     *
     * This Set prevents us from adding the same source URL
     * several times.
     */

    const seenOnPage =
      new Set();


    /*
     * Keep track of the oldest video encountered.
     *
     * The main pagination system uses this to determine when
     * we've gone beyond the 24-hour window.
     */

    let oldestTimestamp =
      null;



    /* ========================================================
       EXAMINE EACH POSSIBLE VIDEO LINK
       ======================================================== */

    videoLinks.each(
      (
        _,
        element
      ) => {

        const link =
          $(
            element
          );


        const href =
          link.attr(
            "href"
          );


        // Ignore links without an address.

        if (
          !href
        ) {

          return;
        }


        /*
         * Convert relative links into complete URLs.
         */

        let sourceUrl;


        try {

          sourceUrl =
            new URL(
              href,
              finalUrl
            ).href;

        } catch {

          return;
        }


        /*
         * Don't process the same video twice on this page.
         */

        if (
          seenOnPage.has(
            sourceUrl
          )
        ) {

          return;
        }



        /* ----------------------------------------------------
           FIND THE VIDEO'S CARD
        ----------------------------------------------------
         *
         * We need the surrounding card because it contains
         * information such as:
         *
         *     title
         *     thumbnail
         *     upload age
         *
         * Try several common containers:
         *
         *     <li>
         *     <article>
         *     <div>
         */

        let card =
          link.closest(
            "li"
          );


        if (
          !card.length
        ) {

          card =
            link.closest(
              "article"
            );
        }


        if (
          !card.length
        ) {

          card =
            link.closest(
              "div"
            );
        }


        // Can't identify the card, so ignore this link.

        if (
          !card.length
        ) {

          return;
        }



        /* ----------------------------------------------------
           DETERMINE WHEN THE VIDEO WAS UPLOADED
        ---------------------------------------------------- */

        const sourceAge =
          extractRelativeAge(
            card
          );


        if (
          !sourceAge
        ) {

          return;
        }


        const uploadedMs =
          relativeAgeToTimestamp(
            sourceAge,
            now
          );


        if (
          uploadedMs ===
            null
        ) {

          return;
        }


        /*
         * Record the oldest timestamp seen anywhere on this
         * page, even if that video is outside our target
         * window.
         */

        if (
          oldestTimestamp ===
            null ||
          uploadedMs <
            oldestTimestamp
        ) {

          oldestTimestamp =
            uploadedMs;
        }


        /*
         * Only retain videos inside our 24-hour window.
         *
         * Also reject dates that somehow appear to be in the
         * future.
         */

        if (
          uploadedMs <
            cutoff ||
          uploadedMs >
            now
        ) {

          return;
        }



        /* ----------------------------------------------------
           FIND THE VIDEO TITLE
        ----------------------------------------------------
         *
         * Different parts of the GayXFans card may contain the
         * title, so several possibilities are tried.
         */


        const image =
          card.find(
            "img"
          ).first();


        /*
         * FIRST CHOICE:
         * title attribute on the video link.
         */

        let videoTitle =
          cleanText(
            link.attr(
              "title"
            )
          );


        /*
         * SECOND CHOICE:
         * image ALT text.
         */

        if (
          !videoTitle
        ) {

          videoTitle =
            cleanText(
              image.attr(
                "alt"
              )
            );
        }


        /*
         * THIRD CHOICE:
         * visible text of the current link.
         */

        if (
          !videoTitle
        ) {

          videoTitle =
            cleanText(
              link.text()
            );
        }


        /*
         * FINAL FALLBACK:
         *
         * Search the other /watch/ links inside the same card
         * and use the first one containing useful text.
         */

        if (
          !videoTitle
        ) {

          card
            .find(
              'a[href*="/watch/"]'
            )
            .each(
              (
                __,
                titleElement
              ) => {

                const candidateTitle =
                  cleanText(
                    $(
                      titleElement
                    ).text()
                  );


                if (
                  candidateTitle
                ) {

                  videoTitle =
                    candidateTitle;

                  return false;
                }
              }
            );
        }


        /*
         * A candidate without a title isn't useful enough to
         * store, so skip it.
         */

        if (
          !videoTitle
        ) {

          return;
        }



        /* ----------------------------------------------------
           FIND THE THUMBNAIL
        ---------------------------------------------------- */

        const thumbnailUrl =
          extractThumbnailUrl(
            $,
            card,
            finalUrl
          );



        /* ----------------------------------------------------
           SAVE THIS RESULT IN MEMORY
        ---------------------------------------------------- */

        seenOnPage.add(
          sourceUrl
        );


        videos.push(
          {

            // Human-readable video title.
            title:
              videoTitle,


            // GayXFans video-page URL.
            source_url:
              sourceUrl,


            // Original text, e.g. "6 hours ago".
            source_age:
              sourceAge,


            /*
             * Our estimated ISO date/time calculated from the
             * relative age.
             */
            source_uploaded_at:
              new Date(
                uploadedMs
              ).toISOString(),


            // Thumbnail, if one could be identified.
            thumbnail_url:
              thumbnailUrl
          }
        );
      }
    );


    console.log(
      `${videos.length} GayXFans videos on page ${pageNumber} are within ${WINDOW_HOURS} hours.`
    );


    /*
     * Return both the videos and some information needed by
     * the pagination logic.
     */

    return {
      videos,

      linkCount:
        videoLinks.length,

      oldestTimestamp
    };

  } finally {

    /*
     * Always close this browser context, even if something
     * went wrong while processing the page.
     */

    await context.close();

  }
}



/* ============================================================
   MAIN SCRAPER
   ============================================================ */

async function run() {


  /* ----------------------------------------------------------
     START CHROMIUM
  ----------------------------------------------------------
   *
   * "headless" means Chromium runs without displaying an
   * actual browser window.
   *
   * This is ideal for GitHub Actions, where there is no human
   * sitting in front of the browser.
   */

  console.log(
    "Launching Chromium..."
  );


  const browser =
    await chromium.launch(
      {
        headless:
          true
      }
    );


  try {


    /* --------------------------------------------------------
       CALCULATE THE 24-HOUR WINDOW
    -------------------------------------------------------- */

    const now =
      Date.now();


    const cutoff =
      now -
      (
        WINDOW_HOURS *
        60 *
        60 *
        1000
      );


    /*
     * Results from every page are collected here before they
     * are written to Supabase.
     */

    const allVideos =
      [];


    let pageNumber =
      1;



    /* ========================================================
       PAGINATE THROUGH GAYXFANS
       ========================================================
     *
     * Continue until one of the following happens:
     *
     *     • MAX_PAGES is reached
     *     • no video links are found
     *     • we've reached videos older than 24 hours
     *     • a later page contains no videos in the window
     */

    while (
      pageNumber <=
        MAX_PAGES
    ) {

      const result =
        await scrapePage(
          browser,
          pageNumber,
          cutoff,
          now
        );


      // Add this page's videos to the combined list.

      allVideos.push(
        ...result.videos
      );


      /*
       * No video links at all probably means we've reached the
       * end or the page structure is no longer what we expect.
       */

      if (
        result.linkCount ===
          0
      ) {

        console.log(
          "No GayXFans video links found. Stopping pagination."
        );

        break;
      }


      /*
       * If the oldest item on this page is already older than
       * our 24-hour window, there is no reason to request even
       * older pages.
       */

      if (
        result.oldestTimestamp !==
          null &&
        result.oldestTimestamp <
          cutoff
      ) {

        console.log(
          `GayXFans page ${pageNumber} has reached videos older than ${WINDOW_HOURS} hours.`
        );

        console.log(
          "Stopping pagination."
        );

        break;
      }


      /*
       * If we've moved beyond page 1 and this page produced no
       * qualifying recent videos, stop.
       */

      if (
        result.videos.length ===
          0 &&
        pageNumber >
          1
      ) {

        console.log(
          `GayXFans page ${pageNumber} contains no videos within ${WINDOW_HOURS} hours.`
        );

        console.log(
          "Stopping pagination."
        );

        break;
      }


      // Otherwise move to the next page.

      pageNumber++;

    }



    /* ========================================================
       REMOVE DUPLICATES
       ========================================================
     *
     * The same video could theoretically have appeared more
     * than once during the scrape.
     *
     * Use source_url as the unique identifier and retain only
     * one copy of each URL.
     */

    const unique =
      [
        ...new Map(
          allVideos.map(
            video => [
              video.source_url,
              video
            ]
          )
        ).values()
      ];


    /*
     * Sort newest first.
     */

    unique.sort(
      (
        a,
        b
      ) =>
        new Date(
          b.source_uploaded_at
        ) -
        new Date(
          a.source_uploaded_at
        )
    );


    console.log(
      ""
    );

    console.log(
      "============================================"
    );

    console.log(
      `TOTAL UNIQUE GAYXFANS CANDIDATES <= ${WINDOW_HOURS} HOURS: ${unique.length}`
    );

    console.log(
      "============================================"
    );


    /*
     * If nothing qualified, there is no need to contact
     * Supabase again.
     */

    if (
      !unique.length
    ) {

      console.log(
        "Nothing to write to Supabase."
      );

      return;
    }



    /* ========================================================
       FIND WHICH CANDIDATES ALREADY EXIST
       ========================================================
     *
     * Before inserting anything, ask Supabase whether any of
     * these source URLs already exist in zulu_candidates.
     *
     * This allows us to distinguish:
     *
     *     NEW candidate
     *          → INSERT
     *
     *     existing candidate
     *          → UPDATE
     * ======================================================== */

    const sourceUrls =
      unique.map(
        video =>
          video.source_url
      );


    const existingRows =
      [];


    /*
     * Look up URLs in small batches rather than sending one
     * enormous database query.
     */

    const LOOKUP_BATCH_SIZE =
      25;


    for (
      let i = 0;
      i <
        sourceUrls.length;
      i +=
        LOOKUP_BATCH_SIZE
    ) {

      const batch =
        sourceUrls.slice(
          i,
          i +
            LOOKUP_BATCH_SIZE
        );


      console.log(
        `Checking existing GayXFans candidates ${i + 1}-${Math.min(
          i +
            LOOKUP_BATCH_SIZE,
          sourceUrls.length
        )} of ${sourceUrls.length}...`
      );


      const {
        data,
        error
      } =
        await supabase
          .from(
            "zulu_candidates"
          )
          .select(
            "id, source_url, status, first_seen_at, reviewed_at"
          )
          .in(
            "source_url",
            batch
          );


      if (
        error
      ) {

        throw error;
      }


      if (
        data
      ) {

        existingRows.push(
          ...data
        );
      }
    }



    /* --------------------------------------------------------
       BUILD A QUICK URL LOOKUP
    --------------------------------------------------------
     *
     * This Map makes it easy to ask:
     *
     *     "Does this source URL already exist?"
     */

    const existingByUrl =
      new Map(
        existingRows.map(
          row => [
            row.source_url,
            row
          ]
        )
      );


    const currentTimestamp =
      new Date().toISOString();



    /* ========================================================
       PREPARE BRAND-NEW CANDIDATES
       ========================================================
     *
     * Anything whose source URL is not already in Supabase is
     * a newly discovered candidate.
     *
     * New candidates start with:
     *
     *     status = pending
     *
     * so that they can go through the normal review process.
     */

    const newCandidates =
      unique
        .filter(
          video =>
            !existingByUrl.has(
              video.source_url
            )
        )
        .map(
          video => ({

            title:
              video.title,

            source_url:
              video.source_url,

            source_age:
              video.source_age,

            source_uploaded_at:
              video.source_uploaded_at,

            thumbnail_url:
              video.thumbnail_url,

            status:
              "pending",

            first_seen_at:
              currentTimestamp,

            last_seen_at:
              currentTimestamp
          })
        );


    /*
     * Anything whose URL IS already present will be refreshed
     * instead of inserted again.
     */

    const existingCandidates =
      unique.filter(
        video =>
          existingByUrl.has(
            video.source_url
          )
      );



    /* ========================================================
       INSERT NEW CANDIDATES
       ======================================================== */

    let insertedCount =
      0;


    if (
      newCandidates.length
    ) {

      console.log(
        `Inserting ${newCandidates.length} new GayXFans candidates...`
      );


      /*
       * Insert in batches of 100.
       */

      const INSERT_BATCH_SIZE =
        100;


      for (
        let i = 0;
        i <
          newCandidates.length;
        i +=
          INSERT_BATCH_SIZE
      ) {

        const batch =
          newCandidates.slice(
            i,
            i +
              INSERT_BATCH_SIZE
          );


        const {
          data,
          error
        } =
          await supabase
            .from(
              "zulu_candidates"
            )
            .insert(
              batch
            )
            .select(
              "id"
            );


        if (
          error
        ) {

          throw error;
        }


        insertedCount +=
          data?.length ||
          0;
      }
    }



    /* ========================================================
       REFRESH EXISTING CANDIDATES
       ========================================================
     *
     * Existing records are NOT reset to "pending".
     *
     * Their current review status is therefore preserved.
     *
     * We simply refresh information that may have changed:
     *
     *     title
     *     displayed source age
     *     estimated upload time
     *     thumbnail
     *     last seen time
     */

    let updatedCount =
      0;


    for (
      const video of
        existingCandidates
    ) {

      const {
        error
      } =
        await supabase
          .from(
            "zulu_candidates"
          )
          .update(
            {

              title:
                video.title,

              source_age:
                video.source_age,

              source_uploaded_at:
                video.source_uploaded_at,

              thumbnail_url:
                video.thumbnail_url,

              last_seen_at:
                currentTimestamp
            }
          )
          .eq(
            "source_url",
            video.source_url
          );


      if (
        error
      ) {

        throw error;
      }


      updatedCount++;
    }



    /* ========================================================
       FINAL SUMMARY
       ======================================================== */

    console.log(
      ""
    );

    console.log(
      "============================================"
    );

    console.log(
      "GAYXFANS CANDIDATE SCRAPE COMPLETE"
    );

    console.log(
      "============================================"
    );

    console.log(
      `Pages checked: ${pageNumber}`
    );

    console.log(
      `Scraped:       ${unique.length}`
    );

    console.log(
      `Inserted:      ${insertedCount}`
    );

    console.log(
      `Updated:       ${updatedCount}`
    );

    console.log(
      "============================================"
    );


  } finally {


    /* --------------------------------------------------------
       ALWAYS CLOSE CHROMIUM
    --------------------------------------------------------
     *
     * Whether the scrape succeeds or fails, make sure the
     * browser is shut down cleanly.
     */

    console.log(
      "Closing Chromium..."
    );

    await browser.close();

  }
}



/* ============================================================
   START THE SCRAPER
   ============================================================
 *
 * Run the main process.
 *
 * If an unexpected fatal error escapes from the scraper:
 *
 *     • print it
 *     • exit with status 1
 *
 * GitHub Actions will then recognise the command as failed.
 * ============================================================ */

run().catch(
  error => {

    console.error(
      ""
    );

    console.error(
      "GAYXFANS SCRAPER FAILED:"
    );

    console.error(
      error
    );

    process.exit(
      1
    );
  }
);
