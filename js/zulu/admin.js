import {
  supabase
} from "../supabaseClient.js";

import {
  initialiseVideoHealth,
  loadVideoHealth,
  renderVideoHealth,
  setVideoHealthLoadingState,
  renderVideoHealthError
} from "../admin/admin-video-health.js";

import {
  initialiseThumbnailHealth,
  loadThumbnailHealth,
  renderThumbnailHealth,
  setThumbnailLoadingState,
  renderThumbnailHealthError
} from "../admin/admin-thumbnail-health.js";

import {
  initialiseIntegrity,
  renderCatalogueIntegrity
} from "../admin/admin-integrity.js";


/* =====================================================================
   ADMIN.JS
   =====================================================================

   PURPOSE
   -------

   Powers the PornFlix Library Health / Admin dashboard.

   Protected catalogue and ingestion data is retrieved through:

       zulu-admin-dashboard

   Actual Backblaze video storage health is retrieved separately through:

       zulu-video-health

   Actual Backblaze thumbnail storage health is retrieved separately
   through:

       zulu-thumbnail-health

   The separation is deliberate.

   If Backblaze is temporarily unavailable, the main Admin dashboard can
   continue to load normally and the individual storage-health sections
   can report their own independent error states.

   The dashboard provides:

       • catalogue video count
       • actor count
       • total video views
       • ingestion count
       • ingestion health summary
       • Catalogue Integrity diagnostics
       • Video Storage Health reconciliation
       • Thumbnail Health reconciliation
       • missing thumbnail repair
       • recent ingestion history
       • expandable ingestion diagnostics

   Catalogue Integrity is handled by:

       admin-integrity.js

   Video Storage Health is handled by:

       admin-video-health.js

   Thumbnail Health and missing-thumbnail repair are handled by:

       admin-thumbnail-health.js

   Backblaze application credentials are NEVER exposed to this browser
   code.

   All privileged B2 authorisation remains inside protected Supabase
   Edge Functions.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
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


/* ---------------------------------------------------------------------
   LIBRARY SUMMARY
--------------------------------------------------------------------- */

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


/* ---------------------------------------------------------------------
   INGESTION HEALTH
--------------------------------------------------------------------- */

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
   02. INITIALISATION
===================================================================== */

document.addEventListener(
  "DOMContentLoaded",
  initialiseAdmin
);


/**
 * Starts the Admin dashboard and attaches all persistent event handlers.
 */
async function initialiseAdmin() {

  window.lucide?.createIcons();


  /* -------------------------------------------------------------------
     MAIN REFRESH
  ------------------------------------------------------------------- */

  adminRefresh?.addEventListener(
    "click",
    refreshAdmin
  );


  /* -------------------------------------------------------------------
     CATALOGUE INTEGRITY
  ------------------------------------------------------------------- */

  initialiseIntegrity({
    refreshAdmin
  });


  /* -------------------------------------------------------------------
     VIDEO STORAGE HEALTH
  ------------------------------------------------------------------- */

  initialiseVideoHealth();


  /* -------------------------------------------------------------------
     THUMBNAIL HEALTH
  ------------------------------------------------------------------- */

  initialiseThumbnailHealth();


  await refreshAdmin();
}


/* =====================================================================
   03. AUTHENTICATION
===================================================================== */

/**
 * Confirms that the visitor has a valid Supabase session.
 *
 * This protects the UI from anonymous visitors.
 *
 * IMPORTANT:
 *
 * This is not the ultimate security boundary. Each protected Edge
 * Function independently verifies the authenticated user's JWT and can
 * independently enforce ZULU_ADMIN_EMAIL.
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
   04. DASHBOARD REFRESH
===================================================================== */

/**
 * Reloads all three independent Admin data sources:
 *
 *     1. zulu-admin-dashboard
 *     2. zulu-video-health
 *     3. zulu-thumbnail-health
 *
 * Promise.allSettled() is deliberate. A failure of either Backblaze
 * reconciliation does not prevent Supabase health information from
 * loading.
 */
