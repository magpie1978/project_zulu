import {
  supabase
} from "../supabaseClient.js";


/* =====================================================================
   ADMIN.JS
   =====================================================================

   PURPOSE
   -------

   Powers the PornFlix Library Health / Admin dashboard.

   Version 1 deliberately reads only from Supabase.

   It provides:

       • catalogue video count
       • actor count
       • total video views
       • ingestion count
       • ingestion health summary
       • recent ingestion history
       • expandable ingestion diagnostics

   Backblaze reconciliation is NOT performed here.

   Future storage integrity checks must run server-side so Backblaze
   application credentials are never exposed to the browser.

   ===================================================================== */


/* =====================================================================
   01. CONFIGURATION
===================================================================== */

const RECENT_INGESTION_LIMIT =
  50;


/*
 * States which represent a currently unfinished ingestion.
 *
 * complete, complete_without_thumbnail, failed, cancelled and duplicate
 * are all terminal states and therefore deliberately excluded.
 */
const INCOMPLETE_INGESTION_STATUSES =
  new Set([
    "pending",
    "analysing",
    "ready",
    "uploading",
    "video_uploaded",
    "cataloguing",
    "catalogued",
    "thumbnail_uploading"
  ]);


/* =====================================================================
   02. DOM REFERENCES
===================================================================== */

const adminStatus =
  document.getElementById(
    "admin-status"
  );


const adminRefresh =
  document.getElementById(
    "admin-refresh"
  );


const adminLastRefreshed =
  document.getElementById(
    "admin-last-refreshed"
  );


const adminIngestionsBody =
  document.getElementById(
    "admin-ingestions-body"
  );


/*
 * Library counters.
 */
const statVideos =
  document.getElementById(
    "admin-stat-videos"
  );


const statActors =
  document.getElementById(
    "admin-stat-actors"
  );


const statViews =
  document.getElementById(
    "admin-stat-views"
  );


const statIngestions =
  document.getElementById(
    "admin-stat-ingestions"
  );


/*
 * Ingestion health counters.
 */
const healthComplete =
  document.getElementById(
    "admin-health-complete"
  );


const healthNoThumbnail =
  document.getElementById(
    "admin-health-no-thumbnail"
  );


const healthFailed =
  document.getElementById(
    "admin-health-failed"
  );


const healthIncomplete =
  document.getElementById(
    "admin-health-incomplete"
  );


const healthCancelled =
  document.getElementById(
    "admin-health-cancelled"
  );


const healthDuplicates =
  document.getElementById(
    "admin-health-duplicates"
  );


/* =====================================================================
   03. INITIALISATION
===================================================================== */

document.addEventListener(
  "DOMContentLoaded",
  initialiseAdmin
);


/**
 * Starts the Admin dashboard.
 */
async function initialiseAdmin() {

  /*
   * Render Lucide icons if the library loaded successfully.
   */
  window.lucide?.createIcons();


  adminRefresh?.addEventListener(
    "click",
    refreshAdmin
  );


  await refreshAdmin();
}


/* =====================================================================
   04. AUTHENTICATION
===================================================================== */

/**
 * Confirms that the visitor has a valid Supabase session.
 *
 * This protects the UI from anonymous visitors.
 *
 * IMPORTANT:
 *
 * This is NOT sufficient protection for future destructive admin
 * operations. Edge Functions performing privileged actions must
 * independently validate the user.
 */
async function requireAuthenticatedUser() {

  const {
    data,
    error
  } =
    await supabase.auth.getUser();


  if (
    error ||
    !data?.user
  ) {

    window.location.href =
      "login.html";

    return null;
  }


  return data.user;
}


/* =====================================================================
   05. REFRESH
===================================================================== */

/**
 * Reloads every dashboard dataset.
 */
async function refreshAdmin() {

  setRefreshState(
    true
  );


  setStatus(
    "Loading library health…",
    "loading"
  );


  try {

    const user =
      await requireAuthenticatedUser();


    if (
      !user
    ) {

      return;
    }


    /*
     * These datasets are independent, so request them concurrently.
     */
    const [
      videos,
      actors,
      views,
      ingestions
    ] =
      await Promise.all([
        loadVideoCount(),
        loadActorCount(),
        loadViewCount(),
        loadIngestions()
      ]);


    renderLibrarySummary({
      videos,
      actors,
      views,
      ingestions
    });


    renderIngestionHealth(
      ingestions.rows
    );


    renderRecentIngestions(
      ingestions.rows
    );


    const now =
      new Date();


    if (
      adminLastRefreshed
    ) {

      adminLastRefreshed.textContent =
        `Updated ${now.toLocaleTimeString(
          [],
          {
            hour:
              "2-digit",

            minute:
              "2-digit",

            second:
              "2-digit"
          }
        )}`;
    }


    setStatus(
      "Library health loaded.",
      "success"
    );


  } catch (error) {

    console.error(
      "ADMIN DASHBOARD ERROR:",
      error
    );


    setStatus(
      `Could not load library health: ${
        error?.message ||
        "Unknown error"
      }`,
      "error"
    );


    renderTableError(
      error
    );

  } finally {

    setRefreshState(
      false
    );
  }
}


