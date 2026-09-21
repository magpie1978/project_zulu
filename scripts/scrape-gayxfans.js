const cheerio =
  require(
    "cheerio"
  );

const {
  createClient
} =
  require(
    "@supabase/supabase-js"
  );


const BASE_URL =
  "https://gayxfans.com/";

const supabaseUrl =
  process.env.SUPABASE_URL;

const supabaseServiceRoleKey =
  process.env
    .SUPABASE_SERVICE_ROLE_KEY;


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


/* ================================================================
   CONFIGURATION
================================================================ */

const WINDOW_HOURS =
  24;


/*
 * This is deliberately conservative for the first run.
 *
 * GayXFans currently places many videos on each page, so only a few
 * pages should be required to cover the most recent 24 hours.
 */
const MAX_PAGES =
  10;


/* ================================================================
   HELPERS
================================================================ */

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


/**
 * Converts GayXFans relative ages such as:
 *
 *     9 hours ago
 *     1 day ago
 *     2 days ago
 *     1 week ago
 *
 * into an approximate timestamp.
 *
 * The original text is still retained in source_age.
 */
function relativeAgeToTimestamp(
  ageText,
  now
) {

  const text =
    cleanText(
      ageText
    ).toLowerCase();


  if (
    !text
  ) {

    return null;
  }


  if (
    text === "just now"
  ) {

    return now;
  }


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
     * These are approximate by definition because the site itself only
     * supplies a relative month/year label.
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


  return (
    now -
    (
      amount *
      multiplier
    )
  );
}


/**
 * GayXFans cards expose their age as ordinary text rather than a
 * machine-readable datetime.
 *
 * Find the relative-age expression inside the card.
 */
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


  /*
   * The upload age is normally the final relative-time expression
   * shown in the card.
   */
  return matches[
    matches.length - 1
  ];
}


/**
 * Returns the most likely thumbnail URL from a video card.
 */
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


/* ================================================================
   FETCH + PARSE ONE PAGE
================================================================ */

async function scrapePage(
  pageNumber,
  cutoff,
  now
) {

  /*
   * The site's pagination links use its Latest/archive navigation.
   *
   * Page 1 can safely be read from the homepage because it contains
   * the New Videos / Latest collection.
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


  const response =
    await fetch(
      pageUrl,
      {
        headers: {

          "User-Agent":
            "Mozilla/5.0 (compatible; PornflixCandidateMonitor/1.0)",

          "Accept":
            "text/html,application/xhtml+xml",

          "Accept-Language":
            "en-GB,en;q=0.9",

          "Cache-Control":
            "no-cache"
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `GayXFans page ${pageNumber}: HTTP ${response.status} ${response.statusText}`
    );
  }


  const html =
    await response.text();


  console.log(
    `Received ${html.length.toLocaleString()} characters`
  );


  const $ =
    cheerio.load(
      html
    );


  /*
   * Find links to actual video watch pages.
   *
   * Current GayXFans video URLs use /watch/{id}/...
   */
  const videoLinks =
    $(
      'a[href*="/watch/"]'
    );


  console.log(
    `Found ${videoLinks.length} candidate watch links.`
  );


  const videos = [];

  const seenOnPage =
    new Set();

  let oldestTimestamp =
    null;


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


      if (
        !href
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

      } catch {

        return;
      }


      /*
       * The same video may have more than one clickable element inside
       * its card. Only process each watch URL once.
       */
      if (
        seenOnPage.has(
          sourceUrl
        )
      ) {

        return;
      }


      /*
       * Move upward to the smallest useful container containing the
       * video's metadata.
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


      if (
        !card.length
      ) {

        return;
      }


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
       * Restrict this source to the same 24-hour candidate window used
       * by JustTheGays.
       */
      if (
        uploadedMs <
          cutoff ||
        uploadedMs >
          now
      ) {

        return;
      }


      /*
       * Prefer explicit title attributes, then image alt text, then
       * visible link text.
       */
      const image =
        card.find(
          "img"
        ).first();


      let title =
        cleanText(
          link.attr(
            "title"
          )
        );


      if (
        !title
      ) {

        title =
          cleanText(
            image.attr(
              "alt"
            )
          );
      }


      if (
        !title
      ) {

        title =
          cleanText(
            link.text()
          );
      }


      /*
       * If this particular anchor is the thumbnail link, another watch
       * link in the same card may contain the human-readable title.
       */
      if (
        !title
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

                title =
                  candidateTitle;

                return false;
              }
            }
          );
      }


      if (
        !title
      ) {

        return;
      }


      const thumbnailUrl =
        extractThumbnailUrl(
          $,
          card,
          pageUrl
        );


      seenOnPage.add(
        sourceUrl
      );


      videos.push(
        {

          title,

          source_url:
            sourceUrl,

          source_age:
            sourceAge,

          source_uploaded_at:
            new Date(
              uploadedMs
            ).toISOString(),

          thumbnail_url:
            thumbnailUrl
        }
      );
    }
  );


  console.log(
    `${videos.length} GayXFans videos on page ${pageNumber} are within ${WINDOW_HOURS} hours.`
  );


  return {
    videos,

    linkCount:
      videoLinks.length,

    oldestTimestamp
  };
}


/* ================================================================
   MAIN
================================================================ */

async function run() {

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


  const allVideos =
    [];


  let pageNumber =
    1;


  while (
    pageNumber <=
      MAX_PAGES
  ) {

    const result =
      await scrapePage(
        pageNumber,
        cutoff,
        now
      );


    allVideos.push(
      ...result.videos
    );


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
     * Once the page has moved beyond our 24-hour window there is no
     * reason to continue crawling older pages.
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


    pageNumber++;

  }


  /* ==============================================================
     DEDUPLICATE SCRAPED RESULTS
  ============================================================== */

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


  if (
    !unique.length
  ) {

    console.log(
      "Nothing to write to Supabase."
    );

    return;
  }


  /* ==============================================================
     CHECK EXISTING CANDIDATES
  ============================================================== */

  const sourceUrls =
    unique.map(
      video =>
        video.source_url
    );


  const existingRows =
    [];


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


  /* ==============================================================
     NEW CANDIDATES
  ============================================================== */

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


  const existingCandidates =
    unique.filter(
      video =>
        existingByUrl.has(
          video.source_url
        )
    );


  /* ==============================================================
     INSERT NEW
  ============================================================== */

  let insertedCount =
    0;


  if (
    newCandidates.length
  ) {

    console.log(
      `Inserting ${newCandidates.length} new GayXFans candidates...`
    );


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


  /* ==============================================================
     UPDATE EXISTING
  ============================================================== */

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


  /* ==============================================================
     SUMMARY
  ============================================================== */

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
}


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