async function refreshAdmin() {

  setRefreshState(
    true
  );


  setStatus(
    "Loading library health…",
    "loading"
  );


  setVideoHealthLoadingState();


  setThumbnailLoadingState();


  try {

    const user =
      await requireAuthenticatedUser();


    if (
      !user
    ) {

      return;
    }


    const [
      dashboardResult,
      videoHealthResult,
      thumbnailResult
    ] =
      await Promise.allSettled(
        [
          loadAdminDashboard(),
          loadVideoHealth(),
          loadThumbnailHealth()
        ]
      );


    /* ===============================================================
       MAIN ADMIN DASHBOARD
    =============================================================== */

    if (
      dashboardResult.status ===
        "fulfilled"
    ) {

      const dashboard =
        dashboardResult.value;


      renderLibrarySummary(
        dashboard.library
      );


      renderIngestionHealth(
        dashboard.health
      );


      renderCatalogueIntegrity(
        dashboard.integrity
      );


      renderRecentIngestions(
        dashboard.recent_ingestions ||
        []
      );


      const refreshedAt =
        dashboard.generated_at
          ? new Date(
              dashboard.generated_at
            )
          : new Date();


      if (
        adminLastRefreshed
      ) {

        adminLastRefreshed.textContent =
          `Updated ${refreshedAt.toLocaleTimeString(
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


    } else {

      console.error(
        "ADMIN DASHBOARD ERROR:",
        dashboardResult.reason
      );


      setStatus(
        `Could not load library health: ${
          dashboardResult.reason?.message ||
          "Unknown error"
        }`,
        "error"
      );


      renderTableError(
        dashboardResult.reason
      );
    }


    /* ===============================================================
       VIDEO STORAGE HEALTH
    =============================================================== */

    if (
      videoHealthResult.status ===
        "fulfilled"
    ) {

      renderVideoHealth(
        videoHealthResult.value
      );


    } else {

      console.error(
        "VIDEO STORAGE HEALTH ERROR:",
        videoHealthResult.reason
      );


      renderVideoHealthError(
        videoHealthResult.reason
      );
    }


    /* ===============================================================
       THUMBNAIL HEALTH
    =============================================================== */

    if (
      thumbnailResult.status ===
        "fulfilled"
    ) {

      renderThumbnailHealth(
        thumbnailResult.value
      );


    } else {

      console.error(
        "THUMBNAIL HEALTH ERROR:",
        thumbnailResult.reason
      );


      renderThumbnailHealthError(
        thumbnailResult.reason
      );
    }


  } catch (
    error
  ) {

    console.error(
      "ADMIN REFRESH ERROR:",
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


    renderVideoHealthError(
      error
    );


    renderThumbnailHealthError(
      error
    );


  } finally {

    setRefreshState(
      false
    );
  }
}


/* =====================================================================
   05. ADMIN DASHBOARD REQUEST
===================================================================== */

/**
 * Retrieves the primary Admin dashboard snapshot from the protected
 * zulu-admin-dashboard Edge Function.
 */
async function loadAdminDashboard() {

  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "zulu-admin-dashboard",
      {
        body: {}
      }
    );


  if (
    error
  ) {

    throw new Error(
      `Could not load Admin dashboard: ${
        error.message ||
        "Edge Function request failed"
      }`
    );
  }


  if (
    !data
  ) {

    throw new Error(
      "The Admin dashboard returned no data."
    );
  }


  if (
    data.success !== true
  ) {

    throw new Error(
      data.error ||
      "The Admin dashboard request was unsuccessful."
    );
  }


  if (
    !data.library ||
    !data.health ||
    !data.integrity
  ) {

    throw new Error(
      "The Admin dashboard returned an invalid response."
    );
  }


  return data;
}


/* =====================================================================
   06. LIBRARY SUMMARY
===================================================================== */

/**
 * Renders the four primary library counters returned by
 * zulu-admin-dashboard.
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
    ingestions
  );
}


/* =====================================================================
   07. INGESTION HEALTH
===================================================================== */

/**
 * Renders ingestion-health totals calculated by the protected
 * zulu-admin-dashboard Edge Function.
 */
function renderIngestionHealth(
  health
) {

  setNumber(
    healthComplete,
    health.complete
  );


  setNumber(
    healthNoThumbnail,
    health.complete_without_thumbnail
  );


  setNumber(
    healthFailed,
    health.failed
  );


  setNumber(
    healthIncomplete,
    health.incomplete
  );


  setNumber(
    healthCancelled,
    health.cancelled
  );


  setNumber(
    healthDuplicates,
    health.duplicate
  );
}

/* =====================================================================
   08. RECENT INGESTIONS
===================================================================== */

/**
 * Renders the recent ingestion table.
 */
function renderRecentIngestions(
  ingestions
) {

  if (
    !adminIngestionsBody
  ) {

    return;
  }


  if (
    !Array.isArray(
      ingestions
    ) ||
    !ingestions.length
  ) {

    adminIngestionsBody.innerHTML = `
      <tr>

        <td
          colspan="7"
          class="admin-empty"
        >
          No ingestion records found.
        </td>

      </tr>
    `;


    return;
  }


  const html =
    ingestions
      .map(
        (
          ingestion,
          index
        ) => {

          const rowId =
            `admin-ingestion-detail-${index}`;


          return (
            createIngestionRow(
              ingestion,
              rowId
            ) +

            createIngestionDetailRow(
              ingestion,
              rowId
            )
          );
        }
      )
      .join(
        ""
      );


  adminIngestionsBody.innerHTML =
    html;


  adminIngestionsBody
    .querySelectorAll(
      ".admin-ingestion-toggle"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            toggleIngestionDetails(
              button
            )
        );
      }
    );


  window.lucide?.createIcons();
}


/**
 * Creates the visible summary row for one ingestion.
 */
function createIngestionRow(
  ingestion,
  rowId
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


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


  const createdAt =
    formatDateTime(
      ingestion.created_at
    );


  const filename =
    ingestion.canonical_filename ||
    ingestion.original_filename ||
    "—";


  const film =
    ingestion.film ||
    stripMp4Extension(
      filename
    ) ||
    "—";


  return `
    <tr>

      <td>

        <button
          type="button"
          class="admin-ingestion-toggle"
          data-target="${escapeHtml(
            rowId
          )}"
          aria-expanded="false"
          aria-label="Show ingestion details"
        >

          <i
            data-lucide="chevron-right"
            class="admin-ingestion-toggle-icon"
          ></i>

        </button>

      </td>


      <td>

        <strong>
          ${escapeHtml(
            film
          )}
        </strong>

        <div class="admin-ingestion-file">
          ${escapeHtml(
            filename
          )}
        </div>

      </td>


      <td>
        ${renderStatusBadge(
          status
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


      <td>
        ${escapeHtml(
          createdAt
        )}
      </td>

    </tr>
  `;
}


/**
 * Creates the expandable diagnostic row for one ingestion.
 */
function createIngestionDetailRow(
  ingestion,
  rowId
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  const failedStage =
    ingestion.failed_stage ||
    "—";


  const errorMessage =
    ingestion.error_message ||
    "—";


  const publicUrl =
    ingestion.public_url ||
    "—";


  const backblazeFileId =
    ingestion.backblaze_file_id ||
    "—";


  const videoUid =
    ingestion.video_uid ??
    "—";


  const thumbnailStatus =
    ingestion.thumbnail_status ||
    "—";


  const filesize =
    formatBytes(
      ingestion.filesize_bytes
    );


  const createdAt =
    formatDateTime(
      ingestion.created_at
    );


  const updatedAt =
    formatDateTime(
      ingestion.updated_at
    );


  const completedAt =
    formatDateTime(
      ingestion.completed_at
    );


  const videoUploadedAt =
    formatDateTime(
      ingestion.video_uploaded_at
    );


  const cataloguedAt =
    formatDateTime(
      ingestion.catalogued_at
    );


  const thumbnailUploadedAt =
    formatDateTime(
      ingestion.thumbnail_uploaded_at
    );


  const fingerprint =
    ingestion.fingerprint ||
    "—";


  return `
    <tr
      id="${escapeHtml(
        rowId
      )}"
      class="admin-ingestion-detail-row"
      hidden
    >

      <td colspan="7">

        <div class="admin-ingestion-detail">

          <div class="admin-ingestion-detail-grid">

            ${detailItem(
              "Status",
              humaniseStatus(
                status
              )
            )}

            ${detailItem(
              "Video UID",
              videoUid
            )}

            ${detailItem(
              "Filesize",
              filesize
            )}

            ${detailItem(
              "Thumbnail status",
              humaniseStatus(
                thumbnailStatus
              )
            )}

            ${detailItem(
              "Failed stage",
              humaniseStatus(
                failedStage
              )
            )}

            ${detailItem(
              "Created",
              createdAt
            )}

            ${detailItem(
              "Updated",
              updatedAt
            )}

            ${detailItem(
              "Video uploaded",
              videoUploadedAt
            )}

            ${detailItem(
              "Catalogued",
              cataloguedAt
            )}

            ${detailItem(
              "Thumbnail uploaded",
              thumbnailUploadedAt
            )}

            ${detailItem(
              "Completed",
              completedAt
            )}

          </div>


          <div class="admin-ingestion-detail-block">

            <strong>
              Fingerprint
            </strong>

            <code>
              ${escapeHtml(
                fingerprint
              )}
            </code>

          </div>


          <div class="admin-ingestion-detail-block">

            <strong>
              Backblaze file ID
            </strong>

            <code>
              ${escapeHtml(
                backblazeFileId
              )}
            </code>

          </div>


          <div class="admin-ingestion-detail-block">

            <strong>
              Public URL
            </strong>

            <code>
              ${escapeHtml(
                publicUrl
              )}
            </code>

          </div>


          ${
            errorMessage !==
              "—"
              ? `
                <div
                  class="
                    admin-ingestion-detail-block
                    admin-ingestion-error
                  "
                >

                  <strong>
                    Error
                  </strong>

                  <div>
                    ${escapeHtml(
                      errorMessage
                    )}
                  </div>

                </div>
              `
              : ""
          }

        </div>

      </td>

    </tr>
  `;
}


/* =====================================================================
   09. INGESTION DETAILS TOGGLE
===================================================================== */

function toggleIngestionDetails(
  button
) {

  const targetId =
    button.dataset
      .target;


  if (
    !targetId
  ) {

    return;
  }


  const row =
    document.getElementById(
      targetId
    );


  if (
    !row
  ) {

    return;
  }


  const isOpen =
    !row.hidden;


  row.hidden =
    isOpen;


  button.setAttribute(
    "aria-expanded",
    String(
      !isOpen
    )
  );


  const icon =
    button.querySelector(
      ".admin-ingestion-toggle-icon"
    );


  if (
    icon
  ) {

    icon.setAttribute(
      "data-lucide",
      isOpen
        ? "chevron-right"
        : "chevron-down"
    );
  }


  window.lucide?.createIcons();
}


/* =====================================================================
   10. INGESTION COMPONENT STATES
===================================================================== */

/**
 * Returns the video-storage state for an ingestion.
 */
function getVideoState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  if (
    ingestion.video_uploaded_at ||
    ingestion.backblaze_file_id ||
    ingestion.public_url
  ) {

    return {
      label:
        "Uploaded",

      state:
        "success"
    };
  }


  if (
    status ===
      "failed" &&
    [
      "uploading",
      "video_upload"
    ].includes(
      normaliseStatus(
        ingestion.failed_stage
      )
    )
  ) {

    return {
      label:
        "Failed",

      state:
        "error"
    };
  }


  if (
    [
      "cancelled",
      "duplicate"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Not uploaded",

      state:
        "muted"
    };
  }


  if (
    [
      "pending",
      "analysing",
      "ready"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Waiting",

      state:
        "muted"
    };
  }


  if (
    status ===
      "uploading"
  ) {

    return {
      label:
        "Uploading",

      state:
        "warning"
    };
  }


  return {
    label:
      "Missing",

    state:
      "warning"
  };
}


/**
 * Returns the catalogue state for an ingestion.
 */
function getCatalogueState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  if (
    ingestion.catalogued_at ||
    ingestion.video_uid
  ) {

    return {
      label:
        "Catalogued",

      state:
        "success"
    };
  }


  if (
    status ===
      "failed" &&
    [
      "cataloguing",
      "catalogue",
      "finalize"
    ].includes(
      normaliseStatus(
        ingestion.failed_stage
      )
    )
  ) {

    return {
      label:
        "Failed",

      state:
        "error"
    };
  }


  if (
    [
      "pending",
      "analysing",
      "ready",
      "uploading",
      "video_uploaded"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Waiting",

      state:
        "muted"
    };
  }


  if (
    status ===
      "cataloguing"
  ) {

    return {
      label:
        "Cataloguing",

      state:
        "warning"
    };
  }


  if (
    [
      "cancelled",
      "duplicate"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Not catalogued",

      state:
        "muted"
    };
  }


  return {
    label:
      "Missing",

    state:
      "warning"
  };
}


/**
 * Returns the thumbnail state for an ingestion.
 */
function getThumbnailState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  const thumbnailStatus =
    normaliseStatus(
      ingestion.thumbnail_status
    );


  if (
    ingestion.thumbnail_uploaded_at ||
    thumbnailStatus ===
      "uploaded" ||
    thumbnailStatus ===
      "complete"
  ) {

    return {
      label:
        "Uploaded",

      state:
        "success"
    };
  }


  if (
    status ===
      "complete_without_thumbnail"
  ) {

    return {
      label:
        "Missing",

      state:
        "warning"
    };
  }


  if (
    status ===
      "failed" &&
    [
      "thumbnail_upload",
      "thumbnail_uploading",
      "thumbnail"
    ].includes(
      normaliseStatus(
        ingestion.failed_stage
      )
    )
  ) {

    return {
      label:
        "Failed",

      state:
        "error"
    };
  }


  if (
    [
      "pending",
      "analysing",
      "ready",
      "uploading",
      "video_uploaded",
      "cataloguing",
      "catalogued"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Waiting",

      state:
        "muted"
    };
  }


  if (
    status ===
      "thumbnail_uploading"
  ) {

    return {
      label:
        "Uploading",

      state:
        "warning"
    };
  }


  if (
    [
      "cancelled",
      "duplicate"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Not uploaded",

      state:
        "muted"
    };
  }


  if (
    status ===
      "complete"
  ) {

    return {
      label:
        "Uploaded",

      state:
        "success"
    };
  }


  return {
    label:
      "Missing",

    state:
      "warning"
  };
}

/* =====================================================================
   11. STATUS BADGES
===================================================================== */

/**
 * Creates the main ingestion status badge.
 */
function renderStatusBadge(
  status
) {

  const config =
    getStatusConfig(
      status
    );


  return `
    <span
      class="
        admin-status-badge
        ${escapeHtml(
          config.className
        )}
      "
    >
      ${escapeHtml(
        config.label
      )}
    </span>
  `;
}


/**
 * Maps ingestion statuses to display labels and CSS classes.
 */
function getStatusConfig(
  status
) {

  switch (
    status
  ) {

    case "complete":

      return {
        label:
          "Complete",

        className:
          "admin-status-complete"
      };


    case "complete_without_thumbnail":

      return {
        label:
          "No Thumbnail",

        className:
          "admin-status-warning"
      };


    case "failed":

      return {
        label:
          "Failed",

        className:
          "admin-status-failed"
      };


    case "cancelled":

      return {
        label:
          "Cancelled",

        className:
          "admin-status-cancelled"
      };


    case "duplicate":

      return {
        label:
          "Duplicate",

        className:
          "admin-status-duplicate"
      };


    case "pending":

      return {
        label:
          "Pending",

        className:
          "admin-status-pending"
      };


    case "analysing":

      return {
        label:
          "Analysing",

        className:
          "admin-status-active"
      };


    case "ready":

      return {
        label:
          "Ready",

        className:
          "admin-status-active"
      };


    case "uploading":

      return {
        label:
          "Uploading",

        className:
          "admin-status-active"
      };


    case "video_uploaded":

      return {
        label:
          "Video Uploaded",

        className:
          "admin-status-active"
      };


    case "cataloguing":

      return {
        label:
          "Cataloguing",

        className:
          "admin-status-active"
      };


    case "catalogued":

      return {
        label:
          "Catalogued",

        className:
          "admin-status-active"
      };


    case "thumbnail_uploading":

      return {
        label:
          "Thumbnail Upload",

        className:
          "admin-status-active"
      };


    default:

      return {
        label:
          humaniseStatus(
            status ||
            "unknown"
          ),

        className:
          "admin-status-pending"
      };
  }
}


/* =====================================================================
   12. COMPONENT STATE RENDERING
===================================================================== */

/**
 * Renders the small Video / Catalogue / Thumbnail state labels.
 */
function renderState(
  state
) {

  return `
    <span
      class="
        admin-state
        admin-state-${escapeHtml(
          state.state
        )}
      "
    >
      ${escapeHtml(
        state.label
      )}
    </span>
  `;
}


/* =====================================================================
   13. DETAIL ITEMS
===================================================================== */

function detailItem(
  label,
  value
) {

  return `
    <div class="admin-detail-item">

      <span>
        ${escapeHtml(
          label
        )}
      </span>

      <strong>
        ${escapeHtml(
          value
        )}
      </strong>

    </div>
  `;
}


/* =====================================================================
   14. TABLE ERROR
===================================================================== */

function renderTableError(
  error
) {

  if (
    !adminIngestionsBody
  ) {

    return;
  }


  adminIngestionsBody.innerHTML = `
    <tr>

      <td
        colspan="7"
        class="
          admin-empty
          admin-empty-error
        "
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
   15. PAGE STATUS
===================================================================== */

function setStatus(
  message,
  state =
    "loading"
) {

  if (
    !adminStatus
  ) {

    return;
  }


  adminStatus.textContent =
    message;


  adminStatus.classList.remove(
    "admin-status-loading",
    "admin-status-success",
    "admin-status-error"
  );


  adminStatus.classList.add(
    `admin-status-${state}`
  );
}


/* =====================================================================
   16. REFRESH BUTTON STATE
===================================================================== */

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
    "is-loading",
    loading
  );


  const icon =
    adminRefresh.querySelector(
      "[data-lucide]"
    );


  if (
    icon
  ) {

    icon.setAttribute(
      "data-lucide",
      loading
        ? "loader-circle"
        : "refresh-cw"
    );
  }


  const label =
    adminRefresh.querySelector(
      "span"
    );


  if (
    label
  ) {

    label.textContent =
      loading
        ? "Refreshing…"
        : "Refresh";
  }


  window.lucide?.createIcons();
}


