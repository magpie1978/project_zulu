const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");

const BASE_URL = "https://justthegays.com/";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is not configured.");
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not configured."
  );
}

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


/*
 * ------------------------------------------------------------
 * FETCH + PARSE ONE PAGE
 * ------------------------------------------------------------
 */

async function scrapePage(pageNumber, cutoff, now) {

  const pageUrl =
    pageNumber === 1
      ? BASE_URL
      : `${BASE_URL}page/${pageNumber}/`;

  console.log("");
  console.log(`Fetching page ${pageNumber}: ${pageUrl}`);

  const response = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PornflixCandidateMonitor/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Page ${pageNumber}: HTTP ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();

  console.log(
    `Received ${html.length.toLocaleString()} characters`
  );

  const $ = cheerio.load(html);

  if (pageNumber === 2) {

  console.log("");
  console.log("===== PAGE 2 DEBUG =====");

  console.log(
    `post-grid count: ${$(".post-grid").length}`
  );

  $(".post-grid").each((index, element) => {

    const grid = $(element);

    console.log("");
    console.log(
      `GRID ${index + 1}: ${grid.find(".post-item").length} post-items`
    );

    console.log(
      grid
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 1000)
    );

  });

  console.log("");
  console.log("===== END PAGE 2 DEBUG =====");
  console.log("");

}

  let grid = null;


  /*
   * Page 1 contains the "Latest Videos" heading.
   *
   * Locate its associated post grid so that we don't accidentally
   * scrape another collection of videos elsewhere on the homepage.
   */

  if (pageNumber === 1) {

    let latestHeading = null;

    $("h1, h2, h3, h4").each((_, element) => {

      const text = $(element)
        .text()
        .replace(/\s+/g, " ")
        .trim();

      if (/latest videos/i.test(text)) {
        latestHeading = element;
        return false;
      }

    });

    if (!latestHeading) {
      throw new Error(
        'Could not locate the "Latest Videos" section.'
      );
    }

    const titleWrap =
      $(latestHeading).closest(".widget-title-wrap");

    grid =
      titleWrap.next(".post-grid");

  }
  else {

    /*
     * Paginated archive pages don't necessarily have the
     * "Latest Videos" heading, so use the main video grid.
     */

    grid =
      $(".post-grid").first();

  }


  if (!grid || !grid.length) {
    throw new Error(
      `Could not locate video grid on page ${pageNumber}.`
    );
  }


  const cards =
    grid.find(".post-item");

  console.log(
    `Found ${cards.length} video cards on page ${pageNumber}.`
  );


  const videos = [];

  let oldestTimestamp = null;


  cards.each((_, element) => {

    const card = $(element);

    const titleLink =
      card.find(
        ".post-meta__title a"
      ).first();

    const title =
      titleLink
        .text()
        .replace(/\s+/g, " ")
        .trim();

    const href =
      titleLink.attr("href");

    if (!title || !href) {
      return;
    }


    /*
     * Exact timestamp supplied by the site.
     */

    const time =
      card.find(
        ".post-meta__date time"
      ).first();

    const datetime =
      time.attr("datetime");

    if (!datetime) {
      return;
    }

    const uploaded =
      new Date(
        datetime.replace(" ", "T")
      );

    const uploadedMs =
      uploaded.getTime();

    if (Number.isNaN(uploadedMs)) {
      return;
    }


    if (
      oldestTimestamp === null ||
      uploadedMs < oldestTimestamp
    ) {
      oldestTimestamp = uploadedMs;
    }


    /*
     * Ignore anything outside our 24-hour window.
     */

    if (
      uploadedMs < cutoff ||
      uploadedMs > now
    ) {
      return;
    }


    let sourceUrl;

    try {

      sourceUrl =
        new URL(
          href,
          pageUrl
        ).href;

    }
    catch {

      return;

    }


    const image =
      card.find(
        ".post-thumbnail img"
      ).first();

    const thumbnail =
      image.attr("src") ||
      image.attr("data-src") ||
      null;

    let thumbnailUrl = null;

    if (thumbnail) {

      try {

        thumbnailUrl =
          new URL(
            thumbnail,
            pageUrl
          ).href;

      }
      catch {

        thumbnailUrl = null;

      }

    }


    const sourceAge =
      card.find(
        ".post-meta__date"
      )
        .text()
        .replace(/\s+/g, " ")
        .trim();


    videos.push({

      title,

      source_url:
        sourceUrl,

      source_age:
        sourceAge,

      source_uploaded_at:
        uploaded.toISOString(),

      thumbnail_url:
        thumbnailUrl

    });

  });


  console.log(
    `${videos.length} videos on page ${pageNumber} are within 24 hours.`
  );


  return {
    videos,
    cardCount: cards.length,
    oldestTimestamp
  };

}


