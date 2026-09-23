/*
 * ============================================================
 * JUSTTHEGAYS CANDIDATE SCRAPER
 * ============================================================
 *
 * PURPOSE
 * -------
 * This script checks JustTheGays for videos uploaded during
 * the last 24 hours and adds them to the Pornflix candidate
 * system.
 *
 * It is a DISCOVERY tool.
 *
 * It does NOT download the actual video and it does NOT add
 * the video directly to the main Pornflix collection.
 *
 * Instead, the process is:
 *
 *     JustTheGays
 *          ↓
 *     Find recently uploaded videos
 *          ↓
 *     Extract basic information
 *          ↓
 *     Check zulu_candidates
 *          ↓
 *     Add new candidates as "pending"
 *
 *
 * For each video we try to collect:
 *
 *     • title
 *     • JustTheGays page URL
 *     • upload date/time
 *     • displayed age/date text
 *     • thumbnail
 *
 *
 * The scraper automatically moves through additional pages
 * until it reaches videos older than 24 hours.
 *
 * Existing candidates are NOT duplicated. Instead, their
 * current information and "last seen" time are refreshed.
 * ============================================================
 */


/* ------------------------------------------------------------
   REQUIRED PACKAGES
------------------------------------------------------------ */

/*
 * Cheerio lets us load HTML and search through it using CSS
 * selectors.
 *
 * It performs a similar job to jQuery, but here it runs inside
 * Node.js rather than inside a browser.
 */

const cheerio = require("cheerio");


/*
 * Supabase client.
 *
 * This allows the scraper to check and update the
 * zulu_candidates database table.
 */

const { createClient } = require("@supabase/supabase-js");



/* ------------------------------------------------------------
   JUSTTHEGAYS ADDRESS
------------------------------------------------------------ */

/*
 * This is the starting point for the scrape.
 *
 * Page 1:
 *
 *     https://justthegays.com/
 *
 * Later pages are constructed as:
 *
 *     https://justthegays.com/page/2/
 *     https://justthegays.com/page/3/
 *     etc.
 */

const BASE_URL = "https://justthegays.com/";



/* ------------------------------------------------------------
   SUPABASE CREDENTIALS
------------------------------------------------------------ */

/*
 * Read the database connection details from environment
 * variables.
 *
 * When this runs through GitHub Actions, these values come
 * securely from GitHub Secrets.
 *
 * The sensitive Service Role key therefore does NOT have to be
 * written directly into this file.
 */

const supabaseUrl = process.env.SUPABASE_URL;

const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/*
 * Stop immediately if either required setting is missing.
 */

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is not configured.");
}


if (!supabaseServiceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not configured."
  );
}



/* ------------------------------------------------------------
   CONNECT TO SUPABASE
------------------------------------------------------------ */

/*
 * Create the Supabase connection that will be used throughout
 * the scraper.
 *
 * Session persistence and automatic token refreshing aren't
 * required because this is a short-lived server-side script,
 * not a user logging into a website.
 */

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);



/* ============================================================
   SCRAPE ONE JUSTTHEGAYS PAGE
   ============================================================
 *
 * This function deals with ONE page of JustTheGays.
 *
 * It:
 *
 *     1. downloads the page
 *     2. identifies the correct video grid
 *     3. finds the individual video cards
 *     4. extracts their information
 *     5. keeps only videos from the last 24 hours
 *
 * It then returns those videos to the main program.
 * ============================================================ */