/* =====================================================================
   17. BASIC DOM HELPERS
===================================================================== */

function setText(
  element,
  value
) {

  if (
    !element
  ) {

    return;
  }


  element.textContent =
    value === null ||
    value === undefined
      ? ""
      : String(
          value
        );
}


function setNumber(
  element,
  value
) {

  if (
    !element
  ) {

    return;
  }


  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    element.textContent =
      "—";


    return;
  }


  element.textContent =
    number.toLocaleString();
}


/* =====================================================================
   18. STRING NORMALISATION
===================================================================== */

function normaliseStatus(
  value
) {

  return String(
    value ||
    ""
  )
    .trim()
    .toLowerCase();
}


/**
 * Converts:
 *
 *     complete_without_thumbnail
 *
 * into:
 *
 *     Complete Without Thumbnail
 */
function humaniseStatus(
  value
) {

  const text =
    String(
      value ||
      ""
    )
      .trim();


  if (
    !text
  ) {

    return "—";
  }


  return text
    .replace(
      /[_-]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /\b\w/g,
      character =>
        character.toUpperCase()
    );
}


/**
 * Removes the final .mp4 extension from a filename.
 */
function stripMp4Extension(
  value
) {

  return String(
    value ||
    ""
  ).replace(
    /\.mp4$/i,
    ""
  );
}


