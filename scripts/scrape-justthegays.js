const cheerio = require("cheerio");

const SOURCE_URL = "https://justthegays.com/";

function parseAge(text) {
  const match = text.match(
    /(\d+)\s+(minute|minutes|hour|hours|day|days)\s+ago/i
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  let hours;

  if (unit.startsWith("minute")) {
    hours = amount / 60;
  } else if (unit.startsWith("hour")) {
    hours = amount;
  } else if (unit.startsWith("day")) {
    hours = amount * 24;
  } else {
    return null;
  }

  return {
    text: match[0],
    hours
  };
}

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
   * Locate the Latest Videos heading.
   */
  let heading;

  $("h1, h2, h3, h4").each((_, element) => {
    const text = $(element)
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (/latest videos/i.test(text)) {
      heading = element;
      return false;
    }
  });

  if (!heading) {
    throw new Error(
      'Could not locate the "Latest Videos" section.'
    );
  }

  console.log('Found "Latest Videos" section.');

  /*
   * Find video links after that heading.
   */
  const videos = [];

  let node = $(heading).next();

  while (node.length) {
    const tag =
      node.prop("tagName")?.toLowerCase();

    /*
     * Stop when another main section begins.
     */
    if (
      ["h1", "h2"].includes(tag) &&
      !/latest videos/i.test(node.text())
    ) {
      break;
    }

    const links = node.is("a")
      ? node
      : node.find("a");

    links.each((_, element) => {
      const link = $(element);

      const href = link.attr("href");

      if (!href) return;

      /*
       * Look around the link for its age.
       */
      const container = link.closest(
        "article, li, .video, .video-item, .item, .post, .card, div"
      );

      if (!container.length) return;

      const text = container
        .text()
        .replace(/\s+/g, " ")
        .trim();

      const age = parseAge(text);

      if (!age) return;

      /*
       * Last 24 hours only.
       */
      if (age.hours > 24) return;

      let url;

      try {
        url = new URL(
          href,
          SOURCE_URL
        ).href;
      } catch {
        return;
      }

      let title = link
        .text()
        .replace(/\s+/g, " ")
        .trim();

      if (
        !title ||
        /^\d+$/.test(title) ||
        /^\d+:\d+$/.test(title) ||
        /ago$/i.test(title)
      ) {
        title = container
          .find("h2, h3, h4")
          .first()
          .text()
          .replace(/\s+/g, " ")
          .trim();
      }

      if (!title) return;

      const image = container
        .find("img")
        .first();

      const thumbnail =
        image.attr("data-src") ||
        image.attr("data-lazy-src") ||
        image.attr("src") ||
        null;

      videos.push({
        title,
        source_url: url,
        source_age: age.text,
        age_hours: age.hours,

        thumbnail_url: thumbnail
          ? new URL(
              thumbnail,
              SOURCE_URL
            ).href
          : null
      });
    });

    node = node.next();
  }

  /*
   * Remove duplicate URLs.
   */
  const unique = [
    ...new Map(
      videos.map(video => [
        video.source_url,
        video
      ])
    ).values()
  ];

  unique.sort(
    (a, b) =>
      a.age_hours - b.age_hours
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

  unique.forEach((video, index) => {
    console.log("");

    console.log(
      `${index + 1}. ${video.title}`
    );

    console.log(
      `   Age: ${video.source_age}`
    );

    console.log(
      `   URL: ${video.source_url}`
    );

    if (video.thumbnail_url) {
      console.log(
        `   Thumbnail: ${video.thumbnail_url}`
      );
    }
  });

  console.log("");
  console.log(
    "TEST MODE — nothing written to Supabase."
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