/* =====================================================================
   06. VIDEO COUNT
===================================================================== */

/**
 * Returns the total number of catalogue videos.
 *
 * head:true prevents Supabase from returning all video rows simply to
 * calculate the count.
 */
async function loadVideoCount() {

  const {
    count,
    error
  } =
    await supabase
      .from(
        "zulu_videos"
      )
      .select(
        "*",
        {
          count:
            "exact",

          head:
            true
        }
      );


  if (
    error
  ) {

    throw new Error(
      `Could not count videos: ${error.message}`
    );
  }


  return count || 0;
}


/* =====================================================================
   07. ACTOR COUNT
===================================================================== */

/**
 * Returns the number of distinct actors.
 *
 * zulu_distinct_actors already represents the distinct actor catalogue,
 * so an exact row count gives us the required value.
 */
async function loadActorCount() {

  const {
    count,
    error
  } =
    await supabase
      .from(
        "zulu_distinct_actors"
      )
      .select(
        "*",
        {
          count:
            "exact",

          head:
            true
        }
      );


  if (
    error
  ) {

    throw new Error(
      `Could not count actors: ${error.message}`
    );
  }


  return count || 0;
}


/* =====================================================================
   08. VIEW COUNT
===================================================================== */

/**
 * Calculates total recorded views.
 *
 * zulu_video_views currently stores individual view records, therefore
 * the number of rows represents total recorded views.
 *
 * If this table later changes to an aggregated counter model, this
 * function is the only part of the dashboard that needs to change.
 */
async function loadViewCount() {

  const {
    count,
    error
  } =
    await supabase
      .from(
        "zulu_video_views"
      )
      .select(
        "*",
        {
          count:
            "exact",

          head:
            true
        }
      );


  if (
    error
  ) {

    throw new Error(
      `Could not count views: ${error.message}`
    );
  }


  return count || 0;
}


/* =====================================================================
   09. INGESTION DATA
===================================================================== */

/**
 * Loads ingestion records.
 *
 * Version 1 loads all ingestion rows because the health counters need
 * the complete status distribution.
 *
 * The ingestion table will initially be small enough that this is
 * perfectly reasonable.
 *
 * If the journal grows substantially, the summary calculations can
 * later move into a Supabase SQL view/RPC.
 */
async function loadIngestions() {

  const {
    data,
    error,
    count
  } =
    await supabase
      .from(
        "zulu_ingestions"
      )
      .select(
        `
          id,
          original_filename,
          canonical_filename,
          film,
          filesize_bytes,
          fingerprint,
          status,
          failed_stage,
          error_message,
          backblaze_file_id,
          public_url,
          video_uploaded_at,
          video_uid,
          catalogued_at,
          thumbnail_status,
          thumbnail_uploaded_at,
          created_at,
          updated_at,
          completed_at
        `,
        {
          count:
            "exact"
        }
      )
      .order(
        "created_at",
        {
          ascending:
            false
        }
      );


  if (
    error
  ) {

    throw new Error(
      `Could not load ingestions: ${error.message}`
    );
  }


  return {
    count:
      count || 0,

    rows:
      data || []
  };
}


/* =====================================================================
   10. LIBRARY SUMMARY
===================================================================== */

/**
 * Renders the four primary library counters.
 */
function renderLibrarySummary({
  videos,
  actors,
  views,
  ingestions
}) {

  setNumber(
    statVideos,
    videos
  );


  setNumber(
    statActors,
    actors
  );


  setNumber(
    statViews,
    views
  );


  setNumber(
    statIngestions,
    ingestions.count
  );
}


/* =====================================================================
   11. INGESTION HEALTH
===================================================================== */

/**
 * Calculates health statistics from the ingestion journal.
 */