/* =====================================================================
   19. DATE / TIME FORMATTING
===================================================================== */

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

    return "—";
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
        "2-digit",

      second:
        "2-digit"
    }
  );
}


/* =====================================================================
   20. FILESIZE FORMATTING
===================================================================== */

function formatBytes(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return "—";
  }


  const bytes =
    Number(
      value
    );


  if (
    !Number.isFinite(
      bytes
    ) ||
    bytes < 0
  ) {

    return "—";
  }


  if (
    bytes === 0
  ) {

    return "0 B";
  }


  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
    "PB"
  ];


  const unitIndex =
    Math.min(
      Math.floor(
        Math.log(
          bytes
        ) /
        Math.log(
          1024
        )
      ),
      units.length -
      1
    );


  const size =
    bytes /
    Math.pow(
      1024,
      unitIndex
    );


  const decimals =
    unitIndex === 0
      ? 0
      : size >= 100
        ? 0
        : size >= 10
          ? 1
          : 2;


  return `${size.toFixed(
    decimals
  )} ${units[
    unitIndex
  ]}`;
}


/* =====================================================================
   21. GENERIC VALUE HELPERS
===================================================================== */

/**
 * Returns the first non-null, non-undefined and non-empty value.
 */
function firstValue(
  ...values
) {

  for (
    const value of values
  ) {

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {

      return value;
    }
  }


  return null;
}


