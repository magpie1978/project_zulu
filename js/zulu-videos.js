import { supabase } from "./supabaseClient.js";

const container = document.getElementById("video-container");
const actorList = document.getElementById("actor-sidebar-list");

const modal = document.getElementById("videoModal");
const modalVideo = document.getElementById("modalVideo");
const modalIframe = document.getElementById("modalIframe");
const closeModal = document.getElementById("closeModal");

document.addEventListener("DOMContentLoaded", async () => {
  await loadActorSidebar();
  await loadZuluVideos();
});

async function loadActorSidebar() {
  const { data, error } = await supabase
    .from("zulu_distinct_actors")
    .select("actor")
    .order("actor", { ascending: true });

  if (error) {
    console.error("Error loading actors:", error);
    return;
  }

  actorList.innerHTML = "";

  const allLink = document.createElement("a");
  allLink.href = "index.html";
  allLink.className = "actor-link";
  allLink.textContent = "All Videos";
  actorList.appendChild(allLink);

  data.forEach(row => {
    const actor = row.actor;
    if (!actor) return;

    const a = document.createElement("a");
    a.href = `index.html?actor=${encodeURIComponent(actor)}`;
    a.className = "actor-link";
    a.textContent = actor;

    actorList.appendChild(a);
  });
}

async function loadZuluVideos() {
  const actor = new URLSearchParams(window.location.search).get("actor");

  let query = supabase
    .from("zulu_videos_with_actors")
    .select("uid, film, url, actor")
    .order("film", { ascending: true });

  if (actor) {
    query = query.eq("actor", actor);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error loading zulu videos:", error);
    container.innerHTML = `<p class="error">Could not load videos.</p>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `<p class="empty">No videos found.</p>`;
    return;
  }

  const uniqueVideos = Array.from(
    new Map(data.map(row => [row.uid, row])).values()
  );

  container.innerHTML = "";

  uniqueVideos.forEach(video => {
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

  modal.classList.add("open");

  modalVideo.pause();
  modalVideo.removeAttribute("src");
  modalVideo.style.display = "none";

  modalIframe.removeAttribute("src");
  modalIframe.style.display = "none";

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
    });

    return;
  }

  if (isHiDriveSharePage) {
    console.error("This HiDrive URL cannot be embedded. Use a /dl/ direct MP4 link instead:", url);
    alert("This video link is a HiDrive share page and cannot be embedded. Use a /dl/ direct MP4 link instead.");
    closeVideoModal();
    return;
  }

  modalIframe.src = url;
  modalIframe.style.display = "block";
}

function closeVideoModal() {
  modal.classList.remove("open");
  modalVideo.pause();
  modalVideo.removeAttribute("src");
  modalIframe.removeAttribute("src");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
