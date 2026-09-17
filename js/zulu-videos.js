import { supabase } from "./supabaseClient.js";

import {
  formatVideoQuality,
  formatVideoDuration,
  formatBytes,
  escapeHTML
} from "./zulu/utils.js";

import {
  isLargeFile,
  encodeB2Filename,
  calculateFileSha1,
  uploadFileToBackblaze,
  uploadLargeFileToBackblaze
} from "./zulu/upload.js";

import {
  generateThumbnailCandidates,
  getSelectedThumbnailBlob,
  resetThumbnailState,
  uploadThumbnailToBackblaze
} from "./zulu/thumbnails.js";

import {
  deleteZuluVideo
} from "./zulu/delete-video.js";



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
let addVideoMetadata = null;


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
  ENCRYPTION HELPERS
==================================================================================================================== */

async function sha256Blob(blob) {
  const buffer = await blob.arrayBuffer();

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      buffer
    );

  return [...new Uint8Array(hashBuffer)]
    .map(byte =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}


async function extractVideoMetadata(file) {
  const objectUrl =
    URL.createObjectURL(file);

  const video =
    document.createElement("video");

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await new Promise((resolve, reject) => {
      video.addEventListener(
        "loadedmetadata",
        resolve,
        { once: true }
      );

      video.addEventListener(
        "error",
        () => reject(
          new Error(
            "Could not read video metadata."
          )
        ),
        { once: true }
      );
    });

    const durationSeconds =
      Number(video.duration);

    const width =
      Number(video.videoWidth);

    const height =
      Number(video.videoHeight);

    const sampleSize =
      4 * 1024 * 1024;

    const firstChunk =
      file.slice(
        0,
        Math.min(
          sampleSize,
          file.size
        )
      );

    const middleStart =
      Math.max(
        0,
        Math.floor(
          file.size / 2 -
          sampleSize / 2
        )
      );

    const middleChunk =
      file.slice(
        middleStart,
        Math.min(
          middleStart + sampleSize,
          file.size
        )
      );

    const lastStart =
      Math.max(
        0,
        file.size - sampleSize
      );

    const lastChunk =
      file.slice(
        lastStart,
        file.size
      );

    const [
      firstSha256,
      middleSha256,
      lastSha256
    ] = await Promise.all([
      sha256Blob(firstChunk),
      sha256Blob(middleChunk),
      sha256Blob(lastChunk)
    ]);
   
   const fingerprintSource = [
     file.size,
     firstSha256,
     middleSha256,
     lastSha256
   ].join("|");

     
    const fingerprintBuffer =
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          fingerprintSource
        )
      );

    const fingerprint =
      [...new Uint8Array(fingerprintBuffer)]
        .map(byte =>
          byte
            .toString(16)
            .padStart(2, "0")
        )
        .join("");

    return {
      filesizeBytes:
        file.size,

      durationSeconds,

      width,

      height,

      fingerprint
    };

  } finally {
    video.pause();
    video.removeAttribute("src");

    URL.revokeObjectURL(
      objectUrl
    );
  }
}

/* =================================================================================================================
   DUPLICATE FILE CHECK HELPER
==================================================================================================================== */