/**
 * Safely converts an unknown value to an array.
 */
function asArray(
  value
) {

  return Array.isArray(
    value
  )
    ? value
    : [];
}


/**
 * Returns a finite number or the supplied fallback.
 */
function safeNumber(
  value,
  fallback =
    0
) {

  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}

/* =====================================================================
   22. URL / FILENAME HELPERS
===================================================================== */

/**
 * Extracts the final filename component from a URL or path.
 *
 * This helper is intentionally diagnostic-only. The authoritative
 * catalogue ↔ Backblaze filename reconciliation remains server-side in
 * zulu-video-health.
 */
function filenameFromUrl(
  value
) {

  if (
    !value
  ) {

    return "";
  }


  try {

    const parsed =
      new URL(
        value
      );


    const pathname =
      parsed.pathname ||
      "";


    const parts =
      pathname.split(
        "/"
      );


    const filename =
      parts[
        parts.length - 1
      ] ||
      "";


    return safeDecodeURIComponent(
      filename
    );


  } catch {

    const withoutQuery =
      String(
        value
      ).split(
        "?"
      )[0];


    const parts =
      withoutQuery.split(
        "/"
      );


    return safeDecodeURIComponent(
      parts[
        parts.length - 1
      ] ||
      ""
    );
  }
}


/**
 * decodeURIComponent() wrapper that leaves malformed values unchanged.
 */
