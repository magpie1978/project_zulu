import { supabase } from "./supabaseClient.js";


/* =================================================================================================================
   FACIAL RECOGNITION
==================================================================================================================== */

import {
  FaceDetector,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";




/* =================================================================================================================
   DOM ELEMENTS
==================================================================================================================== */

const container = document.getElementById("video-container");
const actorList = document.getElementById("actor-sidebar-list");
const actorSort = document.getElementById("actor-sort");
const searchInput = document.getElementById("searchInput");
const videoSort = document.getElementById("video-sort");

const modal = document.getElementById("videoModal");
const modalVideo = document.getElementById("modalVideo");
const closeModal = document.getElementById("closeModal");

const logoutButton = document.getElementById("logoutButton");


/* =================================================================================================================
   STATE
==================================================================================================================== */

let allVideos = [];
let actorSidebarData = [];
let totalVideoCount = 0;

let activeVideoUid = null;
let viewTimer = null;
let viewLogged = false;

// Add Video state
let addVideoUploadInProgress = false;
let addVideoCompleted = false;

// Facial Recognition
let faceDetector = null;
let thumbnailCandidates = [];
let selectedThumbnailIndex = 0;
let selectedThumbnailBlob = null;


/* =================================================================================================================
   INITIALISATION
==================================================================================================================== */

document.addEventListener("DOMContentLoaded", async () => {
  const {
    data: { session },
    error
  } = await supabase.auth.getSession();

  if (error) {
    console.error("Session check failed:", error);
    window.location.replace("index.html");
    return;
  }

  if (!session) {
    window.location.replace("index.html");
    return;
  }

  await loadActorSidebar();
  await loadZuluVideos();

  attachModalEvents();
  attachFilterEvents();
});


/* =================================================================================================================
   EVENT HANDLERS
==================================================================================================================== */

function attachFilterEvents() {
  actorSort?.addEventListener("change", () => {
    preserveSidebarScroll(() => renderActorSidebar());
  });

  searchInput?.addEventListener("input", applySearchFilter);
  videoSort?.addEventListener("change", applySearchFilter);
}


function preserveSidebarScroll(callback) {
  const sidebar = actorList?.parentElement;
  const currentScroll = sidebar?.scrollTop || 0;

  callback();

  if (sidebar) {
    sidebar.scrollTop = currentScroll;
  }
}


/* =================================================================================================================
   SUPABASE HELPERS
==================================================================================================================== */

async function fetchAllRows({ table, select, orderColumn }) {
  const batchSize = 1000;
  let from = 0;
  let allRows = [];

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderColumn, { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) {
      throw error;
    }

    allRows = allRows.concat(data || []);

    if (!data || data.length < batchSize) {
      break;
    }

    from += batchSize;
  }

  return allRows;
}






/* =================================================================================================================
   LARGE FILE UPLOAD HELPERS
==================================================================================================================== */


const LARGE_FILE_THRESHOLD =
  500 * 1024 * 1024; // 500 MiB

const LARGE_FILE_PART_SIZE =
  100 * 1024 * 1024; // 100 MiB

const LARGE_FILE_MAX_RETRIES = 5;

const LARGE_FILE_RETRY_BASE_DELAY = 1500;

// DELAY HELPER
function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function calculateBlobSha1(blob) {
  const buffer = await blob.arrayBuffer();

  const hashBuffer = await crypto.subtle.digest(
    "SHA-1",
    buffer
  );

  return [...new Uint8Array(hashBuffer)]
    .map(byte =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}





/* =================================================================================================================
   ACTOR SIDEBAR
==================================================================================================================== */

async function loadActorSidebar() {
  if (!actorList) return;

  actorList.innerHTML = "";

  try {
    const rows = await fetchAllRows({
      table: "zulu_videos_with_actors",
      select: "uid, actor",
      orderColumn: "actor"
    });

    console.log("ACTOR DEBUG:", {
      rowCount: rows.length,
      firstFiveRows: rows.slice(0, 5)
    });

    const actorCounts = new Map();
    const uniqueVideoIds = new Set();

    rows.forEach(({ uid, actor }) => {
      if (!uid) return;

      uniqueVideoIds.add(String(uid));

      if (!actor) return;

      if (!actorCounts.has(actor)) {
        actorCounts.set(actor, new Set());
      }

      actorCounts.get(actor).add(String(uid));
    });

    totalVideoCount = uniqueVideoIds.size;

    actorSidebarData = Array.from(actorCounts.entries()).map(
      ([actor, videos]) => ({
        actor,
        videoCount: videos.size
      })
    );

    renderActorSidebar();

  } catch (error) {
    console.error("Error loading actors:", error);
    actorList.innerHTML =
      `<p class="error">Could not load actors.</p>`;
  }
}


function renderActorSidebar() {
  if (!actorList) return;

  actorList.innerHTML = "";

  const sortedActors = sortActors(actorSidebarData);

  actorList.appendChild(createAllVideosLink());

  sortedActors.forEach(actorData => {
    actorList.appendChild(createActorLink(actorData));
  });
}


function sortActors(actors) {
  const sortMode = actorSort?.value || "actor-asc";

  return [...actors].sort((a, b) => {
    switch (sortMode) {

      case "actor-desc":
        return b.actor.localeCompare(a.actor);

      case "count-desc":
        return (
          b.videoCount - a.videoCount ||
          a.actor.localeCompare(b.actor)
        );

      case "count-asc":
        return (
          a.videoCount - b.videoCount ||
          a.actor.localeCompare(b.actor)
        );

      case "actor-asc":
      default:
        return a.actor.localeCompare(b.actor);
    }
  });
}


function createAllVideosLink() {
  const link = document.createElement("a");

  link.href = "#";

  link.className = getSelectedActor()
    ? "actor-link"
    : "actor-link active";

  link.textContent = `All Videos (${totalVideoCount})`;

  link.addEventListener("click", async event => {
    event.preventDefault();

    history.pushState({}, "", "index.html");

    renderActorSidebar();
    await loadZuluVideos();
    scrollVideosToTop();
  });

  return link;
}


function scrollVideosToTop() {
  const mainContent =
    document.querySelector(".main-content");

  if (mainContent) {
    mainContent.scrollTop = 0;
  }

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto"
  });
}


