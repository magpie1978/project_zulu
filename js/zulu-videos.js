import { supabase } from "./supabaseClient.js";

const container = document.getElementById("video-container");
const actorList = document.getElementById("actor-sidebar-list");
const actorSort = document.getElementById("actor-sort");
const searchInput = document.getElementById("searchInput");

const modal = document.getElementById("videoModal");
const modalVideo = document.getElementById("modalVideo");
const modalIframe = document.getElementById("modalIframe");
const closeModal = document.getElementById("closeModal");

let activeVideoUid = null;
let viewTimer = null;
let viewLogged = false;

let allVideos = [];
let actorSidebarData = [];
let totalVideoCount = 0;

document.addEventListener("DOMContentLoaded", async () => {
  await loadActorSidebar();
  await loadZuluVideos();
  attachModalEvents();

  if (actorSort) {
    actorSort.addEventListener("change", () => {
      const sidebar = actorList?.parentElement;
      const currentScroll = sidebar ? sidebar.scrollTop : 0;

      renderActorSidebar();

      if (sidebar) {
        sidebar.scrollTop = currentScroll;
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      applySearchFilter();
    });
  }
});

async function fetchAllRows({ table, select, orderColumn }) {
  let allRows = [];
  let from = 0;
  const batchSize = 1000;
  let keepGoing = true;

  while (keepGoing) {
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
      keepGoing = false;
    } else {
      from += batchSize;
    }
  }

  return allRows;
}

async function loadActorSidebar() {
  if (!actorList) return;

  actorList.innerHTML = "";

  try {
    const allRows = await fetchAllRows({
      table: "zulu_videos_with_actors",
      select: "uid, actor",
      orderColumn: "actor"
    });

    const actorCounts = new Map();
    const allVideoIds = new Set();

    allRows.forEach(row => {
      if (!row.uid) return;

      allVideoIds.add(row.uid);

      if (!row.actor) return;

      if (!actorCounts.has(row.actor)) {
        actorCounts.set(row.actor, new Set());
      }

      actorCounts.get(row.actor).add(row.uid);
    });

    totalVideoCount = allVideoIds.size;

    actorSidebarData = [...actorCounts.entries()].map(([actor, videos]) => ({
      actor,
      videoCount: videos.size
    }));

    renderActorSidebar();
  } catch (error) {
    console.error("Error loading actors:", error);
    actorList.innerHTML = `<p class="error">Could not load actors.</p>`;
  }
}

function renderActorSidebar() {
  if (!actorList) return;

  actorList.innerHTML = "";

  const sortMode = actorSort?.value || "actor-asc";

  const sortedActors = [...actorSidebarData].sort((a, b) => {
    if (sortMode === "actor-desc") {
      return b.actor.localeCompare(a.actor);
    }

    if (sortMode === "count-desc") {
      return b.videoCount - a.videoCount || a.actor.localeCompare(b.actor);
    }

    if (sortMode === "count-asc") {
      return a.videoCount - b.videoCount || a.actor.localeCompare(b.actor);
    }

    return a.actor.localeCompare(b.actor);
  });

  const allLink = document.createElement("a");
  allLink.href = "#";
  allLink.className = "actor-link";
  allLink.textContent = `All Videos (${totalVideoCount})`;

  allLink.addEventListener("click", async event => {
    event.preventDefault();
    history.pushState({}, "", "index.html");
    await loadZuluVideos();
  });

  actorList.appendChild(allLink);

  sortedActors.forEach(({ actor, videoCount }) => {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "actor-link";

    const nameSpan = document.createElement("span");
    nameSpan.className = "actor-name";
    nameSpan.textContent = actor;

    const countSpan = document.createElement("span");
    countSpan.className = "actor-count";
    countSpan.textContent = ` (${videoCount})`;

    a.appendChild(nameSpan);
    a.appendChild(countSpan);

    a.addEventListener("click", async event => {
      event.preventDefault();

      history.pushState(
        {},
        "",
        `index.html?actor=${encodeURIComponent(actor)}`
      );

      await loadZuluVideos();
    });

    actorList.appendChild(a);
  });
}

async function loadZuluVideos() {
  if (!container) return;

  const selectedActor = new URLSearchParams(window.location.search).get("actor");

  const { data, error } = await supabase
    .from("zulu_videos_search")
    .select("uid, film, url, actors, actor_search, tags, views")
    .order("film", { ascending: true });

  if (error) {
    console.error("Error loading zulu videos:", error);
    container.innerHTML = `<p class="error">Could not load videos.</p>`;
    return;
  }

  if (!data || data.length === 0) {
    allVideos = [];
    container.innerHTML = `<p class="empty">No videos found.</p>`;
    return;
  }

  allVideos = data;

  if (selectedActor) {
    allVideos = allVideos.filter(video =>
      Array.isArray(video.actors) &&
      video.actors.includes(selectedActor)
    );
  }

  applySearchFilter();
}