/*
 * ------------------------------------------------------------
 * MAIN
 * ------------------------------------------------------------
 */

async function run() {

  const now =
    Date.now();

  const cutoff =
    now - (24 * 60 * 60 * 1000);

  const allVideos = [];

  let pageNumber = 1;

  /*
   * Safety limit. We should normally stop after only a few pages,
   * but this prevents an unexpected site change causing an
   * unlimited crawl.
   */

  const MAX_PAGES = 20;


  while (pageNumber <= MAX_PAGES) {

    const result =
      await scrapePage(
        pageNumber,
        cutoff,
        now
      );


    allVideos.push(
      ...result.videos
    );


    /*
     * No cards means there is nothing further to inspect.
     */

    if (result.cardCount === 0) {

      console.log(
        "No video cards found. Stopping pagination."
      );

      break;

    }


    /*
     * Once a page contains no videos within the last 24 hours,
     * we've reached the older archive.
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


    /*
     * If this page already contains records older than our
     * cutoff, there is no reason to request another page.
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


    pageNumber++;

  }


  /*
   * ------------------------------------------------------------
   * DEDUPLICATE ACROSS ALL PAGES
   * ------------------------------------------------------------
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


  unique.sort(
    (a, b) =>
      new Date(
        b.source_uploaded_at
      ) -
      new Date(
        a.source_uploaded_at
      )
  );


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


  if (!unique.length) {

    console.log(
      "Nothing to write to Supabase."
    );

    return;

  }


  /*
   * ------------------------------------------------------------
   * CHECK EXISTING CANDIDATES
   * ------------------------------------------------------------
   */

  const sourceUrls =
    unique.map(
      video => video.source_url
    );

  const existingRows = [];

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


  /*
   * ------------------------------------------------------------
   * NEW CANDIDATES
   * ------------------------------------------------------------
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
   * ------------------------------------------------------------
   * EXISTING CANDIDATES
   * ------------------------------------------------------------
   */

  const existingCandidates =
    unique.filter(
      video =>
        existingByUrl.has(
          video.source_url
        )
    );


  /*
   * ------------------------------------------------------------
   * INSERT NEW CANDIDATES
   * ------------------------------------------------------------
   */

  let insertedCount = 0;

  if (newCandidates.length) {

    console.log(
      `Inserting ${newCandidates.length} new candidates...`
    );


    /*
     * Insert in batches as the candidate set can now span
     * several source pages.
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


      insertedCount +=
        data?.length || 0;

    }

  }


  /*
   * ------------------------------------------------------------
   * UPDATE EXISTING CANDIDATES
   * ------------------------------------------------------------
   *
   * Status, first_seen_at and reviewed_at are deliberately
   * NOT changed.
   */

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


  /*
   * ------------------------------------------------------------
   * SUMMARY
   * ------------------------------------------------------------
   */

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

}


run().catch(error => {

  console.error("");
  console.error(
    "SCRAPER FAILED:"
  );

  console.error(error);

  process.exit(1);

});
