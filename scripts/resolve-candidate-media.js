const { createClient } = require("@supabase/supabase-js");
const cheerio = require("cheerio");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 Chrome/153 Safari/537.36";


async function resolveCandidate(candidate) {

  console.log("");
  console.log("----------------------------------------");
  console.log(`Candidate ${candidate.id}`);
  console.log(candidate.title);
  console.log(candidate.source_url);

let pageUrl =
  candidate.source_url;

let pageResponse = null;

const MAX_REDIRECTS = 5;

for (
  let redirectCount = 0;
  redirectCount <= MAX_REDIRECTS;
  redirectCount++
) {

  console.log(
    `Fetching page: ${pageUrl}`
  );

  pageResponse =
    await fetch(
      pageUrl,
      {
        headers: {
          "User-Agent":
            USER_AGENT,

          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "Accept-Language":
            "en-GB,en;q=0.9",

          "Cache-Control":
            "no-cache"
        },

        redirect:
          "manual"
      }
    );


  console.log(
    `Page response: HTTP ${pageResponse.status}`
  );


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

    const location =
      pageResponse.headers.get(
        "location"
      );


    if (
      !location
    ) {

      throw new Error(
        `HTTP ${pageResponse.status} redirect had no Location header`
      );
    }


    const nextUrl =
      new URL(
        location,
        pageUrl
      ).href;


    console.log(
      `Redirect → ${nextUrl}`
    );


    pageUrl =
      nextUrl;


    continue;
  }


  break;
}


if (
  !pageResponse
) {

  throw new Error(
    "No response received from candidate page"
  );
}


if (
  !pageResponse.ok
) {

  throw new Error(
    `Page returned HTTP ${pageResponse.status} (${pageUrl})`
  );
}


console.log(
  `Final page URL: ${pageUrl}`
);

  
  const html = await pageResponse.text();

  const $ = cheerio.load(html);

  /*
   * IMPORTANT:
   *
   * Do not search the entire page for an MP4.
   * Recommended videos elsewhere on the page can also contain MP4 URLs.
   *
   * We specifically want the source belonging to the main video player.
   */

  let mediaUrl =
    $("#video_kgvid_0 source[type='video/mp4']")
      .first()
      .attr("src");

  /*
   * Slightly more tolerant fallback in case the player ID changes,
   * while still remaining inside the main player area.
   */

  if (!mediaUrl) {
    mediaUrl =
      $(".player-embed video source[type='video/mp4']")
        .first()
        .attr("src");
  }

  if (!mediaUrl) {
    throw new Error(
      "Could not locate main MP4 source"
    );
  }

mediaUrl = new URL(
  mediaUrl,
  pageUrl
).href;

  console.log(`Media URL: ${mediaUrl}`);


  /* ------------------------------------------------------------
     GET FILE METADATA
  ------------------------------------------------------------ */

  let mediaSize = null;
  let mediaContentType = null;

  try {

    const headResponse = await fetch(mediaUrl, {
      method: "HEAD",
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": candidate.source_url
      },
      redirect: "follow"
    });

    console.log(
      `Media HEAD: HTTP ${headResponse.status}`
    );

    if (headResponse.ok) {

      const length =
        headResponse.headers.get("content-length");

      const type =
        headResponse.headers.get("content-type");

      if (length && /^\d+$/.test(length)) {
        mediaSize = Number(length);
      }

      if (type) {
        mediaContentType = type;
      }
    }

  } catch (error) {

    console.warn(
      `HEAD request failed: ${error.message}`
    );
  }


  /* ------------------------------------------------------------
     FILENAME
  ------------------------------------------------------------ */

  const pathname =
    new URL(mediaUrl).pathname;

  const mediaFilename =
    decodeURIComponent(
      pathname.split("/").pop() || ""
    );


  /* ------------------------------------------------------------
     SAVE RESULT
  ------------------------------------------------------------ */

  const { error } = await supabase
    .from("zulu_candidates")
    .update({
      media_url: mediaUrl,
      media_filename: mediaFilename,
      media_size_bytes: mediaSize,
      media_content_type: mediaContentType,
      media_resolved_at:
        new Date().toISOString()
    })
    .eq("id", candidate.id);

  if (error) {
    throw error;
  }

  console.log(`Filename: ${mediaFilename}`);

  if (mediaSize !== null) {
    console.log(
      `Size: ${mediaSize.toLocaleString()} bytes`
    );
  } else {
    console.log("Size: unknown");
  }

  console.log(
    `Content-Type: ${mediaContentType || "unknown"}`
  );

  console.log("Saved.");
}


async function main() {

  console.log(
    "Looking for accepted unresolved candidates..."
  );

  const { data: candidates, error } =
    await supabase
      .from("zulu_candidates")
      .select(`
        id,
        title,
        source_url
      `)
      .eq("status", "accepted")
      .is("media_url", null)
      .order("reviewed_at", {
        ascending: true
      });

  if (error) {
    throw error;
  }

  console.log(
    `Found ${candidates.length} candidate(s).`
  );

  if (!candidates.length) {
    return;
  }

  let resolved = 0;
  let failed = 0;

  for (const candidate of candidates) {

    try {

      await resolveCandidate(candidate);

      resolved++;

    } catch (error) {

      failed++;

      console.error(
        `Candidate ${candidate.id} FAILED:`,
        error.message
      );
    }
  }

  console.log("");
  console.log("========================================");
  console.log("COMPLETE");
  console.log("========================================");
  console.log(`Resolved: ${resolved}`);
  console.log(`Failed:   ${failed}`);
}


main().catch(error => {
  console.error(error);
  process.exit(1);
});