async function findDuplicateVideoByFingerprint(
  fingerprint
) {
  if (!fingerprint) {
    return null;
  }

  const {
    data,
    error
  } = await supabase
    .from("zulu_videos")
    .select("uid, film, url")
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
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
        "uid, film, url, actors, actor_search, tags, filesize_bytes, duration_seconds, width, height"
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


function handleUploadStatus(message) {
  if (addVideoStatus) {
    addVideoStatus.textContent = message;
  }
}


function handleUploadProgress({
  percent,
  text
}) {
  if (addVideoProgress) {
    addVideoProgress.value = percent;
  }

  if (addVideoProgressText) {
    addVideoProgressText.textContent = text;
  }
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
    `https://media.zulu-orchid-falcon.co.uk/images/${video.uid}.png`;

  const views =
    Number(video.views || 0);

  const tagsHtml =
    createTagsHtml(video.tags);

  const quality =
  formatVideoQuality(
    video.width,
    video.height
  );
   
   const fileSize =
     video.filesize_bytes
       ? formatBytes(video.filesize_bytes)
       : "";
   
   const duration =
     formatVideoDuration(
       video.duration_seconds
     );
   
   const technicalMeta =
     [
       quality,
       fileSize,
       duration
     ]
       .filter(Boolean)
       .join(" • ");

  card.innerHTML = `
    <div class="thumb-wrap">

      <img
        class="video-thumbnail"
        src="${thumbnailUrl}"
        alt="${escapeHTML(title)} thumbnail"
        loading="lazy"
        onerror="
          this.onerror=null;
          this.src='https://media.zulu-orchid-falcon.co.uk/images/default.png';
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
      
      ${technicalMeta
        ? `
          <div class="video-tech-meta">
            ${escapeHTML(technicalMeta)}
          </div>
        `
        : ""
      }

      <div class="video-meta">
      
        <div class="video-views">
          👁 ${views.toLocaleString()}
        </div>
      
        <div class="video-card-actions">
      
          <div class="video-tags">
            ${tagsHtml}
          </div>
               
         <button
           type="button"
           class="video-delete-btn"
           title="Delete video"
           aria-label="Delete video"
         >
           <svg
             class="trash-icon"
             viewBox="0 0 24 24"
             aria-hidden="true"
           >
             <path d="M4 7h16" />
             <path d="M10 11v6" />
             <path d="M14 11v6" />
             <path d="M6 7l1 14h10l1-14" />
             <path d="M9 7V4h6v3" />
           </svg>
         </button>      
        </div>
      
      </div>

    </div>
  `;



   const deleteButton =
  card.querySelector(
    ".video-delete-btn"
  );

deleteButton?.addEventListener(
  "click",
  async event => {
    event.preventDefault();

    // Critical:
    // don't let the card click open the video.
    event.stopPropagation();

    await deleteZuluVideo(
      video,
      deleteButton,
      {
        onDeleted: async () => {
          await loadActorSidebar();
          await loadZuluVideos();
        }
      }
    );
  }
);

   
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
  addVideoMetadata = null;
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
  resetThumbnailState();
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

  // A newly selected file must always be analysed
  // from scratch.
  addVideoMetadata = null;

  if (!file) {
    addVideoFileInfo.textContent = "";
    return;
  }

  const filename = file.name;

  const title =
    filename.replace(/\.mp4$/i, "");

  addVideoTitle.value = title;

  const sizeMB =
    file.size / (1024 * 1024);

  addVideoFileInfo.textContent =
    `${filename} — ${sizeMB.toFixed(1)} MB`;

  suggestActorsFromTitle(title);


  // -------------------------------------------------------
  // Analyse video
  //
  // Metadata extraction runs first.
  // Thumbnail generation starts only after metadata
  // extraction has completed.
  // -------------------------------------------------------

  (async () => {
    try {
      addVideoThumbnailStatus.textContent =
        "Reading video metadata…";

      addVideoMetadata =
        await extractVideoMetadata(file);

      console.log(
        "VIDEO METADATA:",
        addVideoMetadata
      );


      // ---------------------------------------------------
      // Make sure the user has not selected another file
      // while this analysis was running.
      // ---------------------------------------------------

      if (
        addVideoFile.files?.[0] !== file
      ) {
        console.log(
          "Ignoring analysis result for previous file."
        );

        return;
      }


      // ---------------------------------------------------
      // Generate face-aware thumbnail candidates
      // ---------------------------------------------------

      await generateThumbnailCandidates(
        file
      );

    } catch (error) {
      console.error(
        "VIDEO ANALYSIS ERROR:",
        error
      );

      // Don't leave metadata from a failed analysis
      addVideoMetadata = null;

      addVideoThumbnailStatus.textContent =
        "Could not analyse this video.";
    }
  })();
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


    if (!addVideoMetadata) {
     addVideoStatus.textContent =
       "Please wait for video analysis to finish.";
   
     return;
   }
   
   addVideoStatus.textContent =
     "Checking for duplicate…";
   
   const duplicateVideo =
     await findDuplicateVideoByFingerprint(
       addVideoMetadata.fingerprint
     );
   
   if (duplicateVideo) {
     addVideoStatus.textContent =
       `Possible duplicate: "${duplicateVideo.film}" ` +
       `(UID ${duplicateVideo.uid}). ` +
       `Nothing has been uploaded.`;
   
     console.warn(
       "DUPLICATE VIDEO DETECTED:",
       duplicateVideo
     );
   
     return;
   }
     
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
        isLargeFile(payload.file)
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
    canonicalFilename,
    {
      onProgress:
        handleUploadProgress,

      onStatus:
        handleUploadStatus
    }
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
            
            sha1,
            
            onProgress:
              handleUploadProgress
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
               tags: payload.tags,
         
               filesize_bytes:
                 addVideoMetadata.filesizeBytes,
         
               duration_seconds:
                 addVideoMetadata.durationSeconds,
         
               width:
                 addVideoMetadata.width,
         
               height:
                 addVideoMetadata.height,
         
               fingerprint:
                 addVideoMetadata.fingerprint
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
        "ZULU VIDEO CATALOGUE COMPLETE:",
        finalizeData
      );
      
      
      // ---------------------------------------------------
      // 7. Publish selected thumbnail to Backblaze
      // ---------------------------------------------------
      
      const selectedThumbnailBlob =
        getSelectedThumbnailBlob();
      
      if (selectedThumbnailBlob) {
        await uploadThumbnailToBackblaze(
          finalizeData.uid,
          selectedThumbnailBlob,
          {
            onStatus: handleUploadStatus
          }
        );
      } else {
        console.warn(
          "No thumbnail selected — continuing without thumbnail."
        );
      }    


     
      // ---------------------------------------------------
      // 8. Everything completed successfully
      // ---------------------------------------------------
      
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
        addVideoCancel.textContent =
          "Close";
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