function safeDecodeURIComponent(
  value
) {

  try {

    return decodeURIComponent(
      value
    );


  } catch {

    return String(
      value ||
      ""
    );
  }
}


/* =====================================================================
   23. DIAGNOSTIC BOOLEAN HELPERS
===================================================================== */

/**
 * Converts common database / API boolean representations into a real
 * boolean.
 */
function toBoolean(
  value
) {

  if (
    value === true ||
    value === 1
  ) {

    return true;
  }


  if (
    typeof value ===
      "string"
  ) {

    const normalised =
      value
        .trim()
        .toLowerCase();


    return (
      normalised ===
        "true" ||
      normalised ===
        "1" ||
      normalised ===
        "yes" ||
      normalised ===
        "y"
    );
  }


  return false;
}


/* =====================================================================
   24. TEXT FALLBACK HELPERS
===================================================================== */

/**
 * Returns a display-safe string for optional diagnostic values.
 */
function displayValue(
  value,
  fallback =
    "—"
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return fallback;
  }


  return String(
    value
  );
}


/**
 * Truncates very long diagnostic values without changing the underlying
 * data.
 */
function truncateText(
  value,
  maximumLength =
    180
) {

  const text =
    String(
      value ||
      ""
    );


  if (
    text.length <=
      maximumLength
  ) {

    return text;
  }


  return `${text.slice(
    0,
    Math.max(
      0,
      maximumLength - 1
    )
  )}…`;
}