function createActorLink({ actor, videoCount }) {
  const link = document.createElement("a");
  const selectedActor = getSelectedActor();

  link.href = "#";

  link.className =
    selectedActor === actor
      ? "actor-link active"
      : "actor-link";

  const nameSpan = document.createElement("span");
  nameSpan.className = "actor-name";
  nameSpan.textContent = actor;

  const countSpan = document.createElement("span");
  countSpan.className = "actor-count";
  countSpan.textContent = ` (${videoCount})`;

  link.appendChild(nameSpan);
  link.appendChild(countSpan);

  link.addEventListener("click", async event => {
    event.preventDefault();

    history.pushState(
      {},
      "",
      `index.html?actor=${encodeURIComponent(actor)}`
    );

    renderActorSidebar();
    await loadZuluVideos();
    scrollVideosToTop();
  });

  return link;
}


/* =================================================================================================================
   VIDEO LOADING
==================================================================================================================== */

async function loadZuluVideos() {
  if (!container) return;

  const selectedActor = getSelectedActor();

  try {
    const {
      data: videos,
      error: videosError
    } = await supabase
      .from("zulu_videos_search")
      .select(
        "uid, film, url, actors, actor_search, tags"
      )
      .order("film", { ascending: true });

    if (videosError) {
      throw videosError;
    }

    const viewCounts =
      await loadVideoViewCounts();

    allVideos = (videos || []).map(video => ({
      ...video,
      views:
        viewCounts.get(String(video.uid)) || 0
    }));

    if (selectedActor) {
      allVideos = allVideos.filter(video =>
        Array.isArray(video.actors) &&
        video.actors.includes(selectedActor)
      );
    }

    applySearchFilter();

  } catch (error) {
    console.error(
      "Error loading zulu videos:",
      error
    );

    container.innerHTML =
      `<p class="error">Could not load videos.</p>`;
  }
}


async function loadVideoViewCounts() {
  const { data, error } = await supabase
    .from("zulu_video_counts")
    .select("video_uid, views");

  if (error) {
    console.error(
      "Error loading video counts:",
      error
    );

    return new Map();
  }

  return new Map(
    (data || []).map(row => [
      String(row.video_uid),
      Number(row.views || 0)
    ])
  );
}


function getSelectedActor() {
  return new URLSearchParams(
    window.location.search
  ).get("actor");
}



/* =================================================================================================================
   PART UPLOAD PROCESS - FOR LARGE FILES
==================================================================================================================== */

function uploadPartToBackblaze({
  uploadUrl,
  authorizationToken,
  blob,
  partNumber,
  sha1,
  bytesAlreadyUploaded,
  totalFileSize
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(
      "POST",
      uploadUrl,
      true
    );

    xhr.setRequestHeader(
      "Authorization",
      authorizationToken
    );

    xhr.setRequestHeader(
      "X-Bz-Part-Number",
      String(partNumber)
    );

    xhr.setRequestHeader(
      "X-Bz-Content-Sha1",
      sha1
    );

    xhr.setRequestHeader(
      "Content-Type",
      "application/octet-stream"
    );


    // -----------------------------------------------------
    // Upload progress
    // -----------------------------------------------------

    xhr.upload.addEventListener(
      "progress",
      event => {
        if (!event.lengthComputable) {
          return;
        }

        const totalUploaded =
          bytesAlreadyUploaded +
          event.loaded;

        const percent =
          (
            totalUploaded /
            totalFileSize
          ) * 100;

        addVideoProgress.value =
          percent;

        addVideoProgressText.textContent =
          `${percent.toFixed(1)}% — ` +
          `${formatBytes(totalUploaded)} / ` +
          `${formatBytes(totalFileSize)}`;
      }
    );


    // -----------------------------------------------------
    // Response
    // -----------------------------------------------------

    xhr.addEventListener(
      "load",
      () => {
        let response = {};

        try {
          response =
            JSON.parse(xhr.responseText);
        } catch {
          response = {
            raw: xhr.responseText
          };
        }

        if (
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          resolve(response);
          return;
        }

        const error =
          new Error(
            response?.message ||
            response?.code ||
            `Backblaze returned HTTP ${xhr.status}`
          );

        error.status =
          xhr.status;

        error.code =
          response?.code || null;

        error.response =
          response;

        reject(error);
      }
    );


    // -----------------------------------------------------
    // Network failure
    // -----------------------------------------------------

    xhr.addEventListener(
      "error",
      () => {
        const error =
          new Error(
            `Network error uploading part ${partNumber}.`
          );

        error.networkError = true;

        reject(error);
      }
    );


    xhr.addEventListener(
      "abort",
      () => {
        const error =
          new Error(
            `Upload cancelled during part ${partNumber}.`
          );

        error.aborted = true;

        reject(error);
      }
    );


    xhr.send(blob);
  });
}


async function getFreshPartUploadAuthorization(
  fileId
) {
  const {
    data,
    error
  } = await supabase.functions.invoke(
    "zulu-upload-authorize",
    {
      body: {
        action: "get-part-url",
        fileId
      }
    }
  );

  if (error) {
    throw error;
  }

  if (
    !data?.uploadUrl ||
    !data?.authorizationToken
  ) {
    throw new Error(
      "Backblaze did not return part upload authorization."
    );
  }

  return data;
}


function shouldRetryPartUpload(error) {
  if (error?.aborted) {
    return false;
  }

  if (error?.networkError) {
    return true;
  }

  if (
    error?.status === 401 ||
    error?.status === 408 ||
    error?.status === 429
  ) {
    return true;
  }

  if (
    error?.status >= 500 &&
    error?.status <= 599
  ) {
    return true;
  }

  return false;
}



/* =================================================================================================================
   LARGE FILE ORCHESTRATION FUNCTION
==================================================================================================================== */

