const PAGE_URL =
  "https://justthegays.com/video/204746-themaskedsukr-a-blowjob-through-the-glorygole/";

async function main() {
  console.log("Fetching:");
  console.log(PAGE_URL);

  const response = await fetch(PAGE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/153 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  console.log("HTTP:", response.status);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  console.log("HTML length:", html.length);

  /* ------------------------------------------------------------
     VIDEO / SOURCE TAGS
  ------------------------------------------------------------ */

  const videoTags =
    html.match(/<video[\s\S]*?<\/video>/gi) || [];

  console.log("\n==============================");
  console.log("VIDEO TAGS");
  console.log("==============================");

  console.log("Found:", videoTags.length);

  videoTags.forEach((tag, i) => {
    console.log(`\n--- VIDEO ${i + 1} ---`);
    console.log(tag);
  });


  /* ------------------------------------------------------------
     SOURCE TAGS
  ------------------------------------------------------------ */

  const sourceTags =
    html.match(/<source\b[^>]*>/gi) || [];

  console.log("\n==============================");
  console.log("SOURCE TAGS");
  console.log("==============================");

  console.log("Found:", sourceTags.length);

  sourceTags.forEach((tag, i) => {
    console.log(`\n--- SOURCE ${i + 1} ---`);
    console.log(tag);
  });


  /* ------------------------------------------------------------
     DIRECT MP4 REFERENCES
  ------------------------------------------------------------ */

  const mp4Matches =
    html.match(
      /https?:\/\/[^"'<>\\\s]+\.mp4(?:\?[^"'<>\\\s]*)?/gi
    ) || [];

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

  console.log("Found:", mp4Urls.length);

  mp4Urls.forEach((url, i) => {
    console.log(`${i + 1}. ${url}`);
  });


  /* ------------------------------------------------------------
     M3U8 REFERENCES
  ------------------------------------------------------------ */

  const m3u8Matches =
    html.match(
      /https?:\/\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?/gi
    ) || [];

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

  console.log("Found:", m3u8Urls.length);

  m3u8Urls.forEach((url, i) => {
    console.log(`${i + 1}. ${url}`);
  });


  /* ------------------------------------------------------------
     JSON-LD
  ------------------------------------------------------------ */

  const jsonLd =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ) || [];

  console.log("\n==============================");
  console.log("JSON-LD");
  console.log("==============================");

  console.log("Found:", jsonLd.length);

  jsonLd.forEach((block, i) => {
    console.log(`\n--- JSON-LD ${i + 1} ---`);
    console.log(block);
  });


  /* ------------------------------------------------------------
     INTERESTING PLAYER LINES
  ------------------------------------------------------------ */

  const lines =
    html.split("\n");

  const interesting =
    lines.filter(line =>
      /mp4|m3u8|video_url|videoUrl|file:|sources|player|jwplayer|fluidPlayer|videojs/i.test(
        line
      )
    );

  console.log("\n==============================");
  console.log("PLAYER-RELATED HTML");
  console.log("==============================");

  console.log("Matching lines:", interesting.length);

  interesting
    .slice(0, 100)
    .forEach(line => {
      console.log(line.trim());
    });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