async function scrapePage(pageNumber, cutoff, now) {


  /* ----------------------------------------------------------
     WORK OUT WHICH PAGE TO DOWNLOAD
  ---------------------------------------------------------- */

  const pageUrl =
    pageNumber === 1
      ? BASE_URL
      : `${BASE_URL}page/${pageNumber}/`;


  console.log("");

  console.log(
    `Fetching page ${pageNumber}: ${pageUrl}`
  );



  /* ----------------------------------------------------------
     DOWNLOAD THE HTML
  ----------------------------------------------------------
   *
   * Unlike GayXFans, this scraper does not need to launch a
   * complete Chromium browser.
   *
   * A normal HTTP request is sufficient to obtain the HTML
   * containing the video listings.
   */

  const response = await fetch(pageUrl, {
    headers: {

      /*
       * Identify this program when making the request.
       */

      "User-Agent":
        "Mozilla/5.0 (compatible; PornflixCandidateMonitor/1.0)"
    }
  });



  /* ----------------------------------------------------------
     CHECK THAT THE PAGE LOADED
  ----------------------------------------------------------
   *
   * If JustTheGays returns an HTTP error, stop processing this
   * page rather than trying to parse an error page.
   *
   * Some common HTTP codes:
   *
   *     200 = OK
   *     403 = forbidden
   *     404 = page not found
   *     429 = too many requests
   *     500 = server error
   */

  if (!response.ok) {
    throw new Error(
      `Page ${pageNumber}: HTTP ${response.status} ${response.statusText}`
    );
  }



  /* ----------------------------------------------------------
     LOAD THE HTML
  ---------------------------------------------------------- */

  const html = await response.text();


  /*
   * Display how much HTML was received.
   *
   * This can be useful diagnostically if the website suddenly
   * starts returning an unexpectedly small or different page.
   */

  console.log(
    `Received ${html.length.toLocaleString()} characters`
  );


  /*
   * Load the HTML into Cheerio.
   *
   * "$" can now be used to search the page using CSS
   * selectors.
   */

  const $ = cheerio.load(html);


  /*
   * This will eventually contain the particular video grid
   * that we want to scrape.
   */

  let grid = null;



  /* ==========================================================
     FIND THE CORRECT VIDEO GRID
     ==========================================================
   *
   * JustTheGays contains more than one collection/grid of
   * videos.
   *
   * We don't want to accidentally collect recommendations or
   * some other video collection.
   *
   * Page 1 and archive pages are structured differently, so
   * we use two different methods.
   * ========================================================== */


  /* ----------------------------------------------------------
     PAGE 1 — FIND "LATEST VIDEOS"
  ---------------------------------------------------------- */

  if (pageNumber === 1) {

    let latestHeading = null;


    /*
     * Search the page's headings for one containing:
     *
     *     Latest Videos
     */

    $("h1, h2, h3, h4").each((_, element) => {

      const text = $(element)
        .text()
        .replace(/\s+/g, " ")
        .trim();


      if (/latest videos/i.test(text)) {

        latestHeading = element;

        /*
         * Returning false tells Cheerio that we've found what
         * we need and can stop searching the headings.
         */

        return false;
      }

    });


    /*
     * If this heading disappears, the site's structure may
     * have changed.
     *
     * Stop rather than accidentally scraping the wrong grid.
     */

    if (!latestHeading) {
      throw new Error(
        'Could not locate the "Latest Videos" section.'
      );
    }


    /*
     * Find the wrapper containing the "Latest Videos" heading.
     */

    const titleWrap =
      $(latestHeading).closest(".widget-title-wrap");


    /*
     * The video grid immediately following that heading is the
     * one we want.
     */

    grid =
      titleWrap.next(".post-grid");

  }


  /* ----------------------------------------------------------
     PAGE 2+ — FIND THE MAIN ARCHIVE GRID
  ---------------------------------------------------------- */

  else {

    /*
     * Archive pages can contain several ".post-grid" elements.
     *
     * The main video archive should contain considerably more
     * video cards than small recommendation/sidebar grids.
     *
     * Therefore we select whichever grid contains the largest
     * number of ".post-item" elements.
     */

    let largestGrid = null;

    let largestCount = 0;


    $(".post-grid").each((_, element) => {

      const candidateGrid =
        $(element);


      const count =
        candidateGrid.find(
          ".post-item"
        ).length;


      /*
       * If this grid is larger than our previous best match,
       * remember it.
       */

      if (count > largestCount) {

        largestCount = count;

        largestGrid = element;

      }

    });


    /*
     * Convert the selected HTML element back into a Cheerio
     * object.
     *
     * If nothing was found, use an empty Cheerio selection.
     */

    grid =
      largestGrid
        ? $(largestGrid)
        : $();

  }



  /* ----------------------------------------------------------
     MAKE SURE WE FOUND A GRID
  ---------------------------------------------------------- */

  if (!grid || !grid.length) {
    throw new Error(
      `Could not locate video grid on page ${pageNumber}.`
    );
  }



  /* ----------------------------------------------------------
     FIND THE INDIVIDUAL VIDEO CARDS
  ---------------------------------------------------------- */

  const cards =
    grid.find(".post-item");


  console.log(
    `Found ${cards.length} video cards on page ${pageNumber}.`
  );


  /*
   * Qualifying videos from this page will be stored here.
   */

  const videos = [];


  /*
   * Remember the oldest upload time encountered on this page.
   *
   * The pagination system later uses this to decide whether
   * we've reached videos older than our 24-hour window.
   */

  let oldestTimestamp = null;



  /* ==========================================================
     EXAMINE EACH VIDEO CARD
     ========================================================== */

  cards.each((_, element) => {

    const card = $(element);



    /* --------------------------------------------------------
       GET THE TITLE AND VIDEO PAGE URL
    -------------------------------------------------------- */

    const titleLink =
      card.find(
        ".post-meta__title a"
      ).first();


    /*
     * Extract the visible title and tidy unnecessary spaces.
     */

    const title =
      titleLink
        .text()
        .replace(/\s+/g, " ")
        .trim();


    /*
     * Extract the link to the individual JustTheGays video
     * page.
     */

    const href =
      titleLink.attr("href");


    /*
     * Without both a title and URL, this isn't a useful
     * candidate.
     */

    if (!title || !href) {
      return;
    }



    /* --------------------------------------------------------
       GET THE EXACT UPLOAD DATE/TIME
    --------------------------------------------------------
     *
     * JustTheGays provides a <time> element containing a
     * machine-readable "datetime" value.
     *
     * This is better than estimating an upload time from text
     * such as "5 hours ago".
     */

    const time =
      card.find(
        ".post-meta__date time"
      ).first();


    const datetime =
      time.attr("datetime");


    // No usable date = skip this card.

    if (!datetime) {
      return;
    }


    /*
     * Convert the site's date into a JavaScript Date object.
     *
     * The space is replaced by "T" to make the value more
     * suitable for standard ISO-style date parsing.
     */

    const uploaded =
      new Date(
        datetime.replace(" ", "T")
      );


    const uploadedMs =
      uploaded.getTime();


    /*
     * If JavaScript couldn't understand the supplied date,
     * ignore this video.
     */

    if (Number.isNaN(uploadedMs)) {
      return;
    }



    /* --------------------------------------------------------
       REMEMBER THE OLDEST VIDEO ON THIS PAGE
    -------------------------------------------------------- */

    if (
      oldestTimestamp === null ||
      uploadedMs < oldestTimestamp
    ) {

      oldestTimestamp = uploadedMs;
    }



    /* --------------------------------------------------------
       ONLY KEEP VIDEOS FROM THE LAST 24 HOURS
    --------------------------------------------------------
     *
     * Reject anything:
     *
     *     older than our cutoff
     *
     * OR
     *
     *     somehow dated in the future
     */

    if (
      uploadedMs < cutoff ||
      uploadedMs > now
    ) {

      return;
    }



    /* --------------------------------------------------------
       BUILD A COMPLETE SOURCE URL
    --------------------------------------------------------
     *
     * The site's HTML might contain either:
     *
     *     https://justthegays.com/video/123/
     *
     * or a relative URL.
     *
     * new URL() safely converts either into a complete address.
     */

    let sourceUrl;


    try {

      sourceUrl =
        new URL(
          href,
          pageUrl
        ).href;

    }
    catch {

      // Bad URL — ignore this card.

      return;

    }



    /* --------------------------------------------------------
       FIND THE THUMBNAIL
    -------------------------------------------------------- */

    const image =
      card.find(
        ".post-thumbnail img"
      ).first();


    /*
     * Try the normal image source first.
     *
     * If the website is lazy-loading images, try data-src.
     */

    const thumbnail =
      image.attr("src") ||
      image.attr("data-src") ||
      null;


    let thumbnailUrl = null;


    if (thumbnail) {

      try {

        /*
         * Convert relative thumbnail addresses into complete
         * URLs.
         */

        thumbnailUrl =
          new URL(
            thumbnail,
            pageUrl
          ).href;

      }
      catch {

        /*
         * A broken thumbnail shouldn't prevent the candidate
         * itself from being recorded.
         */

        thumbnailUrl = null;

      }

    }



    /* --------------------------------------------------------
       SAVE THE DISPLAYED DATE/AGE TEXT TOO
    --------------------------------------------------------
     *
     * In addition to the exact timestamp, retain whatever text
     * JustTheGays displays to the user in the date area.
     */

    const sourceAge =
      card.find(
        ".post-meta__date"
      )
        .text()
        .replace(/\s+/g, " ")
        .trim();



    /* --------------------------------------------------------
       ADD THIS VIDEO TO OUR RESULTS
    -------------------------------------------------------- */

    videos.push({

      // Video title.
      title,


      // JustTheGays page for the video.
      source_url:
        sourceUrl,


      // Human-readable date/age displayed by the source site.
      source_age:
        sourceAge,


      // Exact upload time converted into standard ISO format.
      source_uploaded_at:
        uploaded.toISOString(),


      // Thumbnail URL, if available.
      thumbnail_url:
        thumbnailUrl

    });

  });



  /* ----------------------------------------------------------
     REPORT THIS PAGE'S RESULT
  ---------------------------------------------------------- */

  console.log(
    `${videos.length} videos on page ${pageNumber} are within 24 hours.`
  );


  /*
   * Return:
   *
   *     videos
   *         qualifying videos
   *
   *     cardCount
   *         how many total cards existed on the page
   *
   *     oldestTimestamp
   *         oldest upload encountered
   *
   * The main program uses the latter two values to decide
   * whether another page needs to be requested.
   */

  return {
    videos,
    cardCount: cards.length,
    oldestTimestamp
  };

}