async function uploadLargeFileToBackblaze(
  file,
  canonicalFilename
) {
  // -------------------------------------------------------
  // 1. Start large file
  // -------------------------------------------------------

  addVideoStatus.textContent =
    "Starting large-file upload…";

  const {
    data: startData,
    error: startError
  } = await supabase.functions.invoke(
    "zulu-upload-authorize",
    {
      body: {
        action: "start-large",
        filename:
          canonicalFilename
      }
    }
  );

  if (startError) {
    throw startError;
  }

  if (!startData?.fileId) {
    throw new Error(
      "Backblaze did not return a large-file ID."
    );
  }

  const fileId =
    startData.fileId;


  // -------------------------------------------------------
  // 2. Calculate number of parts
  // -------------------------------------------------------

  const partSha1Array = [];

  const totalParts =
    Math.ceil(
      file.size /
      LARGE_FILE_PART_SIZE
    );

  let bytesUploaded = 0;


  // -------------------------------------------------------
  // 3. Upload each part
  // -------------------------------------------------------

  for (
    let partIndex = 0;
    partIndex < totalParts;
    partIndex++
  ) {
    const partNumber =
      partIndex + 1;

    const start =
      partIndex *
      LARGE_FILE_PART_SIZE;

    const end =
      Math.min(
        start +
          LARGE_FILE_PART_SIZE,
        file.size
      );

    const blob =
      file.slice(start, end);


    // -----------------------------------------------------
    // Hash this part only
    // -----------------------------------------------------

    addVideoStatus.textContent =
      `Hashing part ${partNumber} of ${totalParts}…`;

    const sha1 =
      await calculateBlobSha1(blob);

    partSha1Array.push(sha1);


    // -----------------------------------------------------
    // Retry loop for this part
    // -----------------------------------------------------

    let uploaded =
      false;

    let lastError =
      null;

    for (
      let attempt = 1;
      attempt <=
        LARGE_FILE_MAX_RETRIES;
      attempt++
    ) {
      try {
        // Always obtain a fresh URL/token for an attempt.
        //
        // This is deliberately conservative and makes
        // recovery much simpler.
        const partAuth =
          await getFreshPartUploadAuthorization(
            fileId
          );

        if (attempt === 1) {
          addVideoStatus.textContent =
            `Uploading part ${partNumber} of ${totalParts}…`;
        } else {
          addVideoStatus.textContent =
            `Retrying part ${partNumber} of ${totalParts} — attempt ${attempt}/${LARGE_FILE_MAX_RETRIES}…`;
        }

        console.log(
          `Uploading part ${partNumber}/${totalParts}, attempt ${attempt}`
        );


        await uploadPartToBackblaze({
          uploadUrl:
            partAuth.uploadUrl,

          authorizationToken:
            partAuth.authorizationToken,

          blob,

          partNumber,

          sha1,

          bytesAlreadyUploaded:
            bytesUploaded,

          totalFileSize:
            file.size
        });


        // -----------------------------------------------
        // Success
        // -----------------------------------------------

        uploaded =
          true;

        break;

      } catch (error) {
        lastError =
          error;

        console.warn(
          `Part ${partNumber} attempt ${attempt} failed:`,
          error
        );


        // -----------------------------------------------
        // Don't retry permanent errors
        // -----------------------------------------------

        if (
          !shouldRetryPartUpload(error)
        ) {
          throw error;
        }


        // -----------------------------------------------
        // Exhausted attempts
        // -----------------------------------------------

        if (
          attempt ===
          LARGE_FILE_MAX_RETRIES
        ) {
          break;
        }


        // -----------------------------------------------
        // Exponential backoff
        //
        // 1.5 sec
        // 3 sec
        // 6 sec
        // 12 sec
        // -----------------------------------------------

        const delay =
          LARGE_FILE_RETRY_BASE_DELAY *
          Math.pow(
            2,
            attempt - 1
          );

        addVideoStatus.textContent =
          `Part ${partNumber} failed. Retrying in ${Math.round(
            delay / 1000
          )} seconds…`;

        await sleep(delay);
      }
    }


    // -----------------------------------------------------
    // This part never succeeded
    // -----------------------------------------------------

    if (!uploaded) {
      throw new Error(
        `Part ${partNumber} failed after ${LARGE_FILE_MAX_RETRIES} attempts: ${
          lastError?.message ||
          "unknown error"
        }`
      );
    }


    // -----------------------------------------------------
    // Part complete
    // -----------------------------------------------------

    bytesUploaded +=
      blob.size;

    addVideoProgress.value =
      (
        bytesUploaded /
        file.size
      ) * 100;

    addVideoProgressText.textContent =
      `${(
        (
          bytesUploaded /
          file.size
        ) * 100
      ).toFixed(1)}% — ` +
      `${formatBytes(bytesUploaded)} / ` +
      `${formatBytes(file.size)}`;
  }


  // -------------------------------------------------------
  // 4. Finish large file
  // -------------------------------------------------------

  addVideoStatus.textContent =
    "Finalizing large file…";

  const {
    data: finishData,
    error: finishError
  } = await supabase.functions.invoke(
    "zulu-upload-authorize",
    {
      body: {
        action:
          "finish-large",

        fileId,

        partSha1Array
      }
    }
  );

  if (finishError) {
    throw finishError;
  }

  if (!finishData?.success) {
    throw new Error(
      finishData?.error ||
      "Could not finish Backblaze large file."
    );
  }

  return finishData;
}










/* =================================================================================================================
   SEARCHING & SORTING
==================================================================================================================== */

function applySearchFilter() {
  const searchTerm =
    searchInput?.value
      .trim()
      .toLowerCase() || "";

  let filteredVideos = [...allVideos];

  if (searchTerm) {
    filteredVideos =
      filteredVideos.filter(video =>
        videoMatchesSearch(
          video,
          searchTerm
        )
      );
  }

  filteredVideos =
    sortVideos(filteredVideos);

  renderVideos(filteredVideos);
}


function videoMatchesSearch(video, term) {
  const film =
    (video.film || "").toLowerCase();

  const actors =
    (video.actor_search || "").toLowerCase();

  const tags =
    (video.tags || "").toLowerCase();

  return (
    film.includes(term) ||
    actors.includes(term) ||
    tags.includes(term)
  );
}


function sortVideos(videos) {
  const sortMode =
    videoSort?.value || "film-asc";

  return [...videos].sort((a, b) => {
    switch (sortMode) {

      case "film-desc":
        return (b.film || "")
          .localeCompare(a.film || "");

      case "views-desc":
        return (
          Number(b.views || 0) -
          Number(a.views || 0)
        );

      case "views-asc":
        return (
          Number(a.views || 0) -
          Number(b.views || 0)
        );

      case "film-asc":
      default:
        return (a.film || "")
          .localeCompare(b.film || "");
    }
  });
}


/* =================================================================================================================
   SIGNED VIDEO URL
==================================================================================================================== */

/*
 * Requests a temporary signed media URL from
 * the zulu-sign-media Supabase Edge Function.
 *
 * The permanent URL stored in the database is
 * used only to identify the requested file.
 *
 * The permanent URL is NEVER passed directly
 * to the <video> element.
 */
