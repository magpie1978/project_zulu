import { supabase } from "../supabaseClient.js";

import {
  formatVideoQuality,
  formatVideoDuration,
  formatBytes,
  escapeHTML
} from "./utils.js";

import {
  openVideo
} from "./playback.js";

import {
  deleteZuluVideo
} from "./delete-video.js";

import {
  getSelectedActor
} from "./actors.js";


const container =
  document.getElementById(
    "video-container"
  );

const searchInput =
  document.getElementById(
    "searchInput"
  );

const videoSort =
  document.getElementById(
    "video-sort"
  );


let allVideos = [];
let onVideoDeleted = null;


/* =================================================================================================================
   INITIALISATION
==================================================================================================================== */

export function attachCatalogueEvents({
  onDeleted
} = {}) {
  onVideoDeleted =
    typeof onDeleted === "function"
      ? onDeleted
      : null;

  searchInput?.addEventListener(
    "input",
    applySearchFilter
  );

  videoSort?.addEventListener(
    "change",
    applySearchFilter
  );
}


/* =================================================================================================================
   VIDEO LOADING
==================================================================================================================== */

export async function loadZuluVideos() {
  if (!container) {
    return;
  }

  const selectedActor =
    getSelectedActor();

  try {
    const {
      data: videos,
      error: videosError
    } =
      await supabase
        .from(
          "zulu_videos_search"
        )
        .select(
          "uid, film, url, actors, actor_search, tags, filesize_bytes, duration_seconds, width, height, ingested_at"
        )
        .order(
          "film",
          {
            ascending: true
          }
        );

    if (videosError) {
      throw videosError;
    }

    const viewCounts =
      await loadVideoViewCounts();

    allVideos =
      (videos || []).map(
        video => ({
          ...video,

          views:
            viewCounts.get(
              String(video.uid)
            ) || 0
        })
      );

    if (selectedActor) {
      allVideos =
        allVideos.filter(
          video =>
            Array.isArray(
              video.actors
            ) &&
            video.actors.includes(
              selectedActor
            )
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
  const {
    data,
    error
  } =
    await supabase
      .from(
        "zulu_video_counts"
      )
      .select(
        "video_uid, views"
      );

  if (error) {
    console.error(
      "Error loading video counts:",
      error
    );

    return new Map();
  }

  return new Map(
    (data || []).map(
      row => [
        String(
          row.video_uid
        ),

        Number(
          row.views || 0
        )
      ]
    )
  );
}


/* =================================================================================================================
   SEARCHING & SORTING
==================================================================================================================== */

function applySearchFilter() {
  const searchTerm =
    searchInput?.value
      .trim()
      .toLowerCase() ||
    "";

  let filteredVideos =
    [...allVideos];

  if (searchTerm) {
    filteredVideos =
      filteredVideos.filter(
        video =>
          videoMatchesSearch(
            video,
            searchTerm
          )
      );
  }

  filteredVideos =
    sortVideos(
      filteredVideos
    );

  renderVideos(
    filteredVideos
  );
}


function videoMatchesSearch(
  video,
  term
) {
  const film =
    (video.film || "")
      .toLowerCase();

  const actors =
    (video.actor_search || "")
      .toLowerCase();

  const tags =
    (video.tags || "")
      .toLowerCase();

  return (
    film.includes(term) ||
    actors.includes(term) ||
    tags.includes(term)
  );
}


function sortVideos(videos) {
  const sortMode =
    videoSort?.value ||
    "film-asc";

  return [...videos].sort(
    (a, b) => {
      switch (sortMode) {

        case "film-desc":
          return (
            b.film || ""
          ).localeCompare(
            a.film || ""
          );

        case "uploaded-desc":
          return (
            new Date(
              b.ingested_at || 0
            ).getTime() -
            new Date(
              a.ingested_at || 0
            ).getTime()
          );

        case "uploaded-asc":
          return (
            new Date(
              a.ingested_at || 0
            ).getTime() -
            new Date(
              b.ingested_at || 0
            ).getTime()
          );

        case "views-desc":
          return (
            Number(
              b.views || 0
            ) -
            Number(
              a.views || 0
            )
          );

        case "views-asc":
          return (
            Number(
              a.views || 0
            ) -
            Number(
              b.views || 0
            )
          );

        case "film-asc":
        default:
          return (
            a.film || ""
          ).localeCompare(
            b.film || ""
          );
      }
    }
  );
}

/* =================================================================================================================
   VIDEO RENDERING
==================================================================================================================== */

function renderVideos(videos) {
  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!videos.length) {
    container.innerHTML =
      `<p class="empty">No matching videos found.</p>`;

    return;
  }

  videos.forEach(
    video => {
      container.appendChild(
        renderVideoCard(
          video
        )
      );
    }
  );

  window.lucide?.createIcons();
}


function renderVideoCard(video) {
  const card =
    document.createElement(
      "article"
    );

  card.className =
    "video-card";

  const title =
    video.film ||
    "Untitled video";

  const thumbnailUrl =
    `https://media.zulu-orchid-falcon.co.uk/images/${video.uid}.png`;

  const views =
    Number(
      video.views || 0
    );

  const tagsHtml =
    createTagsHtml(
      video.tags
    );

  const quality =
    formatVideoQuality(
      video.width,
      video.height
    );

  const fileSize =
    video.filesize_bytes
      ? formatBytes(
          video.filesize_bytes
        )
      : "";

  const duration =
    formatVideoDuration(
      video.duration_seconds
    );

  const uploadedDate =
  video.ingested_at
    ? new Date(
        video.ingested_at
      ).toLocaleDateString(
        "en-GB",
        {
          day: "numeric",
          month: "short",
          year: "numeric"
        }
      )
    : "";

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

      ${
        technicalMeta
          ? `
            <div class="video-tech-meta">
              ${escapeHTML(technicalMeta)}
            </div>
          `
          : ""
      }

        <div class="video-meta">
        
          <div class="video-card-details">
          
            <span class="video-meta-pill">
              <i data-lucide="eye"></i>
              ${views.toLocaleString()}
            </span>
          
            ${
              uploadedDate
                ? `
                  <span class="video-meta-pill">
                    ${escapeHTML(uploadedDate)}
                  </span>
                `
                : ""
            }
          
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
      event.stopPropagation();

      await deleteZuluVideo(
        video,
        deleteButton,
        {
          onDeleted:
            async () => {
              if (
                onVideoDeleted
              ) {
                await onVideoDeleted();
              }

              await loadZuluVideos();
            }
        }
      );
    }
  );


  card.addEventListener(
    "click",
    () => {
      openVideo(
        video.url,
        video.uid
      );
    }
  );

  return card;
}


/* =================================================================================================================
   TAGS
==================================================================================================================== */

function createTagsHtml(
  tagsString
) {
  return String(
    tagsString || ""
  )
    .split(",")
    .map(
      tag =>
        tag.trim()
    )
    .filter(Boolean)
    .map(
      tag => `
        <span
          class="tag-pill"
          style="background:${getTagColor(tag)}"
        >
          ${escapeHTML(tag)}
        </span>
      `
    )
    .join("");
}


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
