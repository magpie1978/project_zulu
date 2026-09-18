import {
  supabase
} from "../supabaseClient.js";


/* =====================================================================
   ADMIN.JS
   =====================================================================

   PURPOSE
   -------

   Powers the PornFlix Library Health / Admin dashboard.

   All protected dashboard data is retrieved through the
   zulu-admin-dashboard Edge Function.

   It provides:

       • catalogue video count
       • actor count
       • total video views
       • ingestion count
       • ingestion health summary
       • Catalogue Integrity diagnostics
       • metadata coverage diagnostics
       • recent ingestion history
       • expandable ingestion diagnostics

   Catalogue Integrity currently checks:

       • duplicate URLs
       • duplicate fingerprints
       • videos without actors
       • non-current media URLs
       • missing filesize
       • missing duration
       • missing resolution
       • missing fingerprint

   Backblaze reconciliation is NOT performed here.

   Future storage integrity checks must run server-side so Backblaze
   application credentials are never exposed to the browser.

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


/*
 * Catalogue Integrity counters.
 */
const integrityDuplicateUrls =
  document.getElementById(
    "admin-integrity-duplicate-urls"
  );


const integrityDuplicateFingerprints =
  document.getElementById(
    "admin-integrity-duplicate-fingerprints"
  );


const integrityNoActors =
  document.getElementById(
    "admin-integrity-no-actors"
  );


const integrityOldUrls =
  document.getElementById(
    "admin-integrity-old-urls"
  );


const integrityMissingFilesize =
  document.getElementById(
    "admin-integrity-missing-filesize"
  );


const integrityMissingDuration =
  document.getElementById(
    "admin-integrity-missing-duration"
  );


const integrityMissingResolution =
  document.getElementById(
    "admin-integrity-missing-resolution"
  );


const integrityMissingFingerprint =
  document.getElementById(
    "admin-integrity-missing-fingerprint"
  );


/*
 * Catalogue Integrity diagnostic panel.
 */
const integrityResults =
  document.getElementById(
    "admin-integrity-results"
  );


const integrityResultsTitle =
  document.getElementById(
    "admin-integrity-results-title"
  );


const integrityResultsBody =
  document.getElementById(
    "admin-integrity-results-body"
  );


const integrityResultsClose =
  document.getElementById(
    "admin-integrity-results-close"
  );


/*
 * Stores the latest integrity snapshot returned by the Edge Function.
 *
 * This allows cards to display detailed results without making another
 * database request.
 */
let currentIntegrityData =
  null;


/* =====================================================================
   02. INITIALISATION
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


  /*
   * Refresh the complete dashboard snapshot.
   */
  adminRefresh?.addEventListener(
    "click",
    refreshAdmin
  );


  /*
   * Catalogue Integrity cards are interactive.
   *
   * Clicking one displays the detailed records returned by the
   * zulu_catalogue_integrity() RPC.
   */
  document
    .querySelectorAll(
      ".admin-integrity-card"
    )
    .forEach(
      card => {

        card.addEventListener(
          "click",
          () =>
            openIntegrityResult(
              card.dataset.integrityKey
            )
        );
      }
    );


  /*
   * Close the Catalogue Integrity diagnostic panel.
   */
  integrityResultsClose?.addEventListener(
    "click",
    closeIntegrityResults
  );


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
 * This is NOT the security boundary for the dashboard.
 *
 * The zulu-admin-dashboard Edge Function independently verifies the JWT
 * and, when configured, checks ZULU_ADMIN_EMAIL before using its
 * service-role client.
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
   04. DASHBOARD DATA
===================================================================== */

