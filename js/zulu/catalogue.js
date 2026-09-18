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


/* =====================================================================
   CATALOGUE.JS
   =====================================================================

   PURPOSE
   -------

   This module manages the main Zulu Videos catalogue.

   Its responsibilities are:

   1. Load video records from Supabase.
   2. Load the current view count for each video.
   3. Apply the actor filter selected in the sidebar.
   4. Store the resulting catalogue locally.
   5. Apply free-text searching across:
        - film title
        - actor names
        - tags
   6. Sort videos according to the selected catalogue sort mode.
   7. Render the video grid and individual video cards.
   8. Display:
        - thumbnail
        - title
        - video quality
        - file size
        - duration
        - view count
        - upload date
        - tags
   9. Open a video when its card is selected.
   10. Hand video deletion to delete-video.js.
   11. Refresh the catalogue after a successful deletion.

   DATA SOURCES
   ------------

   zulu_videos_search

       Main catalogue/search view.

       Fields used here:

           uid
           film
           url
           actors
           actor_search
           tags
           filesize_bytes
           duration_seconds
           width
           height
           ingested_at


   zulu_video_counts

       Supplies the current view count for each video.

       Fields used here:

           video_uid
           views


   RELATED MODULES
   ---------------

   actors.js

       Supplies the actor currently selected in the sidebar.

   playback.js

       Opens and plays the selected video.

   delete-video.js

       Handles confirmation and deletion of a video.

   utils.js

       Provides formatting and HTML escaping helpers.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
   =====================================================================

   Cache the catalogue interface elements used throughout this module.
===================================================================== */

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


/* =====================================================================
   02. MODULE STATE
   =====================================================================

   allVideos
       Local copy of the currently loaded catalogue.

       If an actor has been selected in the sidebar, this array contains
       only videos associated with that actor.

       Search and sort operations are performed against this local array
       rather than repeatedly querying Supabase.

   onVideoDeleted
       Optional callback supplied by the parent application.

       It is called after a successful deletion so other parts of the
       interface, such as the actor sidebar/counts, can be refreshed.
===================================================================== */

let allVideos = [];

let onVideoDeleted = null;


/* =====================================================================
   03. INITIALISATION / EVENT BINDING
===================================================================== */

/**
 * Attaches catalogue event listeners.
 *
 * Search results update immediately while the user types.
 * Changing the sort selector re-applies the current search and then
 * renders the catalogue using the new order.
 *
 * The optional onDeleted callback allows the parent application to
 * refresh other components after a video is deleted.
 *
 * @param {Object} options
 * @param {Function} [options.onDeleted]
 */
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


/* =====================================================================
   04. LOAD VIDEO CATALOGUE
===================================================================== */

/**
 * Loads the video catalogue from Supabase.
 *
 * Workflow:
 *
 *   1. Determine whether an actor is selected in the sidebar.
 *   2. Load all catalogue records from zulu_videos_search.
 *   3. Load video view counts from zulu_video_counts.
 *   4. Merge each video's view count into its catalogue object.
 *   5. Apply the selected actor filter, if present.
 *   6. Apply the current search and sort settings.
 *   7. Render the resulting catalogue.
 *
 * The actor filter is applied before the free-text search so searches
 * performed while viewing an actor only search that actor's videos.
 */
