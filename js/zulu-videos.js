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
    .select("uid, film, url")
    .order("uid", { ascending: true });

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

  data.forEach(video => {
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

  if (cleanUrl.endsWith(".mp4")) {
    modalVideo.src = url;
    modalVideo.style.display = "block";
    modalVideo.play();
  } else {
    modalIframe.src = url;
    modalIframe.style.display = "block";
  }
}

closeModal.addEventListener("click", closeVideoModal);

modal.addEventListener("click", event => {
  if (event.target === modal) {
    closeVideoModal();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeVideoModal();
  }
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