/**
 * Reloads the complete Admin dashboard.
 *
 * All protected dashboard data is retrieved through the
 * zulu-admin-dashboard Edge Function.
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

    /*
     * First confirm that the browser still has an authenticated
     * Supabase user.
     *
     * This is primarily a UI convenience. The Edge Function performs
     * its own authentication and administrator authorization.
     */
    const user =
      await requireAuthenticatedUser();


    if (
      !user
    ) {

      return;
    }


    /*
     * Retrieve the complete dashboard snapshot.
     */
    const dashboard =
      await loadAdminDashboard();


    /*
     * Render the four top-level library counters.
     */
    renderLibrarySummary(
      dashboard.library
    );


    /*
     * Render ingestion-journal health.
     */
    renderIngestionHealth(
      dashboard.health
    );


    /*
     * Render database-level catalogue diagnostics.
     */
    renderCatalogueIntegrity(
      dashboard.integrity
    );


    /*
     * Render recent ingestion history.
     *
     * The Edge Function already limits this collection.
     */
    renderRecentIngestions(
      dashboard.recent_ingestions || []
    );


    /*
     * Prefer the server-generated timestamp so the displayed refresh
     * time corresponds to the actual dashboard snapshot.
     */
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


/**
 * Retrieves the complete Admin dashboard snapshot from the protected
 * zulu-admin-dashboard Edge Function.
 *
 * Supabase supplies the authenticated session to the function invocation.
 * The Edge Function independently verifies that JWT before accessing
 * protected data with its service-role client.
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


  /*
   * Catalogue Integrity is now a required part of the dashboard
   * response.
   */
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
   05. LIBRARY SUMMARY
===================================================================== */

/**
 * Renders the four primary library counters returned by the
 * zulu-admin-dashboard Edge Function.
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
   06. INGESTION HEALTH
===================================================================== */

/**
 * Renders ingestion-health totals calculated by the protected
 * zulu-admin-dashboard Edge Function.
 *
 * These figures cover the complete ingestion journal and are independent
 * of the recent-ingestions table limit.
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
   07. CATALOGUE INTEGRITY
===================================================================== */

/**
 * Stores and renders the latest Catalogue Integrity snapshot.
 *
 * Each result contains:
 *
 *     {
 *       count: number,
 *       rows: [...]
 *     }
 *
 * A zero count is displayed as healthy.
 *
 * Non-zero core-integrity problems are displayed as problems.
 * Non-zero metadata-coverage results are displayed as warnings.
 */
function renderCatalogueIntegrity(
  integrity
) {

  currentIntegrityData =
    integrity || {};


  const mappings =
    [
      {
        key:
          "duplicate_urls",

        element:
          integrityDuplicateUrls,

        severity:
          "problem"
      },

      {
        key:
          "duplicate_fingerprints",

        element:
          integrityDuplicateFingerprints,

        severity:
          "problem"
      },

      {
        key:
          "videos_without_actors",

        element:
          integrityNoActors,

        severity:
          "problem"
      },

      {
        key:
          "old_media_urls",

        element:
          integrityOldUrls,

        severity:
          "problem"
      },

      {
        key:
          "missing_filesize",

        element:
          integrityMissingFilesize,

        severity:
          "warning"
      },

      {
        key:
          "missing_duration",

        element:
          integrityMissingDuration,

        severity:
          "warning"
      },

      {
        key:
          "missing_resolution",

        element:
          integrityMissingResolution,

        severity:
          "warning"
      },

      {
        key:
          "missing_fingerprint",

        element:
          integrityMissingFingerprint,

        severity:
          "warning"
      }
    ];


  for (
    const mapping of mappings
  ) {

    const result =
      integrity?.[
        mapping.key
      ] || {
        count:
          0,

        rows:
          []
      };


    setNumber(
      mapping.element,
      result.count
    );


    const card =
      document.querySelector(
        `[data-integrity-key="${mapping.key}"]`
      );


    if (
      !card
    ) {

      continue;
    }


    /*
     * Remove any previous health state before applying the current
     * snapshot.
     */
    card.classList.remove(
      "is-healthy",
      "is-warning",
      "is-problem"
    );


    if (
      Number(
        result.count || 0
      ) === 0
    ) {

      card.classList.add(
        "is-healthy"
      );


    } else {

      card.classList.add(
        mapping.severity ===
          "warning"
          ? "is-warning"
          : "is-problem"
      );
    }
  }


  /*
   * Refreshing the dashboard invalidates any previously opened result
   * panel because the underlying diagnostic snapshot may have changed.
   */
  closeIntegrityResults();


  /*
   * Some integrity cards contain dynamically-processed Lucide icons.
   */
  window.lucide?.createIcons();
}


