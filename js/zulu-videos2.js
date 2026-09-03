import { supabase } from "./supabaseClient.js";

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