function renderIngestionHealth(
  rows
) {

  let complete =
    0;


  let withoutThumbnail =
    0;


  let failed =
    0;


  let incomplete =
    0;


  let cancelled =
    0;


  let duplicates =
    0;


  for (
    const ingestion of rows
  ) {

    switch (
      ingestion.status
    ) {

      case "complete":

        complete +=
          1;

        break;


      case "complete_without_thumbnail":

        withoutThumbnail +=
          1;

        break;


      case "failed":

        failed +=
          1;

        break;


      case "cancelled":

        cancelled +=
          1;

        break;


      case "duplicate":

        duplicates +=
          1;

        break;


      default:

        if (
          INCOMPLETE_INGESTION_STATUSES.has(
            ingestion.status
          )
        ) {

          incomplete +=
            1;
        }
    }
  }


  setNumber(
    healthComplete,
    complete
  );


  setNumber(
    healthNoThumbnail,
    withoutThumbnail
  );


  setNumber(
    healthFailed,
    failed
  );


  setNumber(
    healthIncomplete,
    incomplete
  );


  setNumber(
    healthCancelled,
    cancelled
  );


  setNumber(
    healthDuplicates,
    duplicates
  );
}


/* =====================================================================
   12. RECENT INGESTIONS TABLE
===================================================================== */

/**
 * Renders the most recent ingestion records.
 */
function renderRecentIngestions(
  rows
) {

  if (
    !adminIngestionsBody
  ) {

    return;
  }


  adminIngestionsBody.innerHTML =
    "";


  const recentRows =
    rows.slice(
      0,
      RECENT_INGESTION_LIMIT
    );


  if (
    !recentRows.length
  ) {

    adminIngestionsBody.innerHTML =
      `
        <tr>
          <td
            colspan="7"
            class="admin-table-empty"
          >
            No ingestion records yet.
          </td>
        </tr>
      `;


    return;
  }


  for (
    const ingestion of recentRows
  ) {

    const row =
      createIngestionRow(
        ingestion
      );


    const detailRow =
      createIngestionDetailRow(
        ingestion
      );


    adminIngestionsBody.appendChild(
      row
    );


    adminIngestionsBody.appendChild(
      detailRow
    );
  }
}


/**
 * Creates the visible summary row for an ingestion.
 */
function createIngestionRow(
  ingestion
) {

  const row =
    document.createElement(
      "tr"
    );


  row.className =
    "admin-ingestion-row";


  const displayFilm =
    ingestion.film ||
    stripMp4Extension(
      ingestion.original_filename
    ) ||
    "Untitled";


  const videoState =
    getVideoState(
      ingestion
    );


  const catalogueState =
    getCatalogueState(
      ingestion
    );


  const thumbnailState =
    getThumbnailState(
      ingestion
    );


  row.innerHTML =
    `
      <td class="admin-film-cell">

        <strong>
          ${escapeHtml(displayFilm)}
        </strong>

        <span>
          ${escapeHtml(
            ingestion.original_filename ||
            ""
          )}
        </span>

      </td>


      <td>
        ${renderStatusBadge(
          ingestion.status
        )}
      </td>


      <td>
        ${renderState(
          videoState
        )}
      </td>


      <td>
        ${renderState(
          catalogueState
        )}
      </td>


      <td>
        ${renderState(
          thumbnailState
        )}
      </td>


      <td class="admin-date-cell">
        ${escapeHtml(
          formatDateTime(
            ingestion.created_at
          )
        )}
      </td>


      <td class="admin-expand-cell">

        <button
          type="button"
          class="admin-expand-button"
          aria-label="Show ingestion details"
          aria-expanded="false"
        >
          <i data-lucide="chevron-down"></i>
        </button>

      </td>
    `;


  const expandButton =
    row.querySelector(
      ".admin-expand-button"
    );


  expandButton?.addEventListener(
    "click",
    () =>
      toggleIngestionDetails(
        row,
        expandButton
      )
  );


  return row;
}


/**
 * Creates the hidden diagnostics row belonging to a summary row.
 */
