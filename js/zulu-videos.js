import { supabase } from "./supabaseClient.js";

const container = document.getElementById("video-container");
const actorList = document.getElementById("actor-sidebar-list");
const actorSort = document.getElementById("actor-sort");
const searchInput = document.getElementById("searchInput");

const modal = document.getElementById("videoModal");
const modalVideo = document.getElementById("modalVideo");
const modalIframe = document.getElementById("modalIframe");
const closeModal = document.getElementById("closeModal");

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

  let query = supabase
    .from("zulu_videos_with_actors")
    .select("uid, film, url, actor")
    .order("film", { ascending: true });

  if (selectedActor) {
    query = query.eq("actor", selectedActor);
  }

  const { data, error } = await query;

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

  const groupedVideos = {};

  data.forEach(row => {
    if (!row.uid) return;

    if (!groupedVideos[row.uid]) {
      groupedVideos[row.uid] = {
        uid: row.uid,
        film: row.film,
        url: row.url,
        actors: []
      };
    }

    if (row.actor && !groupedVideos[row.uid].actors.includes(row.actor)) {
      groupedVideos[row.uid].actors.push(row.actor);
    }
  });

  allVideos = Object.values(groupedVideos);

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
    const actors = (video.actors || []).join(" ").toLowerCase();

    return film.includes(term) || actors.includes(term);
  });

  renderVideos(filtered);
}

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

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  const title = video.film || "Untitled video";
  const videoUrl = video.url || "";

  card.innerHTML = `
    <div class="thumb-wrap">
      <div class="placeholder-thumb">
        <i data-lucide="film"></i>
      </div>

      <div class="play-icon">
        <i data-lucide="play"></i>
      </div>
    </div>

    <div class="video-info">
      <h3>${escapeHTML(title)}</h3>
    </div>
  `;

  card.addEventListener("click", () => {
    openVideo(videoUrl);
  });

  return card;
}

function openVideo(url) {
  if (!url) {
    console.warn("No video URL found.");
    return;
  }

  if (url.includes("hidrive.ionos.com/lnk/")) {
    url = url.replace("/lnk/", "/dl/");
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
