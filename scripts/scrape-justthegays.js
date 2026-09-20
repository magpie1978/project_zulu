const cheerio = require("cheerio");

const SOURCE_URL = "https://justthegays.com/";

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
   * Find the Latest Videos heading.
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

  /*
   * The site's structure is:
   *
   * widget-title-wrap
   * post-grid
   *   row
   *     post-item
   *       article
   */

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
     * EXACT UPLOAD DATE
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


    /*
     * JustTheGays provides:
     *
     * 2026-09-19 16:51:22
     *
     * Convert it into an ISO-compatible format.
     */

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
     * Only videos uploaded during
     * the previous 24 hours.
     */

    if (
      uploaded.getTime() < cutoff ||
      uploaded.getTime() > now
    ) {
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


    /*
     * RELATIVE AGE
     */

    const dateContainer =
      card.find(
        ".post-meta__date"
      );

    const sourceAge =
      dateContainer
        .text()
        .replace(/\s+/g, " ")
        .trim();


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
   * Deduplicate by source URL.
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


  /*
   * Newest first.
   */

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
    `FOUND ${unique.length} VIDEOS <= 24 HOURS`
  );

  console.log(
    "============================================"
  );


  unique.forEach(
    (video, index) => {

      console.log("");

      console.log(
        `${index + 1}. ${video.title}`
      );

      console.log(
        `   Uploaded: ${video.source_uploaded_at}`
      );

      console.log(
        `   Age: ${video.source_age}`
      );

      console.log(
        `   URL: ${video.source_url}`
      );

      if (
        video.thumbnail_url
      ) {

        console.log(
          `   Thumbnail: ${video.thumbnail_url}`
        );

      }

    }
  );


  console.log("");
  console.log(
    "TEST MODE — nothing written to Supabase."
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
