const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");

const SOURCE_URL = "https://justthegays.com/";

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

async function run() {

  console.log(`Fetching ${SOURCE_URL}`);

  const response = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PornflixCandidateMonitor/1.0)"
    }
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();

  console.log(
    `Received ${html.length.toLocaleString()} characters`
  );

  const $ = cheerio.load(html);

  /*
   * ------------------------------------------------------------
   * FIND LATEST VIDEOS SECTION
   * ------------------------------------------------------------
   */

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

  console.log('Found "Latest Videos" section.');

  const titleWrap =
    $(latestHeading).closest(".widget-title-wrap");

  const grid =
    titleWrap.next(".post-grid");

  if (!grid.length) {
    throw new Error(
      "Could not locate Latest Videos post grid."
    );
  }

  const cards =
    grid.find(".post-item");

  console.log(
    `Found ${cards.length} video cards in Latest Videos.`
  );


  /*
   * ------------------------------------------------------------
   * EXTRACT VIDEOS
   * ------------------------------------------------------------
   */

  const now = Date.now();

  const cutoff =
    now - (24 * 60 * 60 * 1000);

  const videos = [];


  cards.each((_, element) => {

    const card = $(element);

    /*
     * TITLE + VIDEO URL
     */

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
     * UPLOAD DATE
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

    if (
      Number.isNaN(
        uploaded.getTime()
      )
    ) {
      return;
    }


    /*
     * ONLY VIDEOS FROM LAST 24 HOURS
     */

    if (
      uploaded.getTime() < cutoff ||
      uploaded.getTime() > now
    ) {
      return;
    }


    /*
     * SOURCE URL
     */

    let sourceUrl;

    try {

      sourceUrl =
        new URL(
          href,
          SOURCE_URL
        ).href;

    }
    catch {

      return;

    }


    /*
     * THUMBNAIL
     */

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
            SOURCE_URL
          ).href;

      }
      catch {

        thumbnailUrl = null;

      }

    }


    /*
     * DISPLAYED AGE
     */

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


  /*
   * ------------------------------------------------------------
   * REMOVE DUPLICATES
   * ------------------------------------------------------------
   */

  const unique =
    [
      ...new Map(
        videos.map(
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


  console.log(
    `Found ${unique.length} candidate videos <= 24 hours.`
  );


  if (!unique.length) {

    console.log(
      "Nothing to write to Supabase."
    );

    return;

  }


  /*
   * ------------------------------------------------------------
   * CHECK WHICH URLS ALREADY EXIST
   * ------------------------------------------------------------
   *
   * This is deliberate rather than doing a blind upsert.
   *
   * We don't want future scraper runs to reset:
   *
   * status
   * first_seen_at
   * reviewed_at
   *
   * for candidates you have already reviewed.
   */

  const sourceUrls =
    unique.map(
      video => video.source_url
    );

  const {
    data: existingRows,
    error: existingError
  } =
    await supabase
      .from("zulu_candidates")
      .select(
        "id, source_url, status, first_seen_at, reviewed_at"
      )
      .in(
        "source_url",
        sourceUrls
      );

  if (existingError) {
    throw existingError;
  }


  const existingByUrl =
    new Map(
      (existingRows || []).map(
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
   *
   * Only refresh metadata.
   *
   * We DO NOT alter status, reviewed_at or first_seen_at.
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
   * INSERT NEW ROWS
   * ------------------------------------------------------------
   */

  let insertedCount = 0;

  if (newCandidates.length) {

    console.log(
      `Inserting ${newCandidates.length} new candidates...`
    );

    const {
      data,
      error
    } =
      await supabase
        .from("zulu_candidates")
        .insert(
          newCandidates
        )
        .select("id");

    if (error) {
      throw error;
    }

    insertedCount =
      data?.length || 0;

  }


  /*
   * ------------------------------------------------------------
   * UPDATE EXISTING ROWS
   * ------------------------------------------------------------
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
    `Scraped:  ${unique.length}`
  );

  console.log(
    `Inserted: ${insertedCount}`
  );

  console.log(
    `Updated:  ${updatedCount}`
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