/* =====================================================================
   08. CATALOGUE INTEGRITY INTERACTION
===================================================================== */

/**
 * Opens the detailed result belonging to one Catalogue Integrity card.
 */
function openIntegrityResult(
  key
) {

  if (
    !key ||
    !currentIntegrityData
  ) {

    return;
  }


  const result =
    currentIntegrityData[
      key
    ];


  if (
    !result
  ) {

    return;
  }


  /*
   * Highlight only the currently selected card.
   */
  document
    .querySelectorAll(
      ".admin-integrity-card"
    )
    .forEach(
      card =>
        card.classList.toggle(
          "is-selected",
          card.dataset.integrityKey ===
            key
        )
    );


  if (
    integrityResultsTitle
  ) {

    integrityResultsTitle.textContent =
      getIntegrityTitle(
        key
      );
  }


  if (
    integrityResultsBody
  ) {

    integrityResultsBody.innerHTML =
      renderIntegrityRows(
        key,
        result.rows || []
      );
  }


  if (
    integrityResults
  ) {

    integrityResults.hidden =
      false;
  }


  window.lucide?.createIcons();
}


/**
 * Closes the Catalogue Integrity diagnostic panel and clears the selected
 * card state.
 */
function closeIntegrityResults() {

  if (
    integrityResults
  ) {

    integrityResults.hidden =
      true;
  }


  document
    .querySelectorAll(
      ".admin-integrity-card"
    )
    .forEach(
      card =>
        card.classList.remove(
          "is-selected"
        )
    );
}


/**
 * Returns the human-readable title for an integrity check.
 */
function getIntegrityTitle(
  key
) {

  const titles =
  {
    duplicate_urls:
      "Duplicate URLs",

    duplicate_fingerprints:
      "Duplicate Files",

    videos_without_actors:
      "Videos Without Actors",

    old_media_urls:
      "Non-current URLs",

    missing_filesize:
      "Missing Filesize",

    missing_duration:
      "Missing Duration",

    missing_resolution:
      "Missing Resolution",

    missing_fingerprint:
      "Missing Fingerprint"
  };


  return titles[
    key
  ] || "Catalogue Integrity";
}


/* =====================================================================
   09. CATALOGUE INTEGRITY RESULT RENDERING
===================================================================== */

/**
 * Converts an integrity result collection into diagnostic HTML.
 *
 * Duplicate fingerprints and duplicate URLs contain grouped catalogue
 * records, while the remaining checks contain individual video rows.
 */
