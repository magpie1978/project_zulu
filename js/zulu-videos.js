import { supabase } from "./supabaseClient.js";

/* =========================
   DOM ELEMENTS
========================= */

const container = document.getElementById("video-container");
const actorList = document.getElementById("actor-sidebar-list");
const actorSort = document.getElementById("actor-sort");
const searchInput = document.getElementById("searchInput");
const videoSort = document.getElementById("video-sort");

const modal = document.getElementById("videoModal");
const modalVideo = document.getElementById("modalVideo");
const modalIframe = document.getElementById("modalIframe");
const closeModal = document.getElementById("closeModal");

/* =========================
   STATE
========================= */

let allVideos = [];
let actorSidebarData = [];
let totalVideoCount = 0;

let activeVideoUid = null;
let viewTimer = null;
let viewLogged = false;

/* =========================
   INITIALISATION
========================= */

document.addEventListener("DOMContentLoaded", async () => {
  await loadActorSidebar();
  await loadZuluVideos();

  attachModalEvents();
  attachFilterEvents();
});

/* =========================
   EVENT HANDLERS
========================= */

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

/* =========================
   SUPABASE HELPERS
========================= */

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

/* =========================
   ACTOR SIDEBAR
========================= */

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
        return b.videoCount - a.videoCount || a.actor.localeCompare(b.actor);

      case "count-asc":
        return a.videoCount - b.videoCount || a.actor.localeCompare(b.actor);

      case "actor-asc":
      default:
        return a.actor.localeCompare(b.actor);
    }
  });
}

function createAllVideosLink() {
  const link = document.createElement("a");

  link.href = "#";
  link.className = "actor-link";
  link.textContent = `All Videos (${totalVideoCount})`;

  link.addEventListener("click", async event => {
    event.preventDefault();

    history.pushState({}, "", "index.html");
    await loadZuluVideos();
  });

  return link;
}

function createActorLink({ actor, videoCount }) {
  const link = document.createElement("a");

  link.href = "#";
  link.className = "actor-link";

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

    await loadZuluVideos();
  });

  return link;
}

/* =========================
   VIDEO LOADING
========================= */

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

function getSelectedActor() {
  return new URLSearchParams(window.location.search).get("actor");
}

/* =========================
   SEARCHING AND SORTING
========================= */

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


/* =========================
   VIDEO RENDERING
========================= */

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

/* =========================
   VIDEO MODAL
========================= */

function openVideo(url, uid) {
  if (!url) {
    console.warn("No video URL found.");
    return;
  }

  if (!modal) return;

  activeVideoUid = uid;
  viewLogged = false;

  clearViewTimer();
  resetModalSources();

  modal.classList.add("open");

  if (isDirectVideoUrl(url)) {
    playDirectVideo(url);
    startViewTimer();
    return;
  }

  showIframeVideo(url);
}




function isDirectVideoUrl(url) {
  const cleanUrl = url.split("?")[0].toLowerCase();

  return cleanUrl.endsWith(".mp4");
}



function playDirectVideo(url) {
  if (!modalVideo) return;

  modalVideo.src = url;
  modalVideo.style.display = "block";

  modalVideo.play().catch(error => {
    console.error("Video could not be played:", error);
    console.error("Failed video URL:", url);
  });
}

function showIframeVideo(url) {
  if (!modalIframe) return;

  modalIframe.src = url;
  modalIframe.style.display = "block";
}

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

function closeVideoModal() {
  modal?.classList.remove("open");

  clearViewTimer();
  resetModalSources();

  activeVideoUid = null;
  viewLogged = false;
}

function resetModalSources() {
  if (modalVideo) {
    try {
      modalVideo.pause();
    } catch {
      // Ignore pause errors
    }

    modalVideo.removeAttribute("src");
    modalVideo.load();
    modalVideo.style.display = "none";
  }

  if (modalIframe) {
    modalIframe.removeAttribute("src");
    modalIframe.style.display = "none";
  }
}

/* =========================
   VIEW LOGGING
========================= */

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

/* =========================
   UTILITIES
========================= */

function getTagColor(tag) {
  const colors = {
    tag1: "#2563eb",
    tag2: "#dc2626",
    tag3: "#16a34a",
    Amateur: "#9333ea",
    Bareback: "#ea580c",
    Group: "#0891b2",
    Solo: "#64748b"
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