function applySearchFilter() {
  const term = searchInput?.value.trim().toLowerCase() || "";

  if (!term) {
    renderVideos(allVideos);
    return;
  }

  const filtered = allVideos.filter(video => {
    const film = (video.film || "").toLowerCase();
    const actors = (video.actor_search || "").toLowerCase();

    return film.includes(term) || actors.includes(term);
  });

  renderVideos(filtered);
}

function renderVideos(videos) {

  const views = video.views || 0;

  
  if (!container) return;

  container.innerHTML = "";

  if (!videos.length) {
    container.innerHTML = `<p class="empty">No matching videos found.</p>`;
    return;
  }

  videos.forEach(video => {
    container.appendChild(renderVideoCard(video));
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  const title = video.film || "Untitled video";
  const videoUrl = video.url || "";
  const thumbnailUrl = `/images/${video.uid}.png`;


  const tags = (video.tags || "")
  .split(",")
  .map(t => t.trim())
  .filter(Boolean);

  const tagsHtml = tags
    .map(tag =>
      `<span
        class="tag-pill"
        style="background:${getTagColor(tag)}"
      >${escapeHTML(tag)}</span>`
    )
    .join("");

  
  card.innerHTML = `
    <div class="thumb-wrap">
      <img
        class="video-thumbnail"
        src="${thumbnailUrl}"
        alt="${escapeHTML(title)} thumbnail"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      >

      <div class="placeholder-thumb">
        <i data-lucide="film"></i>
      </div>

      <div class="play-icon">
        <i data-lucide="play"></i>
      </div>
    </div>

<div class="video-info">
  <h3>${escapeHTML(title)}</h3>

  <div class="video-tags">
    ${tagsHtml}
  </div>
</div>
`;

  card.addEventListener("click", () => {
    openVideo(videoUrl, video.uid);
    });

  
  return card;
}



function openVideo(url, uid) {
  if (!url) {
    console.warn("No video URL found.");
    return;
  }

  if (url.includes("hidrive.ionos.com/lnk/")) {
    url = url.replace("/lnk/", "/dl/");
  }

  activeVideoUid = uid;
viewLogged = false;

if (viewTimer) {
  clearTimeout(viewTimer);
  viewTimer = null;
}

  
  modal.classList.add("open");

  resetModalSources();

  const cleanUrl = url.split("?")[0].toLowerCase();

  const isDirectVideo =
    cleanUrl.endsWith(".mp4") ||
    cleanUrl.includes("hidrive.ionos.com/dl/");

  const isHiDriveSharePage =
    cleanUrl.includes("hidrive.ionos.com/lnk/") ||
    cleanUrl === "https://hidrive.ionos.com/" ||
    cleanUrl.includes("hidrive.ionos.com/share/");

  if (isDirectVideo) {
    modalVideo.src = url;
    modalVideo.style.display = "block";

    modalVideo.play().catch(err => {
      console.error("Video could not be played:", err);
      console.error("Failed video URL:", url);
    });

    viewTimer = setTimeout(() => {
  logVideoView(activeVideoUid);
}, 15000);

    
    return;
  }

  if (isHiDriveSharePage) {
    alert(
      "This video link is a HiDrive share page and cannot be embedded. Use a /dl/ direct MP4 link instead."
    );

    closeVideoModal();
    return;
  }

  modalIframe.src = url;
  modalIframe.style.display = "block";
}

function attachModalEvents() {
  if (closeModal) {
    closeModal.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      closeVideoModal();
    });
  }

  if (modal) {
    modal.addEventListener("click", event => {
      if (event.target === modal) {
        closeVideoModal();
      }
    });
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeVideoModal();
    }
  });
}

function closeVideoModal() {
  modal.classList.remove("open");

  if (viewTimer) {
    clearTimeout(viewTimer);
    viewTimer = null;
  }

  activeVideoUid = null;
  viewLogged = false;

  resetModalSources();
}

function resetModalSources() {
  if (modalVideo) {
    try {
      modalVideo.pause();
    } catch (e) {}

    modalVideo.removeAttribute("src");
    modalVideo.load();
    modalVideo.style.display = "none";
  }

  if (modalIframe) {
    modalIframe.removeAttribute("src");
    modalIframe.style.display = "none";
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


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