function createIngestionDetailRow(
  ingestion
) {

  const row =
    document.createElement(
      "tr"
    );


  row.className =
    "admin-ingestion-detail-row";


  row.hidden =
    true;


  const size =
    formatBytes(
      ingestion.filesize_bytes
    );


  row.innerHTML =
    `
      <td colspan="7">

        <div class="admin-ingestion-details">

          ${detailItem(
            "Ingestion ID",
            ingestion.id
          )}

          ${detailItem(
            "Video UID",
            ingestion.video_uid
          )}

          ${detailItem(
            "Original filename",
            ingestion.original_filename
          )}

          ${detailItem(
            "Canonical filename",
            ingestion.canonical_filename
          )}

          ${detailItem(
            "Filesize",
            size
          )}

          ${detailItem(
            "Fingerprint",
            ingestion.fingerprint
          )}

          ${detailItem(
            "Backblaze file ID",
            ingestion.backblaze_file_id
          )}

          ${detailItem(
            "Public URL",
            ingestion.public_url
          )}

          ${detailItem(
            "Failed stage",
            ingestion.failed_stage
          )}

          ${detailItem(
            "Error",
            ingestion.error_message
          )}

          ${detailItem(
            "Created",
            formatDateTime(
              ingestion.created_at
            )
          )}

          ${detailItem(
            "Video uploaded",
            formatDateTime(
              ingestion.video_uploaded_at
            )
          )}

          ${detailItem(
            "Catalogued",
            formatDateTime(
              ingestion.catalogued_at
            )
          )}

          ${detailItem(
            "Thumbnail uploaded",
            formatDateTime(
              ingestion.thumbnail_uploaded_at
            )
          )}

          ${detailItem(
            "Completed",
            formatDateTime(
              ingestion.completed_at
            )
          )}

        </div>

      </td>
    `;


  return row;
}


/* =====================================================================
   13. EXPAND / COLLAPSE
===================================================================== */

/**
 * Shows or hides the diagnostics row immediately following an
 * ingestion summary row.
 */
function toggleIngestionDetails(
  row,
  button
) {

  const detailRow =
    row.nextElementSibling;


  if (
    !detailRow?.classList.contains(
      "admin-ingestion-detail-row"
    )
  ) {

    return;
  }


  const opening =
    detailRow.hidden;


  detailRow.hidden =
    !opening;


  button.setAttribute(
    "aria-expanded",
    String(
      opening
    )
  );


  button.classList.toggle(
    "open",
    opening
  );


  /*
   * Re-render Lucide so dynamically-created chevrons exist.
   */
  window.lucide?.createIcons();
}


/* =====================================================================
   14. INGESTION COMPONENT STATES
===================================================================== */

/**
 * Determines whether the actual MP4 reached Backblaze.
 */
function getVideoState(
  ingestion
) {

  if (
    ingestion.video_uploaded_at ||
    ingestion.backblaze_file_id ||
    ingestion.public_url
  ) {

    return {
      state:
        "good",

      label:
        "Uploaded"
    };
  }


  if (
    ingestion.status ===
      "failed" &&
    ingestion.failed_stage ===
      "uploading"
  ) {

    return {
      state:
        "bad",

      label:
        "Failed"
    };
  }


  return {
    state:
      "muted",

    label:
      "—"
  };
}


/**
 * Determines whether the catalogue entry exists.
 */
function getCatalogueState(
  ingestion
) {

  if (
    ingestion.video_uid ||
    ingestion.catalogued_at
  ) {

    return {
      state:
        "good",

      label:
        ingestion.video_uid
          ? `UID ${ingestion.video_uid}`
          : "Created"
    };
  }


  if (
    ingestion.status ===
      "failed" &&
    ingestion.failed_stage ===
      "cataloguing"
  ) {

    return {
      state:
        "bad",

      label:
        "Failed"
    };
  }


  return {
    state:
      "muted",

    label:
      "—"
  };
}


/**
 * Converts thumbnail_status into a concise dashboard state.
 */
function getThumbnailState(
  ingestion
) {

  switch (
    ingestion.thumbnail_status
  ) {

    case "uploaded":

      return {
        state:
          "good",

        label:
          "Published"
      };


    case "failed":

      return {
        state:
          "warning",

        label:
          "Failed"
      };


    case "skipped":

      return {
        state:
          "warning",

        label:
          "Skipped"
      };


    case "uploading":

      return {
        state:
          "active",

        label:
          "Uploading"
      };


    case "ready":

      return {
        state:
          "active",

        label:
          "Ready"
      };


    case "generating":

      return {
        state:
          "active",

        label:
          "Generating"
      };


    default:

      return {
        state:
          "muted",

        label:
          "—"
      };
  }
}


/* =====================================================================
   15. STATUS BADGES
===================================================================== */

/**
 * Produces a readable ingestion status badge.
 */
function renderStatusBadge(
  status
) {

  const statusClass =
    getStatusClass(
      status
    );


  return `
    <span
      class="admin-status-badge ${statusClass}"
    >
      ${escapeHtml(
        formatStatus(
          status
        )
      )}
    </span>
  `;
}


/**
 * Maps ingestion status to visual severity.
 */
function getStatusClass(
  status
) {

  switch (
    status
  ) {

    case "complete":

      return "admin-status-good";


    case "complete_without_thumbnail":

      return "admin-status-warning";


    case "failed":

      return "admin-status-bad";


    case "cancelled":
    case "duplicate":

      return "admin-status-muted";


    default:

      return "admin-status-active";
  }
}