async function getSignedVideoUrl(originalUrl) {
  if (!originalUrl) {
    throw new Error(
      "No video URL supplied."
    );
  }

  let path;

  try {
    const parsedUrl =
      new URL(originalUrl);

    path = parsedUrl.pathname;

  } catch {
    path = originalUrl.startsWith("/")
      ? originalUrl
      : `/${originalUrl}`;
  }

  console.log(
    "Requesting signed URL for:",
    path
  );

  const { data, error } =
    await supabase.functions.invoke(
      "zulu-sign-media",
      {
        body: {
          path
        }
      }
    );

  if (error) {
    console.error(
      "Signed URL error:",
      error
    );

    throw error;
  }

  if (!data?.url) {
    console.error(
      "Signing response:",
      data
    );

    throw new Error(
      "Signing service did not return a video URL."
    );
  }

  console.log(
    "Signed video URL received."
  );

  return data.url;
}


/* =================================================================================================================
   VIDEO RENDERING
==================================================================================================================== */

function renderVideos(videos) {
  if (!container) return;

  container.innerHTML = "";

  if (!videos.length) {
    container.innerHTML =
      `<p class="empty">No matching videos found.</p>`;

    return;
  }

  videos.forEach(video => {
    container.appendChild(
      renderVideoCard(video)
    );
  });

  window.lucide?.createIcons();
}


function renderVideoCard(video) {
  const card =
    document.createElement("article");

  card.className = "video-card";

  const title =
    video.film || "Untitled video";

  const thumbnailUrl =
    `/images/${video.uid}.png`;

  const views =
    Number(video.views || 0);

  const tagsHtml =
    createTagsHtml(video.tags);

  card.innerHTML = `
    <div class="thumb-wrap">

      <img
        class="video-thumbnail"
        src="${thumbnailUrl}"
        alt="${escapeHTML(title)} thumbnail"
        loading="lazy"
        onerror="
          this.onerror=null;
          this.src='/images/default.png';
        "
      >

      <div class="play-icon">
        <i data-lucide="play"></i>
      </div>

    </div>

    <div class="video-info">

      <h3>
        ${escapeHTML(title)}
      </h3>

      <div class="video-meta">

        <div class="video-views">
          👁 ${views.toLocaleString()}
        </div>

        <div class="video-tags">
          ${tagsHtml}
        </div>

      </div>

    </div>
  `;

  /*
   * IMPORTANT:
   * Clicking a card calls openVideo().
   *
   * openVideo() then obtains the temporary
   * signed URL before starting playback.
   */
  card.addEventListener("click", () => {
    openVideo(
      video.url,
      video.uid
    );
  });

  return card;
}