/* ============================================================
   MAIN SCRAPER
   ============================================================
 *
 * Everything above deals with ONE page.
 *
 * run() manages the complete scrape:
 *
 *     • calculate our 24-hour window
 *     • scrape as many pages as necessary
 *     • remove duplicates
 *     • compare with Supabase
 *     • insert new candidates
 *     • update existing candidates
 * ============================================================ */

async function run() {



  /* ----------------------------------------------------------
     CALCULATE THE TIME WINDOW
  ---------------------------------------------------------- */

  const now =
    Date.now();


  /*
   * Our cutoff is exactly 24 hours before the script started.
   */

  const cutoff =
    now - (24 * 60 * 60 * 1000);


  /*
   * Results from all pages are collected here.
   */

  const allVideos = [];


  // Start on page 1.

  let pageNumber = 1;



  /* ----------------------------------------------------------
     ABSOLUTE PAGINATION SAFETY LIMIT
  ----------------------------------------------------------
   *
   * Normally the scraper should stop after only a few pages
   * because it will quickly reach videos older than 24 hours.
   *
   * However, this prevents a future website change from
   * accidentally causing a very large/unlimited crawl.
   */

  const MAX_PAGES = 20;



  /* ==========================================================
     SCRAPE PAGE AFTER PAGE
     ========================================================== */

  while (pageNumber <= MAX_PAGES) {


    const result =
      await scrapePage(
        pageNumber,
        cutoff,
        now
      );


    /*
     * Add this page's qualifying videos to our combined list.
     */

    allVideos.push(
      ...result.videos
    );



    /* --------------------------------------------------------
       STOP CONDITION 1 — NO VIDEO CARDS
    --------------------------------------------------------
     *
     * If the page doesn't contain any video cards at all,
     * there is nothing more to inspect.
     */

    if (result.cardCount === 0) {

      console.log(
        "No video cards found. Stopping pagination."
      );

      break;

    }



    /* --------------------------------------------------------
       STOP CONDITION 2 — NO RECENT VIDEOS
    --------------------------------------------------------
     *
     * If this entire page contains no videos from the last
     * 24 hours, we've reached the older archive.
     */

    if (result.videos.length === 0) {

      console.log(
        `Page ${pageNumber} contains no videos within 24 hours.`
      );

      console.log(
        "Stopping pagination."
      );

      break;

    }



    /* --------------------------------------------------------
       STOP CONDITION 3 — PAGE HAS REACHED THE CUTOFF
    --------------------------------------------------------
     *
     * Even if this page contains some recent videos, its oldest
     * card might already be more than 24 hours old.
     *
     * If so, another page isn't necessary because subsequent
     * pages should be even older.
     */

    if (
      result.oldestTimestamp !== null &&
      result.oldestTimestamp < cutoff
    ) {

      console.log(
        `Page ${pageNumber} has reached videos older than 24 hours.`
      );

      console.log(
        "Stopping pagination."
      );

      break;

    }



    // Otherwise continue to the next archive page.

    pageNumber++;

  }



  /* ==========================================================
     REMOVE DUPLICATES
     ==========================================================
   *
   * The same video could theoretically be encountered more
   * than once across the pages.
   *
   * Use source_url as the unique identifier.
   * ========================================================== */

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



  /* ----------------------------------------------------------
     SORT NEWEST FIRST
  ---------------------------------------------------------- */

  unique.sort(
    (a, b) =>
      new Date(
        b.source_uploaded_at
      ) -
      new Date(
        a.source_uploaded_at
      )
  );



  /* ----------------------------------------------------------
     REPORT HOW MANY UNIQUE RECENT VIDEOS WE FOUND
  ---------------------------------------------------------- */

  console.log("");

  console.log(
    "============================================"
  );

  console.log(
    `TOTAL UNIQUE CANDIDATES <= 24 HOURS: ${unique.length}`
  );

  console.log(
    "============================================"
  );



  /* ----------------------------------------------------------
     NOTHING FOUND?
  ---------------------------------------------------------- */

  if (!unique.length) {

    console.log(
      "Nothing to write to Supabase."
    );

    return;

  }



  /* ==========================================================
     CHECK WHICH CANDIDATES ALREADY EXIST
     ==========================================================
   *
   * Before inserting anything, compare the discovered source
   * URLs with zulu_candidates.
   *
   * This separates them into:
   *
   *     NEW
   *       → INSERT
   *
   *     ALREADY EXISTS
   *       → UPDATE
   * ========================================================== */

  const sourceUrls =
    unique.map(
      video => video.source_url
    );


  const existingRows = [];


  /*
   * Check 25 URLs at a time rather than constructing one huge
   * database query.
   */

  const LOOKUP_BATCH_SIZE = 25;


  for (
    let i = 0;
    i < sourceUrls.length;
    i += LOOKUP_BATCH_SIZE
  ) {

    const batch =
      sourceUrls.slice(
        i,
        i + LOOKUP_BATCH_SIZE
      );


    console.log(
      `Checking existing candidates ${i + 1}-${Math.min(
        i + LOOKUP_BATCH_SIZE,
        sourceUrls.length
      )} of ${sourceUrls.length}...`
    );


    /*
     * Ask Supabase which of these URLs already exist.
     */

    const {
      data,
      error
    } =
      await supabase
        .from("zulu_candidates")
        .select(
          "id, source_url, status, first_seen_at, reviewed_at"
        )
        .in(
          "source_url",
          batch
        );


    if (error) {
      throw error;
    }


    if (data) {
      existingRows.push(...data);
    }

  }



  /* ----------------------------------------------------------
     BUILD A QUICK LOOKUP TABLE
  ----------------------------------------------------------
   *
   * This Map lets us quickly ask whether a particular URL
   * already exists in Supabase.
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


  /*
   * Use the same timestamp for all database changes made
   * during this run.
   */

  const currentTimestamp =
    new Date().toISOString();



  /* ==========================================================
     PREPARE NEW CANDIDATES
     ==========================================================
   *
   * Anything whose source URL isn't already in Supabase is
   * considered newly discovered.
   *
   * New records start with:
   *
   *     status = "pending"
   *
   * This sends them into the normal candidate review process.
   * ========================================================== */

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

          /*
           * New discoveries have not yet been reviewed.
           */
          status:
            "pending",

          /*
           * When Pornflix first discovered this candidate.
           */
          first_seen_at:
            currentTimestamp,

          /*
           * Most recent time the scraper saw it.
           */
          last_seen_at:
            currentTimestamp

        })
      );



  /* ==========================================================
     IDENTIFY EXISTING CANDIDATES
     ========================================================== */

  const existingCandidates =
    unique.filter(
      video =>
        existingByUrl.has(
          video.source_url
        )
    );



  /* ==========================================================
     INSERT BRAND-NEW CANDIDATES
     ========================================================== */

  let insertedCount = 0;


  if (newCandidates.length) {

    console.log(
      `Inserting ${newCandidates.length} new candidates...`
    );


    /*
     * Insert in batches of 100.
     *
     * This keeps the database requests manageable if a scrape
     * discovers a particularly large number of videos.
     */

    const INSERT_BATCH_SIZE = 100;


    for (
      let i = 0;
      i < newCandidates.length;
      i += INSERT_BATCH_SIZE
    ) {

      const batch =
        newCandidates.slice(
          i,
          i + INSERT_BATCH_SIZE
        );


      const {
        data,
        error
      } =
        await supabase
          .from("zulu_candidates")
          .insert(batch)
          .select("id");


      if (error) {
        throw error;
      }


      /*
       * Count how many rows Supabase confirms were inserted.
       */

      insertedCount +=
        data?.length || 0;

    }

  }



  /* ==========================================================
     UPDATE CANDIDATES WE ALREADY KNOW ABOUT
     ==========================================================
   *
   * IMPORTANT:
   *
   * Existing records are NOT sent back to "pending".
   *
   * We deliberately leave these fields alone:
   *
   *     status
   *     first_seen_at
   *     reviewed_at
   *
   * Therefore an already accepted/rejected/reviewed candidate
   * keeps its existing review state.
   *
   * We only refresh information that may have changed on the
   * source website.
   * ========================================================== */

  let updatedCount = 0;


  for (
    const video of existingCandidates
  ) {

    const {
      error
    } =
      await supabase
        .from("zulu_candidates")
        .update({

          // Latest title seen on the source website.
          title:
            video.title,

          // Latest displayed source age/date.
          source_age:
            video.source_age,

          // Exact upload timestamp.
          source_uploaded_at:
            video.source_uploaded_at,

          // Latest thumbnail address.
          thumbnail_url:
            video.thumbnail_url,

          // Record that we saw this candidate again today.
          last_seen_at:
            currentTimestamp

        })
        .eq(
          "source_url",
          video.source_url
        );


    if (error) {
      throw error;
    }


    updatedCount++;

  }



  /* ==========================================================
     FINAL SUMMARY
     ========================================================== */

  console.log("");

  console.log(
    "============================================"
  );

  console.log(
    "CANDIDATE SCRAPE COMPLETE"
  );

  console.log(
    "============================================"
  );


  // How many JustTheGays pages were examined.

  console.log(
    `Pages checked: ${pageNumber}`
  );


  // Total number of unique recent videos discovered.

  console.log(
    `Scraped:       ${unique.length}`
  );


  // Number that were completely new to Pornflix.

  console.log(
    `Inserted:      ${insertedCount}`
  );


  // Number already known and therefore refreshed.

  console.log(
    `Updated:       ${updatedCount}`
  );


  console.log(
    "============================================"
  );

}



/* ============================================================
   START THE SCRAPER
   ============================================================
 *
 * Everything above defines how the scraper works.
 *
 * This actually starts it.
 * ============================================================ */

run().catch(error => {


  /*
   * If an unexpected fatal error reaches this point, print it
   * clearly in the GitHub Actions log.
   */

  console.error("");

  console.error(
    "SCRAPER FAILED:"
  );

  console.error(error);


  /*
   * Exit with status 1.
   *
   * This tells GitHub Actions that the command failed.
   *
   *     0 = success
   *     1 = failure
   */

  process.exit(1);

});