/**
 * Makes database status names human-readable.
 */
function formatStatus(
  status
) {

  if (
    !status
  ) {

    return "Unknown";
  }


  return status
    .replaceAll(
      "_",
      " "
    )
    .replace(
      /\b\w/g,
      character =>
        character.toUpperCase()
    );
}


/* =====================================================================
   16. COMPONENT STATE RENDERING
===================================================================== */

/**
 * Renders Video / Catalogue / Thumbnail state.
 */
function renderState({
  state,
  label
}) {

  const symbol =
    state === "good"
      ? "✓"
      : state === "bad"
        ? "✕"
        : state === "warning"
          ? "⚠"
          : state === "active"
            ? "●"
            : "—";


  return `
    <span
      class="admin-component-state admin-component-${state}"
    >
      <span class="admin-component-symbol">
        ${symbol}
      </span>

      ${escapeHtml(
        label
      )}
    </span>
  `;
}


/* =====================================================================
   17. DETAIL RENDERING
===================================================================== */

/**
 * Renders one diagnostic key/value pair.
 */
function detailItem(
  label,
  value
) {

  const displayValue =
    value === null ||
    value === undefined ||
    value === ""
      ? "—"
      : String(
          value
        );


  return `
    <div class="admin-detail-item">

      <div class="admin-detail-label">
        ${escapeHtml(label)}
      </div>

      <div class="admin-detail-value">
        ${escapeHtml(displayValue)}
      </div>

    </div>
  `;
}


/* =====================================================================
   18. GENERAL UI HELPERS
===================================================================== */

/**
 * Displays the page-level loading/success/error message.
 */
function setStatus(
  message,
  type
) {

  if (
    !adminStatus
  ) {

    return;
  }


  adminStatus.textContent =
    message;


  adminStatus.className =
    `admin-status admin-status-${type}`;
}


/**
 * Locks/unlocks the refresh button.
 */
function setRefreshState(
  loading
) {

  if (
    !adminRefresh
  ) {

    return;
  }


  adminRefresh.disabled =
    loading;


  adminRefresh.classList.toggle(
    "loading",
    loading
  );
}


/**
 * Writes a formatted integer into a counter.
 */
function setNumber(
  element,
  number
) {

  if (
    !element
  ) {

    return;
  }


  element.textContent =
    Number(
      number || 0
    )
      .toLocaleString();
}


/**
 * Renders an error inside the recent-ingestions table.
 */
function renderTableError(
  error
) {

  if (
    !adminIngestionsBody
  ) {

    return;
  }


  adminIngestionsBody.innerHTML =
    `
      <tr>

        <td
          colspan="7"
          class="admin-table-error"
        >
          ${escapeHtml(
            error?.message ||
            "Could not load ingestion history."
          )}
        </td>

      </tr>
    `;
}


/* =====================================================================
   19. FORMATTERS
===================================================================== */

/**
 * Formats a byte count without importing the main site's utility
 * module, keeping the admin dashboard self-contained.
 */
function formatBytes(
  bytes
) {

  const value =
    Number(
      bytes
    );


  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {

    return "—";
  }


  const units =
    [
      "B",
      "KB",
      "MB",
      "GB",
      "TB"
    ];


  let size =
    value;


  let unitIndex =
    0;


  while (
    size >= 1024 &&
    unitIndex <
      units.length - 1
  ) {

    size /=
      1024;

    unitIndex +=
      1;
  }


  const decimals =
    unitIndex === 0
      ? 0
      : unitIndex === 1
        ? 1
        : 2;


  return `${size.toFixed(
    decimals
  )} ${units[unitIndex]}`;
}


/**
 * Formats a Supabase timestamp in the browser's local timezone.
 */
function formatDateTime(
  value
) {

  if (
    !value
  ) {

    return "—";
  }


  const date =
    new Date(
      value
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return String(
      value
    );
  }


  return date.toLocaleString(
    [],
    {
      year:
        "numeric",

      month:
        "short",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit"
    }
  );
}


/**
 * Removes .mp4 when using a filename as a fallback title.
 */
function stripMp4Extension(
  filename
) {

  return String(
    filename ||
    ""
  )
    .replace(
      /\.mp4$/i,
      ""
    );
}


/**
 * Escapes text before inserting it into innerHTML.
 *
 * This matters because film names, filenames and error messages all
 * originate from external/user-controlled data.
 */
function escapeHtml(
  value
) {

  return String(
    value ??
    ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}