function createTagsHtml(tagsString) {
  return String(tagsString || "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => `
      <span
        class="tag-pill"
        style="background:${getTagColor(tag)}"
      >
        ${escapeHTML(tag)}
      </span>
    `)
    .join("");
}


/* =================================================================================================================
   VIDEO MODAL
==================================================================================================================== */

async function openVideo(url, uid) {
  if (!url) {
    console.warn(
      "No video URL found."
    );

    return;
  }

  if (!modal || !modalVideo) {
    return;
  }

  activeVideoUid = uid;
  viewLogged = false;

  clearViewTimer();
  resetModalSources();

  modal.classList.add("open");

  document.body.classList.add(
    "modal-open"
  );

  try {

    /*
     * Ask Supabase for an authorised
     * temporary URL.
     */
    const signedUrl =
      await getSignedVideoUrl(url);

    /*
     * ONLY the signed URL is assigned
     * to the video player.
     */
    modalVideo.src = signedUrl;

    modalVideo.style.display =
      "block";

    await modalVideo.play();

    startViewTimer();

  } catch (error) {

    console.error(
      "Video could not be opened:",
      error
    );

    resetModalSources();

    modal.classList.remove("open");

    document.body.classList.remove(
      "modal-open"
    );
  }
}


/* =================================================================================================================
   MODAL EVENTS
==================================================================================================================== */

function attachModalEvents() {
  closeModal?.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      closeVideoModal();
    }
  );

  modal?.addEventListener(
    "click",
    event => {
      if (event.target === modal) {
        closeVideoModal();
      }
    }
  );

  document.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        closeVideoModal();
      }
    }
  );
}


function closeVideoModal() {
  modal?.classList.remove("open");

  document.body.classList.remove(
    "modal-open"
  );

  clearViewTimer();
  resetModalSources();

  activeVideoUid = null;
  viewLogged = false;
}


function resetModalSources() {
  if (!modalVideo) return;

  try {
    modalVideo.pause();
  } catch {
    // Ignore pause errors
  }

  modalVideo.removeAttribute("src");

  modalVideo.load();

  modalVideo.style.display = "none";
}





/* =================================================================================================================
   MODAL HELPER FUNCTIONS
==================================================================================================================== */

function encodeB2Filename(filename) {
  return encodeURIComponent(filename)
    .replace(/[!'()*]/g, char =>
      "%" + char.charCodeAt(0)
        .toString(16)
        .toUpperCase()
    );
}


async function calculateFileSha1(file) {
  const buffer = await file.arrayBuffer();

  const hashBuffer = await crypto.subtle.digest(
    "SHA-1",
    buffer
  );

  return [...new Uint8Array(hashBuffer)]
    .map(byte =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}


function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];

  let value = bytes;
  let unit = 0;

  while (
    value >= 1024 &&
    unit < units.length - 1
  ) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}




/* =================================================================================================================
   UPLOAD TO BACKBLAZE
==================================================================================================================== */

function uploadFileToBackblaze({
  uploadUrl,
  authorizationToken,
  file,
  filename,
  sha1
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(
      "POST",
      uploadUrl,
      true
    );

    xhr.setRequestHeader(
      "Authorization",
      authorizationToken
    );

    xhr.setRequestHeader(
      "X-Bz-File-Name",
      encodeB2Filename(filename)
    );

    xhr.setRequestHeader(
      "Content-Type",
      "video/mp4"
    );

    xhr.setRequestHeader(
      "X-Bz-Content-Sha1",
      sha1
    );

    xhr.setRequestHeader(
      "X-Bz-Info-src_last_modified_millis",
      String(file.lastModified)
    );


    // -----------------------------------------------------
    // Upload progress
    // -----------------------------------------------------

    xhr.upload.addEventListener(
      "progress",
      event => {
        if (!event.lengthComputable) {
          return;
        }

        const percent =
          (event.loaded / event.total) * 100;

        addVideoProgress.value =
          percent;

        addVideoProgressText.textContent =
          `${percent.toFixed(1)}% — ` +
          `${formatBytes(event.loaded)} / ` +
          `${formatBytes(event.total)}`;
      }
    );


    // -----------------------------------------------------
    // Successful request
    // -----------------------------------------------------

    xhr.addEventListener(
      "load",
      () => {
        let response;

        try {
          response =
            JSON.parse(xhr.responseText);
        } catch {
          response = {
            raw: xhr.responseText
          };
        }

        if (
          xhr.status >= 200 &&
          xhr.status < 300
        ) {
          resolve(response);
        } else {
          reject(
            new Error(
              response?.message ||
              response?.code ||
              `Backblaze returned HTTP ${xhr.status}`
            )
          );
        }
      }
    );


    xhr.addEventListener(
      "error",
      () => {
        reject(
          new Error(
            "Network error while uploading to Backblaze."
          )
        );
      }
    );


    xhr.addEventListener(
      "abort",
      () => {
        reject(
          new Error(
            "Upload cancelled."
          )
        );
      }
    );


    xhr.send(file);
  });
}












/* =================================================================================================================
   VIEW LOGGING
==================================================================================================================== */

function startViewTimer() {
  clearViewTimer();

  viewTimer = setTimeout(() => {
    logVideoView(activeVideoUid);
  }, 15000);
}


function clearViewTimer() {
  if (viewTimer) {
    clearTimeout(viewTimer);
    viewTimer = null;
  }
}


async function logVideoView(uid) {
  if (!uid || viewLogged) {
    return;
  }

  viewLogged = true;

  const { error } = await supabase
    .from("zulu_video_views")
    .insert({
      video_uid: uid,
      watch_seconds: 15
    });

  if (error) {
    console.error(
      "Error logging video view:",
      error
    );
  }
}


/* =================================================================================================================
   ADD VIDEOS
==================================================================================================================== */

const addVideoBtn = document.getElementById("add-video-btn");
const addVideoModal = document.getElementById("add-video-modal");
const addVideoClose = document.getElementById("add-video-close");
const addVideoCancel = document.getElementById("add-video-cancel");

const addVideoFile = document.getElementById("add-video-file");
const addVideoTitle = document.getElementById("add-video-title");
const addVideoActors = document.getElementById("add-video-actors");
const addVideoAddActor = document.getElementById("add-video-add-actor");
const addVideoTags = document.getElementById("add-video-tags");

const addVideoStatus = document.getElementById("add-video-status");
const addVideoSubmit = document.getElementById("add-video-submit");
const addVideoFileInfo = document.getElementById("add-video-file-info");

const addVideoProgressWrap = document.getElementById("add-video-upload-progress-wrap");
const addVideoProgress = document.getElementById("add-video-upload-progress");
const addVideoProgressText = document.getElementById("add-video-upload-progress-text");

let zuluActorNames = [];

// Facial Recognition
const addVideoThumbnailPreview = document.getElementById("add-video-thumbnail-preview");
const addVideoThumbnailStatus = document.getElementById("add-video-thumbnail-status");
const addVideoThumbnailActions = document.getElementById("add-video-thumbnail-actions");
const addVideoThumbnailPrev = document.getElementById("add-video-thumbnail-prev");
const addVideoThumbnailNext = document.getElementById("add-video-thumbnail-next");


/* ---------------------------------------------------------
   Modal
--------------------------------------------------------- */

function openAddVideoModal() {
  addVideoCompleted = false;

  addVideoModal.classList.add("open");
  addVideoModal.setAttribute("aria-hidden", "false");

  if (!addVideoActors.children.length) {
    addActorRow();
  }

  loadZuluActorNames();
}




function resetAddVideoForm() {
  addVideoFile.value = "";
  addVideoTitle.value = "";
  addVideoActors.innerHTML = "";
  addVideoTags.value = "";

  addVideoFileInfo.textContent = "";
  addVideoStatus.textContent = "";

  addVideoProgress.value = 0;
  addVideoProgressText.textContent = "";
  addVideoProgressWrap.style.display = "none";

  addVideoSubmit.disabled = false;
  addVideoSubmit.textContent = "Upload Video";

  if (addVideoCancel) {
    addVideoCancel.textContent = "Cancel";
  }

  addVideoCompleted = false;

  addActorRow();
}



function closeAddVideoModal() {
  if (addVideoUploadInProgress) {
    addVideoStatus.textContent =
      "Upload in progress — please wait for it to finish.";
    return;
  }

  addVideoModal.classList.remove("open");
  addVideoModal.setAttribute("aria-hidden", "true");

  if (addVideoCompleted) {
    resetAddVideoForm();
  }
}


addVideoBtn?.addEventListener(
  "click",
  openAddVideoModal
);

addVideoClose?.addEventListener(
  "click",
  closeAddVideoModal
);

addVideoCancel?.addEventListener(
  "click",
  closeAddVideoModal
);

addVideoModal
  ?.querySelector(".add-video-backdrop")
  ?.addEventListener(
    "click",
    () => {
      if (!addVideoUploadInProgress) {
        closeAddVideoModal();
      }
    }
  );


/* ---------------------------------------------------------
   Load existing actor names
--------------------------------------------------------- */

async function loadZuluActorNames() {
  if (zuluActorNames.length) {
    return;
  }

  try {
    const { data, error } = await supabase
      .from("zulu_distinct_actors")
      .select("actor")
      .order("actor");

    if (error) {
      throw error;
    }

    zuluActorNames = [
      ...new Set(
        (data || [])
          .map(row => row.actor?.trim())
          .filter(Boolean)
      )
    ];

    console.log(
      `Loaded ${zuluActorNames.length} existing actor names`
    );

  } catch (error) {
    console.error("Could not load actor catalogue:", error);
  }
}


/* ---------------------------------------------------------
   File selection
--------------------------------------------------------- */

addVideoFile?.addEventListener("change", () => {
  const file = addVideoFile.files?.[0];

  if (!file) {
    addVideoFileInfo.textContent = "";
    return;
  }

  const filename = file.name;

  const title = filename.replace(/\.mp4$/i, "");

  addVideoTitle.value = title;

  const sizeMB = file.size / (1024 * 1024);

  addVideoFileInfo.textContent =
    `${filename} — ${sizeMB.toFixed(1)} MB`;

  suggestActorsFromTitle(title);

  generateThumbnailCandidates(file)
  .catch(error => {
    console.error(
      "Thumbnail generation failed:",
      error
    );

    addVideoThumbnailStatus.textContent =
      "Could not generate an automatic thumbnail.";
  });

   


});


/* ---------------------------------------------------------
   Actor rows
--------------------------------------------------------- */

function addActorRow(value = "") {
  const row = document.createElement("div");

  row.className = "add-video-actor-row";

  const wrapper = document.createElement("div");

  wrapper.className = "add-video-actor-wrapper";

  const input = document.createElement("input");

  input.type = "text";
  input.className = "add-video-actor-input";
  input.placeholder = "Actor name";
  input.autocomplete = "off";
  input.value = value;

  const suggestions = document.createElement("div");

  suggestions.className = "add-video-actor-suggestions";

  input.addEventListener("input", () => {
    showActorSuggestions(input, suggestions);
  });

  input.addEventListener("focus", () => {
    showActorSuggestions(input, suggestions);
  });

  wrapper.appendChild(input);
  wrapper.appendChild(suggestions);

  const remove = document.createElement("button");

  remove.type = "button";
  remove.className = "add-video-remove-actor";
  remove.textContent = "×";

  remove.addEventListener("click", () => {
    row.remove();
  });

  row.appendChild(wrapper);
  row.appendChild(remove);

  addVideoActors.appendChild(row);
}


addVideoAddActor?.addEventListener("click", () => {
  addActorRow();

  const inputs =
    addVideoActors.querySelectorAll(".add-video-actor-input");

  inputs[inputs.length - 1]?.focus();
});


/* ---------------------------------------------------------
   Actor autocomplete
--------------------------------------------------------- */

function showActorSuggestions(input, container) {
  const value = input.value.trim().toLowerCase();

  container.innerHTML = "";

  if (value.length < 1) {
    container.classList.remove("open");
    return;
  }

  const matches = zuluActorNames
    .filter(actor =>
      actor.toLowerCase().includes(value)
    )
    .slice(0, 10);

  if (!matches.length) {
    container.classList.remove("open");
    return;
  }

  for (const actor of matches) {
    const item = document.createElement("div");

    item.className = "add-video-actor-suggestion";
    item.textContent = actor;

    item.addEventListener("mousedown", event => {
      event.preventDefault();

      input.value = actor;

      container.innerHTML = "";
      container.classList.remove("open");
    });

    container.appendChild(item);
  }

  container.classList.add("open");
}


/* ---------------------------------------------------------
   Basic actor suggestions from filename

   Suggestions only.
   User remains in control of final actor list.
--------------------------------------------------------- */

function suggestActorsFromTitle(title) {
  addVideoActors.innerHTML = "";

  let workingTitle = title
    .replace(/^PREVIEW\s*-\s*/i, "")
    .trim();

  const actors = [];

  const withMatch =
    workingTitle.match(/^(.+?)\s+with\s+(.+)$/i);

  if (withMatch) {
    actors.push(withMatch[1].trim());

    let rest = withMatch[2]
      .replace(/\s+-\s+.*$/, "")
      .replace(/\s+#\d+$/, "");

    const others = rest
      .replace(/\s+and\s+/gi, " & ")
      .split(/\s*,\s*|\s*&\s*/)
      .map(value => value.trim())
      .filter(Boolean);

    actors.push(...others);
  }

  if (!actors.length) {
    addActorRow();
    return;
  }

  const uniqueActors = [...new Set(actors)];

  for (const actor of uniqueActors) {
    addActorRow(actor);
  }
}


/* ---------------------------------------------------------
   Build final payload
--------------------------------------------------------- */

function getAddVideoPayload() {
  const file = addVideoFile.files?.[0];

  const actors = [
    ...addVideoActors.querySelectorAll(".add-video-actor-input")
  ]
    .map(input => input.value.trim())
    .filter(Boolean);

  const tags = addVideoTags.value
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);

  return {
    file,
    filename: file?.name || null,
    film: addVideoTitle.value.trim(),
    actors: [...new Set(actors)],
    tags
  };
}


/* ---------------------------------------------------------
   Submit

   For now we validate and display the payload.
   Next stage will replace this with the secure B2 ingest.
--------------------------------------------------------- */

addVideoSubmit?.addEventListener(
  "click",
  async () => {
    const payload =
      getAddVideoPayload();

    if (!payload.file) {
      addVideoStatus.textContent =
        "Please choose an MP4 file.";

      return;
    }

    if (!payload.film) {
      addVideoStatus.textContent =
        "Please enter a film title.";

      return;
    }

    if (!payload.actors.length) {
      addVideoStatus.textContent =
        "Please add at least one actor.";

      return;
    }

    if (
      !payload.filename
        .toLowerCase()
        .endsWith(".mp4")
    ) {
      addVideoStatus.textContent =
        "Only MP4 files are currently supported.";

      return;
    }


    // -----------------------------------------------------
    // Canonical destination filename
    // -----------------------------------------------------

    const canonicalFilename =
      `${payload.film}.mp4`;


   try {
     addVideoUploadInProgress = true;
     addVideoCompleted = false;
   
     addVideoSubmit.disabled = true;
     addVideoSubmit.textContent = "Uploading…";
   
     addVideoFile.disabled = true;
   
     addVideoProgressWrap.style.display =
       "block";
   
     addVideoProgress.value = 0;
   
     addVideoProgressText.textContent =
       "0%";

      // ---------------------------------------------------
      // 1–3. Upload to Backblaze
      //
      // Files under 500 MiB:
      //   existing single-file upload
      //
      // Files 500 MiB and over:
      //   Backblaze multipart upload
      // ---------------------------------------------------

      let uploadResult;

      if (
        payload.file.size >=
        LARGE_FILE_THRESHOLD
      ) {
        // -------------------------------------------------
        // LARGE FILE
        // -------------------------------------------------

        console.log(
          "Using Backblaze multipart upload:",
          canonicalFilename,
          formatBytes(payload.file.size)
        );

        uploadResult =
          await uploadLargeFileToBackblaze(
            payload.file,
            canonicalFilename
          );

      } else {
        // -------------------------------------------------
        // SMALLER FILE
        // -------------------------------------------------

        addVideoStatus.textContent =
          "Calculating checksum…";

        console.log(
          "Calculating SHA-1:",
          canonicalFilename
        );

        const sha1 =
          await calculateFileSha1(
            payload.file
          );

        console.log(
          "SHA-1 calculated:",
          sha1
        );


        // -----------------------------------------------
        // Request temporary B2 upload authorization
        // -----------------------------------------------

        addVideoStatus.textContent =
          "Preparing secure Backblaze upload…";

        const {
          data: uploadAuth,
          error: authError
        } = await supabase.functions.invoke(
          "zulu-upload-authorize",
          {
            body: {
              action: "normal"
            }
          }
        );

        if (authError) {
          throw authError;
        }

        if (
          !uploadAuth?.uploadUrl ||
          !uploadAuth?.authorizationToken
        ) {
          throw new Error(
            "Backblaze upload authorization was incomplete."
          );
        }


        // -----------------------------------------------
        // Upload browser directly to Backblaze
        // -----------------------------------------------

        addVideoStatus.textContent =
          `Uploading ${canonicalFilename}…`;

        uploadResult =
          await uploadFileToBackblaze({
            uploadUrl:
              uploadAuth.uploadUrl,

            authorizationToken:
              uploadAuth.authorizationToken,

            file:
              payload.file,

            filename:
              canonicalFilename,

            sha1
          });
      }




         // ---------------------------------------------------
         // 4. Backblaze upload complete
         // ---------------------------------------------------
         
         addVideoProgress.value = 100;
         
         addVideoProgressText.textContent =
           `100% — ${formatBytes(payload.file.size)}`;
         
         console.log(
           "BACKBLAZE UPLOAD COMPLETE",
           uploadResult
         );
         
         
         // ---------------------------------------------------
         // 5. Construct canonical public URL
         // ---------------------------------------------------
         
         const publicUrl =
           "https://media.zulu-orchid-falcon.co.uk/" +
           encodeB2Filename(canonicalFilename);
         
         console.log(
           "PUBLIC VIDEO URL:",
           publicUrl
         );
         
         
         // ---------------------------------------------------
         // 6. Create catalogue entry
         // ---------------------------------------------------
         
         addVideoStatus.textContent =
           "Creating catalogue entry…";
         
         const {
           data: finalizeData,
           error: finalizeError
         } = await supabase.functions.invoke(
           "zulu-finalize-video",
           {
             body: {
               film: payload.film,
               url: publicUrl,
               actors: payload.actors,
               tags: payload.tags
             }
           }
         );
         
         if (finalizeError) {
           console.error(
             "CATALOGUE FINALIZE ERROR:",
             finalizeError
           );
         
           throw finalizeError;
         }
         
         if (!finalizeData?.success) {
           throw new Error(
             finalizeData?.error ||
             "Could not finalize catalogue entry."
           );
         }
         
         
         // ---------------------------------------------------
         // 7. Everything completed successfully
         // ---------------------------------------------------
         
         console.log(
           "ZULU VIDEO COMPLETE:",
           finalizeData
         );
         
         addVideoCompleted = true;
      
         await loadActorSidebar();
         await loadZuluVideos();
         
         addVideoProgress.value = 100;
         
         addVideoProgressText.textContent =
           `100% — ${formatBytes(payload.file.size)}`;
         
         addVideoStatus.textContent =
           `✓ Video added successfully. UID ${finalizeData.uid}`;
         
         addVideoSubmit.textContent =
           "Uploaded ✓";
         
         if (addVideoCancel) {
           addVideoCancel.textContent = "Close";
         }
         
         
         } catch (error) {
           console.error(
             "ZULU UPLOAD FAILED:",
             error
           );
         
           addVideoStatus.textContent =
             `Upload failed: ${
               error?.message ||
               "Unknown error"
             }`;
         
         } finally {
           addVideoUploadInProgress = false;
           addVideoFile.disabled = false;
         
           if (addVideoCompleted) {
             addVideoSubmit.disabled = true;
             addVideoSubmit.textContent = "Uploaded ✓";
         
             if (addVideoCancel) {
               addVideoCancel.textContent = "Close";
             }
           } else {
             addVideoSubmit.disabled = false;
             addVideoSubmit.textContent = "Upload Video";
         
             if (addVideoCancel) {
               addVideoCancel.textContent = "Cancel";
             }
           }
         }
       }
   );







/* =================================================================================================================
   UTILITIES
==================================================================================================================== */

function getTagColor(tag) {
  const colors = {
    orgy: "#2563eb",
    group: "#dc2626",
    threesome: "#16a34a",
    solo: "#9333ea",
    tag5: "#ea580c",
    tag6: "#0891b2",
    tag7: "#64748b"
  };

  return colors[tag] || "#444";
}


function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}



/* =================================================================================================================
   THUMBNAIL GENERATION
==================================================================================================================== */

async function loadFaceDetector() {
  if (faceDetector) {
    return faceDetector;
  }

  addVideoThumbnailStatus.textContent =
    "Loading face detector…";

  const vision =
    await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

  faceDetector =
    await FaceDetector.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
        },

        runningMode: "IMAGE",

        minDetectionConfidence: 0.55
      }
    );

  return faceDetector;
}


// FRAME SEEKER HELPER
function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(
        new Error(
          "Could not seek video for thumbnail generation."
        )
      );
    };

    const cleanup = () => {
      video.removeEventListener(
        "seeked",
        onSeeked
      );

      video.removeEventListener(
        "error",
        onError
      );
    };

    video.addEventListener(
      "seeked",
      onSeeked,
      { once: true }
    );

    video.addEventListener(
      "error",
      onError,
      { once: true }
    );

    video.currentTime = time;
  });
}

// SCORE FACES RECOGNISED
function scoreThumbnailFrame(
  detections,
  width,
  height
) {
  const frameArea =
    width * height;

  const usefulFaces =
    detections
      .map(detection =>
        detection.boundingBox
      )
      .filter(box => {
        if (!box) {
          return false;
        }

        const faceArea =
          box.width *
          box.height;

        const areaRatio =
          faceArea /
          frameArea;

        // Ignore tiny/background detections
        return areaRatio >= 0.025;
      });

  const faceCount =
    usefulFaces.length;

  if (!faceCount) {
    return {
      score: 0,
      faceCount: 0,
      combinedFaceRatio: 0
    };
  }

  let combinedFaceArea = 0;
  let centreBonus = 0;

  for (const box of usefulFaces) {
    combinedFaceArea +=
      box.width *
      box.height;

    const centreX =
      box.originX +
      box.width / 2;

    const centreY =
      box.originY +
      box.height / 2;

    const dx =
      Math.abs(
        centreX - width / 2
      ) /
      (width / 2);

    const dy =
      Math.abs(
        centreY - height / 2
      ) /
      (height / 2);

    const centrality =
      1 -
      Math.min(
        1,
        (dx + dy) / 2
      );

    centreBonus +=
      centrality * 10;
  }

  const combinedFaceRatio =
    combinedFaceArea /
    frameArea;

  let score = 0;

  // Strongly favour 2+ useful faces.
  if (faceCount >= 2) {
    score += 100;
  }

  // Additional faces still help.
  if (faceCount > 2) {
    score +=
      (faceCount - 2) * 20;
  }

  // Large, clearly visible faces.
  score +=
    combinedFaceRatio * 180;

  // Faces reasonably near the centre.
  score +=
    centreBonus;

  // A single large face is still a good fallback.
  if (
    faceCount === 1 &&
    combinedFaceRatio >= 0.15
  ) {
    score += 40;
  }

  return {
    score,
    faceCount,
    combinedFaceRatio
  };
}




// FRAME TO BLOB HELPER
function canvasToJpegBlob(
  canvas,
  quality = 0.88
) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(
            new Error(
              "Could not create thumbnail image."
            )
          );
        }
      },
      "image/jpeg",
      quality
    );
  });
}


// CANDIDATE GENERATOR
async function generateThumbnailCandidates(
  file
) {
  thumbnailCandidates = [];
  selectedThumbnailIndex = 0;
  selectedThumbnailBlob = null;

  addVideoThumbnailPreview.style.display =
    "none";

  addVideoThumbnailActions.style.display =
    "none";

  addVideoThumbnailStatus.textContent =
    "Analysing video for faces…";

  const detector =
    await loadFaceDetector();

  const objectUrl =
    URL.createObjectURL(file);

  const video =
    document.createElement("video");

  video.preload =
    "metadata";

  video.muted =
    true;

  video.playsInline =
    true;

  video.src =
    objectUrl;

  try {
    await new Promise(
      (resolve, reject) => {
        video.addEventListener(
          "loadedmetadata",
          resolve,
          { once: true }
        );

        video.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                "Could not read video metadata."
              )
            ),
          { once: true }
        );
      }
    );

    const duration =
      video.duration;

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        "Video duration is unavailable."
      );
    }

    const percentages = [
      0.05,
      0.10,
      0.15,
      0.20,
      0.25,
      0.30,
      0.35,
      0.40,
      0.50,
      0.60,
      0.70,
      0.80,
      0.85,
      0.90,
      0.95
    ];

    const canvas =
      document.createElement("canvas");

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    const targetWidth =
      Math.min(
        video.videoWidth,
        960
      );

    const scale =
      targetWidth /
      video.videoWidth;

    canvas.width =
      targetWidth;

    canvas.height =
      Math.round(
        video.videoHeight *
        scale
      );

    for (
      let i = 0;
      i < percentages.length;
      i++
    ) {
      const time =
        Math.min(
          duration - 0.25,
          duration *
            percentages[i]
        );

      addVideoThumbnailStatus.textContent =
        `Checking thumbnail ${i + 1} of ${percentages.length}…`;

      await seekVideo(
        video,
        time
      );

      ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const result =
        detector.detect(
          canvas
        );

      const detections =
        result?.detections || [];

      const scoring =
        scoreThumbnailFrame(
          detections,
          canvas.width,
          canvas.height
        );

      const blob =
        await canvasToJpegBlob(
          canvas
        );

      thumbnailCandidates.push({
        time,
        blob,
        score:
          scoring.score,
        faceCount:
          scoring.faceCount,
        combinedFaceRatio:
          scoring.combinedFaceRatio
      });
    }

    thumbnailCandidates.sort(
      (a, b) =>
        b.score - a.score
    );

    showThumbnailCandidate(0);

  } finally {
    URL.revokeObjectURL(
      objectUrl
    );
  }
}

// PREVIEW CYCLING FUNCTION
let currentThumbnailPreviewUrl =
  null;


function showThumbnailCandidate(index) {
  if (
    !thumbnailCandidates.length
  ) {
    return;
  }

  selectedThumbnailIndex =
    (
      index +
      thumbnailCandidates.length
    ) %
    thumbnailCandidates.length;

  const candidate =
    thumbnailCandidates[
      selectedThumbnailIndex
    ];

  selectedThumbnailBlob =
    candidate.blob;

  if (
    currentThumbnailPreviewUrl
  ) {
    URL.revokeObjectURL(
      currentThumbnailPreviewUrl
    );
  }

  currentThumbnailPreviewUrl =
    URL.createObjectURL(
      candidate.blob
    );

  addVideoThumbnailPreview.src =
    currentThumbnailPreviewUrl;

  addVideoThumbnailPreview.style.display =
    "block";

  addVideoThumbnailActions.style.display =
    "block";

  const time =
    Math.round(
      candidate.time
    );

  if (
    candidate.faceCount >= 2
  ) {
    addVideoThumbnailStatus.textContent =
      `Suggested frame — ${candidate.faceCount} faces detected at ${time}s`;
  } else if (
    candidate.faceCount === 1
  ) {
    addVideoThumbnailStatus.textContent =
      `Alternative frame — 1 face detected at ${time}s`;
  } else {
    addVideoThumbnailStatus.textContent =
      `Fallback frame at ${time}s`;
  }
}


// PREVIEW BUTTONS
addVideoThumbnailPrev
  ?.addEventListener(
    "click",
    () => {
      showThumbnailCandidate(
        selectedThumbnailIndex - 1
      );
    }
  );


addVideoThumbnailNext
  ?.addEventListener(
    "click",
    () => {
      showThumbnailCandidate(
        selectedThumbnailIndex + 1
      );
    }
  );




/* =================================================================================================================
   LOGOUT
==================================================================================================================== */

logoutButton?.addEventListener(
  "click",
  async () => {

    const { error } =
      await supabase.auth.signOut();

    if (error) {
      console.error(
        "Logout error:",
        error
      );
    }

    window.location.replace(
      "index.html"
    );
  }
);