/* =====================================================================
   25. OPTIONAL COPY HELPER
===================================================================== */

/**
 * Copies diagnostic text when Clipboard API access is available.
 *
 * The current Admin dashboard does not require this helper for normal
 * operation, but keeping it here allows diagnostic rows to gain a Copy
 * action without duplicating clipboard logic later.
 */
async function copyText(
  value
) {

  const text =
    String(
      value ||
      ""
    );


  if (
    !text
  ) {

    return false;
  }


  if (
    !navigator.clipboard?.writeText
  ) {

    return false;
  }


  try {

    await navigator.clipboard.writeText(
      text
    );


    return true;


  } catch (
    error
  ) {

    console.warn(
      "Could not copy text:",
      error
    );


    return false;
  }
}


/* =====================================================================
   26. ERROR NORMALISATION
===================================================================== */

function getErrorMessage(
  error,
  fallback =
    "Unknown error"
) {

  if (
    !error
  ) {

    return fallback;
  }


  if (
    typeof error ===
      "string"
  ) {

    return error;
  }


  if (
    error.message
  ) {

    return String(
      error.message
    );
  }


  if (
    error.error
  ) {

    return String(
      error.error
    );
  }


  if (
    error.details
  ) {

    return String(
      error.details
    );
  }


  return fallback;
}


