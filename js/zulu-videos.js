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
   INITIALISATIONS
==================================================================================================================== */

// DOMContentLoaded starts the page. 
// It loads the actor sidebar, loads the videos, attaches modal controls, and attaches the search/sort controls.
document.addEventListener("DOMContentLoaded", async () => {
  await loadActorSidebar();
  await loadZuluVideos();

  attachModalEvents();
  attachFilterEvents();
});



/* =================================================================================================================
   EVENT HANDLERS
==================================================================================================================== */

// Connects the actor sort dropdown, search box, and video sort dropdown to the relevant filtering functions.
function attachFilterEvents() {
  actorSort?.addEventListener("change", () => {
    preserveSidebarScroll(() => renderActorSidebar());
  });

  searchInput?.addEventListener("input", applySearchFilter);

  videoSort?.addEventListener("change", applySearchFilter);
}

// Keeps the actor sidebar in the same scroll position when it is re-rendered.
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

// Fetches all rows from Supabase in batches of 1,000, avoiding Supabase’s default row limit.
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

// Loads actor/video data from zulu_videos_with_actors, 
// counts how many unique videos each actor appears in, 
// and stores that data for the sidebar
async function loadActorSidebar() {
  if (!actorList) return;

  actorList.innerHTML = "";

  try {
    const rows = await fetchAllRows({
      table: "zulu_videos_with_actors",
      select: "uid, actor",
      orderColumn: "actor"
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
    actorList.innerHTML = `<p class="error">Could not load actors.</p>`;
  }
}



// Redraws the sidebar, including the “All Videos” link and all actor links.
function renderActorSidebar() {
  if (!actorList) return;

  actorList.innerHTML = "";

  const sortedActors = sortActors(actorSidebarData);

  actorList.appendChild(createAllVideosLink());

  sortedActors.forEach(actorData => {
    actorList.appendChild(createActorLink(actorData));
  });
}



// Sorts the sidebar by actor name or video count
function sortActors(actors) {
  const sortMode = actorSort?.value || "actor-asc";

  return [...actors].sort((a, b) => {
    switch (sortMode) {
      case "actor-desc":
        return b.actor.localeCompare(a.actor);

      case "count-desc":
        return b.videoCount - a.videoCount || a.actor.localeCompare(b.actor);

      case "count-asc":
        return a.videoCount - b.videoCount || a.actor.localeCompare(b.actor);

      case "actor-asc":
      default:
        return a.actor.localeCompare(b.actor);
    }
  });
}



// Creates the sidebar link that resets the page to show every video.
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
  const mainContent = document.querySelector(".main-content");

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
  link.className = selectedActor === actor
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

// Loads the searchable video data, adds view counts, 
// applies the selected actor filter if present, then calls the search/sort renderer
async function loadZuluVideos() {
  if (!container) return;

  const selectedActor = getSelectedActor();

  try {
    const { data: videos, error: videosError } = await supabase
      .from("zulu_videos_search")
      .select("uid, film, url, actors, actor_search, tags")
      .order("film", { ascending: true });

    if (videosError) {
      throw videosError;
    }

    const viewCounts = await loadVideoViewCounts();

    allVideos = (videos || []).map(video => ({
      ...video,
      views: viewCounts.get(String(video.uid)) || 0
    }));

    if (selectedActor) {
      allVideos = allVideos.filter(video =>
        Array.isArray(video.actors) &&
        video.actors.includes(selectedActor)
      );
    }

    applySearchFilter();
  } catch (error) {
    console.error("Error loading zulu videos:", error);
    container.innerHTML = `<p class="error">Could not load videos.</p>`;
  }
}



// Loads view totals from zulu_video_counts and returns them as a map
async function loadVideoViewCounts() {
  const { data, error } = await supabase
    .from("zulu_video_counts")
    .select("video_uid, views");

  if (error) {
    console.error("Error loading video counts:", error);
    return new Map();
  }

  return new Map(
    (data || []).map(row => [
      String(row.video_uid),
      Number(row.views || 0)
    ])
  );
}



// reads the selected actor from the page URL
function getSelectedActor() {
  return new URLSearchParams(window.location.search).get("actor");
}



/* =================================================================================================================
   SEARCHING & SORTING
==================================================================================================================== */

// Applies the search box filter, applies the selected video sort order, and redraws the video grid.
function applySearchFilter() {
  const searchTerm = searchInput?.value.trim().toLowerCase() || "";

  let filteredVideos = [...allVideos];

  if (searchTerm) {
    filteredVideos = filteredVideos.filter(video =>
      videoMatchesSearch(video, searchTerm)
    );
  }

  filteredVideos = sortVideos(filteredVideos);

  renderVideos(filteredVideos);
}



// Checks whether the search term appears in the film title, actor list, or tags.
function videoMatchesSearch(video, term) {
  const film = (video.film || "").toLowerCase();
  const actors = (video.actor_search || "").toLowerCase();
  const tags = (video.tags || "").toLowerCase();

  return (
    film.includes(term) ||
    actors.includes(term) ||
    tags.includes(term)
  );
}



// Sorts by title or views
function sortVideos(videos) {
  const sortMode = videoSort?.value || "film-asc";

  return [...videos].sort((a, b) => {
    switch (sortMode) {
      case "film-desc":
        return (b.film || "").localeCompare(a.film || "");

      case "views-desc":
        return Number(b.views || 0) - Number(a.views || 0);

      case "views-asc":
        return Number(a.views || 0) - Number(b.views || 0);

      case "film-asc":
      default:
        return (a.film || "").localeCompare(b.film || "");
    }
  });
}



/* =================================================================================================================
   VIDEO RENDERING
==================================================================================================================== */

// Clears and redraws the video grid.
function renderVideos(videos) {
  if (!container) return;

  container.innerHTML = "";

  if (!videos.length) {
    container.innerHTML = `<p class="empty">No matching videos found.</p>`;
    return;
  }

  videos.forEach(video => {
    container.appendChild(renderVideoCard(video));
  });

  window.lucide?.createIcons();
}



// Builds one video card, including thumbnail, title, view count, tags, play icon, and click behaviour.
function renderVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  const title = video.film || "Untitled video";
  const thumbnailUrl = `/images/${video.uid}.png`;
  const views = Number(video.views || 0);
  const tagsHtml = createTagsHtml(video.tags);

  card.innerHTML = `
    <div class="thumb-wrap">
      <img
        class="video-thumbnail"
        src="${thumbnailUrl}"
        alt="${escapeHTML(title)} thumbnail"
        loading="lazy"
        onerror="this.onerror=null; this.src='/images/default.png';"
      >

      <div class="play-icon">
        <i data-lucide="play"></i>
      </div>
    </div>

    <div class="video-info">
      <h3>${escapeHTML(title)}</h3>

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

  card.addEventListener("click", () => {
    openVideo(video.url, video.uid);
  });

  return card;
}



// Turns comma-separated tags into styled tag pills
function createTagsHtml(tagsString) {
  return String(tagsString || "")
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => `
      <span
        class="tag-pill"
        style="background:${getTagColor(tag)}"
      >${escapeHTML(tag)}</span>
    `)
    .join("");
}



/* =================================================================================================================
   VIDEO MODAL
==================================================================================================================== */

// Opens the modal and decides whether to use the <video> player or an iframe.
function openVideo(url, uid) {
  if (!url) {
    console.warn("No video URL found.");
    return;
  }

  if (!modal || !modalVideo) return;

  activeVideoUid = uid;
  viewLogged = false;

  clearViewTimer();
  resetModalSources();

  modal.classList.add("open");
  document.body.classList.add("modal-open");

  modalVideo.src = url;
  modalVideo.style.display = "block";

  modalVideo.play().catch(error => {
    console.error("Video could not be played:", error);
    console.error("Failed video URL:", url);
  });

  startViewTimer();
}



// Loads the video into the modal video player
function playDirectVideo(url) {
  if (!modalVideo) return;

  modalVideo.src = url;
  modalVideo.style.display = "block";

  modalVideo.play().catch(error => {
    console.error("Video could not be played:", error);
    console.error("Failed video URL:", url);
  });
}



// Allows the user to close the modal using the close button, clicking outside the video, or pressing Escape
function attachModalEvents() {
  closeModal?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    closeVideoModal();
  });

  modal?.addEventListener("click", event => {
    if (event.target === modal) {
      closeVideoModal();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeVideoModal();
    }
  });
}



// Closes the modal, stops playback, clears the view timer, and resets the current video state.
function closeVideoModal() {
  modal?.classList.remove("open");
  document.body.classList.remove("modal-open");
   
  clearViewTimer();
  resetModalSources();

  activeVideoUid = null;
  viewLogged = false;
}


// Removes video and iframe sources so playback fully stops
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

// Starts a 15-second timer before logging a view
function startViewTimer() {
  clearViewTimer();

  viewTimer = setTimeout(() => {
    logVideoView(activeVideoUid);
  }, 15000);
}



// Clears any existing view timer
function clearViewTimer() {
  if (viewTimer) {
    clearTimeout(viewTimer);
    viewTimer = null;
  }
}



// Inserts a view record into zulu_video_views once a video has been watched for 15 seconds.
async function logVideoView(uid) {
  if (!uid || viewLogged) return;

  viewLogged = true;

  const { error } = await supabase
    .from("zulu_video_views")
    .insert({
      video_uid: uid,
      watch_seconds: 15
    });

  if (error) {
    console.error("Error logging video view:", error);
  }
}



/* =================================================================================================================
   UTILITIES
==================================================================================================================== */

// Assigns colours to known tags
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



// Safely escapes text before inserting it into HTML
function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
