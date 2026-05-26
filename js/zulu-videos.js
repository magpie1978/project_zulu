import { supabase } from "./supabaseClient.js";

const container = document.getElementById("video-container");
const modal = document.getElementById("videoModal");
const modalVideo = document.getElementById("modalVideo");
const modalIframe = document.getElementById("modalIframe");
const closeModal = document.getElementById("closeModal");

document.addEventListener("DOMContentLoaded", loadZuluVideos);

async function loadZuluVideos() {
  const { data, error } = await supabase
    .from("zulu_videos")
    .select("*")
    .order("id", { ascending: false });

  if (error) {
    console.error("Error loading zulu_videos:", error);
    container.innerHTML = `<p class="error">Could not load videos.</p>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `<p class="empty">No videos found.</p>`;
    return;
  }

  container.innerHTML = "";
  data.forEach(video => container.appendChild(renderVideoCard(video)));

  if (window.lucide) window.lucide.createIcons();
}

function renderVideoCard(video) {
  const card = document.createElement("article");
  card.className = "video-card";

  const title =
    video.title ||
    video.Title ||
    video.song ||
    video.Song ||
    "Untitled video";

  const subtitle =
    video.artist ||
    video.Artist ||
    video.country ||
    video.Country ||
    "";

  const image =
    video.image ||
    video.Image ||
    video.thumbnail ||
    video.Thumbnail ||
    "images/placeholder.jpg";

  const videoUrl =
    video.video_url ||
    video.Video_URL ||
    video.url ||
    video.URL;

  card.innerHTML = `
    <div class="thumb-wrap">
      <img src="${escapeHTML(image)}" alt="${escapeHTML(title)}" class="thumb">
      <div class="play-icon">
        <i data-lucide="play"></i>
      </div>
    </div>

    <div class="video-info">
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(subtitle)}</p>
    </div>
  `;

  card.addEventListener("click", () => openVideo(videoUrl));

  return card;
}

function openVideo(url) {
  if (!url) return;

  modal.classList.add("open");

  modalVideo.pause();
  modalVideo.removeAttribute("src");
  modalVideo.style.display = "none";

  modalIframe.removeAttribute("src");
  modalIframe.style.display = "none";

  if (url.endsWith(".mp4")) {
    modalVideo.src = url;
    modalVideo.style.display = "block";
    modalVideo.play();
  } else {
    modalIframe.src = url;
    modalIframe.style.display = "block";
  }
}

closeModal.addEventListener("click", closeVideoModal);
modal.addEventListener("click", e => {
  if (e.target === modal) closeVideoModal();
});

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