/* =====================================================================
   27. SAFE JSON DISPLAY
===================================================================== */

/**
 * Converts diagnostic objects to readable JSON without allowing an
 * unexpected circular reference to break Admin rendering.
 */
function safeJson(
  value
) {

  try {

    return JSON.stringify(
      value,
      null,
      2
    );


  } catch {

    return String(
      value ??
      ""
    );
  }
}


/* =====================================================================
   28. SORTING HELPERS
===================================================================== */

/**
 * Compares two values numerically when possible.
 */
function compareNumbers(
  a,
  b
) {

  return (
    safeNumber(
      a
    ) -
    safeNumber(
      b
    )
  );
}


/**
 * Compares two optional strings using the browser's locale-aware
 * comparison.
 */
function compareText(
  a,
  b
) {

  return String(
    a ||
    ""
  ).localeCompare(
    String(
      b ||
      ""
    ),
    undefined,
    {
      sensitivity:
        "base",

      numeric:
        true
    }
  );
}


/* =====================================================================
   29. GENERIC EMPTY RESULT
===================================================================== */

/**
 * Creates a standard empty diagnostic message.
 */
function renderEmptyResult(
  message =
    "✓ No issues found."
) {

  return `
    <div class="admin-diagnostic-empty">
      ${escapeHtml(
        message
      )}
    </div>
  `;
}


/* =====================================================================
   30. HTML ESCAPING
===================================================================== */

/**
 * Escapes arbitrary values before inserting them into innerHTML.
 *
 * All catalogue names, filenames, URLs, fingerprints, B2 IDs and error
 * messages that enter an HTML template should pass through this helper.
 *
 * This is especially important on Admin because filenames and catalogue
 * metadata ultimately originate outside the JavaScript source itself.
 */
function escapeHtml(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";
  }


  return String(
    value
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


/* =====================================================================
   END OF ADMIN.JS
===================================================================== */