export async function loadZuluVideos() {

  if (!container) {
    return;
  }


  const selectedActor =
    getSelectedActor();


  try {

    /* ---------------------------------------------------------------
       LOAD MAIN VIDEO DATA
    --------------------------------------------------------------- */

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


    /* ---------------------------------------------------------------
       LOAD VIEW COUNTS
    --------------------------------------------------------------- */

    const viewCounts =
      await loadVideoViewCounts();


    /* ---------------------------------------------------------------
       MERGE CATALOGUE + VIEW COUNTS
    --------------------------------------------------------------- */

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


    /* ---------------------------------------------------------------
       APPLY ACTOR SIDEBAR FILTER
    --------------------------------------------------------------- */

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


    /*
     * Search, sorting and rendering all happen from the local
     * allVideos array.
     */
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


/* =====================================================================
   05. LOAD VIDEO VIEW COUNTS
===================================================================== */

/**
 * Loads view counts from zulu_video_counts.
 *
 * Returns a Map rather than an array so that a video's view count can
 * be retrieved efficiently by UID while the catalogue records are
 * being merged.
 *
 * Example:
 *
 *     Map {
 *       "1525" => 12,
 *       "1526" => 4,
 *       "1527" => 31
 *     }
 *
 * If the view-count query fails, the catalogue itself is still allowed
 * to load. An empty Map is returned and videos therefore display zero
 * views rather than failing the complete catalogue.
 *
 * @returns {Promise<Map<string, number>>}
 */
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


/* =====================================================================
   06. SEARCHING
===================================================================== */

/**
 * Applies the current search term and sort mode to the locally loaded
 * catalogue, then renders the result.
 *
 * The original allVideos array is not modified.
 *
 * This function is shared by:
 *
 *   - the search input;
 *   - the video sort selector;
 *   - the initial catalogue load.
 */
function applySearchFilter() {

  const searchTerm =
    searchInput?.value
      .trim()
      .toLowerCase() ||
    "";


  let filteredVideos =
    [...allVideos];


  /*
   * An empty search term means all currently loaded videos should
   * remain visible.
   */
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


  /*
   * Sorting is applied after filtering so only the visible result set
   * needs to be sorted.
   */
  filteredVideos =
    sortVideos(
      filteredVideos
    );


  renderVideos(
    filteredVideos
  );
}


/**
 * Determines whether a video matches the current free-text search.
 *
 * Searchable fields:
 *
 *   film
 *       Film/video title.
 *
 *   actor_search
 *       Searchable actor text supplied by zulu_videos_search.
 *
 *   tags
 *       Video tags.
 *
 * The supplied search term is already lower-case. The searchable
 * fields are normalised to lower-case here for case-insensitive
 * matching.
 *
 * @param {Object} video
 * @param {string} term
 * @returns {boolean}
 */
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


/* =====================================================================
   07. SORTING
===================================================================== */

/**
 * Returns a sorted COPY of the supplied video array.
 *
 * Supported modes:
 *
 *   film-asc
 *       Film title A → Z.
 *
 *   film-desc
 *       Film title Z → A.
 *
 *   uploaded-desc
 *       Most recently ingested first.
 *
 *   uploaded-asc
 *       Oldest ingested first.
 *
 *   views-desc
 *       Most watched first.
 *
 *   views-asc
 *       Least watched first.
 *
 * The original array is never modified.
 *
 * @param {Array} videos
 * @returns {Array}
 */
function sortVideos(videos) {

  const sortMode =
    videoSort?.value ||
    "film-asc";


  return [...videos].sort(
    (a, b) => {

      switch (sortMode) {

        /* -----------------------------------------------------------
           FILM TITLE Z → A
        ----------------------------------------------------------- */

        case "film-desc":

          return (
            b.film || ""
          ).localeCompare(
            a.film || ""
          );


        /* -----------------------------------------------------------
           NEWEST UPLOAD → OLDEST
        ----------------------------------------------------------- */

        case "uploaded-desc":

          return String(
            b.ingested_at || ""
          ).localeCompare(
            String(
              a.ingested_at || ""
            )
          );


        /* -----------------------------------------------------------
           OLDEST UPLOAD → NEWEST
        ----------------------------------------------------------- */

        case "uploaded-asc":

          return String(
            a.ingested_at || ""
          ).localeCompare(
            String(
              b.ingested_at || ""
            )
          );


        /* -----------------------------------------------------------
           MOST WATCHED → LEAST WATCHED
        ----------------------------------------------------------- */

        case "views-desc":

          return (
            Number(
              b.views || 0
            ) -
            Number(
              a.views || 0
            )
          );


        /* -----------------------------------------------------------
           LEAST WATCHED → MOST WATCHED
        ----------------------------------------------------------- */

        case "views-asc":

          return (
            Number(
              a.views || 0
            ) -
            Number(
              b.views || 0
            )
          );


        /* -----------------------------------------------------------
           FILM TITLE A → Z
        ----------------------------------------------------------- */

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


/* =====================================================================
   08. VIDEO GRID RENDERING
===================================================================== */

/**
 * Renders the supplied videos into the catalogue container.
 *
 * The existing grid contents are cleared before rendering.
 *
 * If there are no videos, an empty-state message is displayed instead.
 *
 * Lucide icons are recreated after the cards have been inserted because
 * the play icons are added dynamically through renderVideoCard().
 *
 * @param {Array} videos
 */
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


  /*
   * Convert dynamically inserted data-lucide elements into icons.
   */
  window.lucide?.createIcons();
}


/* =====================================================================
   09. VIDEO CARD RENDERING
===================================================================== */

/**
 * Creates a complete catalogue card for one video.
 *
 * The card displays:
 *
 *   - thumbnail
 *   - play overlay
 *   - title
 *   - video quality
 *   - file size
 *   - duration
 *   - view count
 *   - upload date
 *   - tags
 *   - delete button
 *
 * Clicking the card opens video playback.
 *
 * Clicking the delete button stops the card click from propagating and
 * instead starts the delete-video.js workflow.
 *
 * @param {Object} video
 * @returns {HTMLElement}
 */
function renderVideoCard(video) {

  const card =
    document.createElement(
      "article"
    );


  card.className =
    "video-card";


  /* -----------------------------------------------------------------
     PREPARE DISPLAY VALUES
  ----------------------------------------------------------------- */

  const title =
    video.film ||
    "Untitled video";


  /*
   * Thumbnails are stored using the video's UID.
   *
   * Example:
   *
   *     /images/1525.png
   */
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


  /*
   * Display ingestion dates in UK format:
   *
   *     18 Sep 2026
   */
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


  /*
   * Only available technical values are included.
   *
   * Example:
   *
   *     1080p • 1.2 GB • 42:18
   */
  const technicalMeta =
    [
      quality,
      fileSize,
      duration
    ]
      .filter(Boolean)
      .join(" • ");


  /* -----------------------------------------------------------------
     BUILD CARD MARKUP
  ----------------------------------------------------------------- */

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


  /* -----------------------------------------------------------------
     DELETE BUTTON
  ----------------------------------------------------------------- */

  const deleteButton =
    card.querySelector(
      ".video-delete-btn"
    );


  deleteButton?.addEventListener(
    "click",
    async event => {

      /*
       * Prevent the delete-button click from also triggering the card's
       * playback click handler.
       */
      event.preventDefault();
      event.stopPropagation();


      /*
       * deleteZuluVideo() owns the confirmation and actual deletion
       * workflow.
       */
      await deleteZuluVideo(
        video,
        deleteButton,
        {
          onDeleted:
            async () => {

              /*
               * Notify the parent application first. This allows
               * components such as the actor sidebar to refresh their
               * counts after the deletion.
               */
              if (
                onVideoDeleted
              ) {
                await onVideoDeleted();
              }


              /*
               * Reload the catalogue itself so the deleted card
               * disappears and all counts/data are current.
               */
              await loadZuluVideos();
            }
        }
      );
    }
  );


  /* -----------------------------------------------------------------
     VIDEO PLAYBACK
  ----------------------------------------------------------------- */

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


/* =====================================================================
   10. TAG RENDERING
===================================================================== */

/**
 * Converts a comma-separated tag string into HTML tag pills.
 *
 * Example input:
 *
 *     "group, threesome"
 *
 * becomes two separately coloured <span> elements.
 *
 * Blank tags are discarded and tag text is HTML escaped before being
 * inserted into the card.
 *
 * @param {string} tagsString
 * @returns {string}
 */
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


/**
 * Returns the display colour assigned to a catalogue tag.
 *
 * Known tags receive a fixed colour so they remain visually consistent
 * throughout the catalogue.
 *
 * Unknown tags fall back to #444.
 *
 * @param {string} tag
 * @returns {string}
 */
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