function renderIntegrityRows(
  key,
  rows
) {

  if (
    !Array.isArray(
      rows
    ) ||
    !rows.length
  ) {

    return `
      <div class="admin-integrity-empty">
        ✓ No issues found.
      </div>
    `;
  }


  if (
    key ===
      "duplicate_fingerprints"
  ) {

    return rows
      .map(
        renderDuplicateFingerprint
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "duplicate_urls"
  ) {

    return rows
      .map(
        renderDuplicateUrl
      )
      .join(
        ""
      );
  }


  return rows
    .map(
      renderIntegrityVideo
    )
    .join(
      ""
    );
}


/**
 * Renders one group of catalogue records sharing the same fingerprint.
 */
function renderDuplicateFingerprint(
  item
) {

  const uids =
    Array.isArray(
      item.uids
    )
      ? item.uids
      : [];


  const films =
    Array.isArray(
      item.films
    )
      ? item.films
      : [];


  const videos =
    uids
      .map(
        (
          uid,
          index
        ) =>
          `
            <div class="admin-integrity-video">

              <span class="admin-integrity-video-uid">
                UID ${escapeHtml(uid)}
              </span>

              <span class="admin-integrity-video-film">
                ${escapeHtml(
                  films[index] ||
                  "Untitled"
                )}
              </span>

            </div>
          `
      )
      .join(
        ""
      );


  return `
    <div class="admin-integrity-result">

      <div class="admin-integrity-result-title">
        ${escapeHtml(
          item.occurrences ||
          uids.length
        )} catalogue entries share this file
      </div>

      <div class="admin-integrity-video-list">
        ${videos}
      </div>

      <div class="admin-integrity-fingerprint">
        ${escapeHtml(
          item.fingerprint ||
          ""
        )}
      </div>

    </div>
  `;
}


/**
 * Renders one group of catalogue records sharing the same media URL.
 */
function renderDuplicateUrl(
  item
) {

  const uids =
    Array.isArray(
      item.uids
    )
      ? item.uids
      : [];


  const films =
    Array.isArray(
      item.films
    )
      ? item.films
      : [];


  const videos =
    uids
      .map(
        (
          uid,
          index
        ) =>
          `
            <div class="admin-integrity-video">

              <span class="admin-integrity-video-uid">
                UID ${escapeHtml(uid)}
              </span>

              <span class="admin-integrity-video-film">
                ${escapeHtml(
                  films[index] ||
                  "Untitled"
                )}
              </span>

            </div>
          `
      )
      .join(
        ""
      );


  return `
    <div class="admin-integrity-result">

      <div class="admin-integrity-result-title">
        ${escapeHtml(
          item.occurrences ||
          uids.length
        )} catalogue entries share this URL
      </div>

      <div class="admin-integrity-video-list">
        ${videos}
      </div>

      <div class="admin-integrity-fingerprint">
        ${escapeHtml(
          item.url ||
          ""
        )}
      </div>

    </div>
  `;
}


/**
 * Renders a normal single-video integrity problem.
 *
 * This renderer is used by:
 *
 *     videos_without_actors
 *     old_media_urls
 *     missing_filesize
 *     missing_duration
 *     missing_resolution
 *     missing_fingerprint
 */
function renderIntegrityVideo(
  item
) {

  const resolution =
    item.width ||
    item.height
      ? `${
          item.width ?? "?"
        } × ${
          item.height ?? "?"
        }`
      : null;


  return `
    <div class="admin-integrity-result">

      <div class="admin-integrity-result-title">
        ${escapeHtml(
          item.film ||
          "Untitled"
        )}
      </div>

      <div class="admin-integrity-result-meta">

        <strong>
          UID:
        </strong>

        ${escapeHtml(
          item.uid ?? "—"
        )}

        ${
          resolution
            ? `
                &nbsp;&nbsp;

                <strong>
                  Resolution:
                </strong>

                ${escapeHtml(
                  resolution
                )}
              `
            : ""
        }

      </div>

      ${
        item.url
          ? `
              <div class="admin-integrity-fingerprint">
                ${escapeHtml(
                  item.url
                )}
              </div>
            `
          : ""
      }

    </div>
  `;
}


/* =====================================================================
   10. RECENT INGESTIONS TABLE
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
    Array.isArray(
      rows
    )
      ? rows
      : [];


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


  /*
   * Ingestion rows contain dynamically-created Lucide chevrons.
   */
  window.lucide?.createIcons();
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
   11. INGESTION EXPAND / COLLAPSE
===================================================================== */

/**
 * Shows or hides the diagnostics row immediately following an ingestion
 * summary row.
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


  window.lucide?.createIcons();
}


/* =====================================================================
   12. INGESTION COMPONENT STATES
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
   13. STATUS BADGES
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


  return String(
    status
  )
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
   14. COMPONENT STATE RENDERING
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
   15. DETAIL RENDERING
===================================================================== */

/**
 * Renders one ingestion diagnostic key/value pair.
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
   16. GENERAL UI HELPERS
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
   17. FORMATTERS
===================================================================== */

/**
 * Formats a byte count without importing the main site's utility module,
 * keeping the Admin dashboard self-contained.
 */
function formatBytes(
  bytes
) {

  const value =
    Number(
      bytes
    );


  if (
    !Number.isFinite(
      value
    ) ||
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
 * Film names, filenames, URLs, fingerprints and error messages can all
 * originate from external/user-controlled data and therefore must be
 * escaped before HTML insertion.
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
