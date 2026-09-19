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

   Missing thumbnail repair additionally reuses:

       zulu-sign-media
       zulu-upload-authorize
       thumbnails.js

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

   Catalogue Integrity checks:

       • duplicate URLs
       • duplicate fingerprints
       • videos without actors
       • non-current media URLs
       • missing filesize
       • missing duration
       • missing resolution
       • missing fingerprint

   Video Storage Health checks:

       • catalogue videos
       • Backblaze MP4 objects
       • exact filename matches
       • missing MP4 objects
       • orphaned MP4 objects
       • filename case mismatches
       • URL / filename errors
       • invalid storage objects

   Thumbnail Health checks:

       • expected thumbnails
       • present thumbnails
       • missing thumbnails
       • orphaned thumbnails
       • invalid thumbnail filenames

   Missing Thumbnail Repair:

       • signs the existing catalogue MP4
       • seeks directly into the remote MP4
       • generates thumbnail candidates
       • selects the highest-scoring candidate
       • uploads images/{uid}.png
       • reruns Thumbnail Health to verify the repair

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


/* ---------------------------------------------------------------------
   CATALOGUE INTEGRITY
--------------------------------------------------------------------- */

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


/* =====================================================================
   02. DASHBOARD STATE
===================================================================== */

/**
 * Latest Catalogue Integrity snapshot.
 */
let currentIntegrityData =
  null;


/* =====================================================================
   03. INITIALISATION
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


  integrityResultsClose?.addEventListener(
    "click",
    closeIntegrityResults
  );


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
   04. AUTHENTICATION
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
   05. DASHBOARD REFRESH
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
   06. ADMIN DASHBOARD REQUEST
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
   09. LIBRARY SUMMARY
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
   10. INGESTION HEALTH
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
   16. CATALOGUE INTEGRITY
===================================================================== */

/**
 * Renders the Catalogue Integrity counters returned by
 * zulu-admin-dashboard.
 *
 * The Edge Function currently returns the following diagnostic groups:
 *
 *     duplicate_urls
 *     duplicate_fingerprints
 *     videos_without_actors
 *     old_media_urls
 *     missing_filesize
 *     missing_duration
 *     missing_resolution
 *     missing_fingerprint
 *
 * Each group contains:
 *
 *     {
 *       count: number,
 *       rows: []
 *     }
 */
function renderCatalogueIntegrity(
  integrity
) {

  currentIntegrityData =
    integrity ||
    {};


  setNumber(
    integrityDuplicateUrls,
    getIntegrityCount(
      "duplicate_urls"
    )
  );


  setNumber(
    integrityDuplicateFingerprints,
    getIntegrityCount(
      "duplicate_fingerprints"
    )
  );


  setNumber(
    integrityNoActors,
    getIntegrityCount(
      "videos_without_actors"
    )
  );


  setNumber(
    integrityOldUrls,
    getIntegrityCount(
      "old_media_urls"
    )
  );


  setNumber(
    integrityMissingFilesize,
    getIntegrityCount(
      "missing_filesize"
    )
  );


  setNumber(
    integrityMissingDuration,
    getIntegrityCount(
      "missing_duration"
    )
  );


  setNumber(
    integrityMissingResolution,
    getIntegrityCount(
      "missing_resolution"
    )
  );


  setNumber(
    integrityMissingFingerprint,
    getIntegrityCount(
      "missing_fingerprint"
    )
  );


  /*
   * Apply a visual state to each diagnostic card.
   *
   * Duplicate fingerprints are warnings rather than automatic errors
   * because two catalogue rows can legitimately refer to technically
   * identical media.
   */
  setIntegrityCardState(
    "duplicate_urls",
    getIntegrityCount(
      "duplicate_urls"
    ) === 0
      ? "healthy"
      : "problem"
  );


  setIntegrityCardState(
    "duplicate_fingerprints",
    getIntegrityCount(
      "duplicate_fingerprints"
    ) === 0
      ? "healthy"
          : "warning"
  );


  setIntegrityCardState(
    "videos_without_actors",
    getIntegrityCount(
      "videos_without_actors"
    ) === 0
      ? "healthy"
      : "problem"
  );


  setIntegrityCardState(
    "old_media_urls",
    getIntegrityCount(
      "old_media_urls"
    ) === 0
      ? "healthy"
      : "problem"
  );


  setIntegrityCardState(
    "missing_filesize",
    getIntegrityCount(
      "missing_filesize"
    ) === 0
      ? "healthy"
      : "problem"
  );


  setIntegrityCardState(
    "missing_duration",
    getIntegrityCount(
      "missing_duration"
    ) === 0
      ? "healthy"
      : "problem"
  );


  setIntegrityCardState(
    "missing_resolution",
    getIntegrityCount(
      "missing_resolution"
    ) === 0
      ? "healthy"
      : "problem"
  );


  setIntegrityCardState(
    "missing_fingerprint",
    getIntegrityCount(
      "missing_fingerprint"
    ) === 0
      ? "healthy"
      : "problem"
  );


  /*
   * If the diagnostic drawer is already open, refresh its contents
   * using the newly-loaded snapshot.
   */
  if (
    integrityResults &&
    !integrityResults.hidden
  ) {

    const activeKey =
      integrityResults.dataset
        .integrityKey;


    if (
      activeKey
    ) {

      openIntegrityResult(
        activeKey
      );
    }
  }
}


/**
 * Returns the issue count for one Catalogue Integrity diagnostic.
 */
function getIntegrityCount(
  key
) {

  const item =
    currentIntegrityData?.[
      key
    ];


  if (
    item &&
    typeof item ===
      "object" &&
    !Array.isArray(
      item
    )
  ) {

    if (
      item.count !==
        undefined &&
      item.count !==
        null
    ) {

      return safeNumber(
        item.count
      );
    }


    if (
      Array.isArray(
        item.rows
      )
    ) {

      return item.rows.length;
    }
  }


  if (
    Array.isArray(
      item
    )
  ) {

    return item.length;
  }


  return safeNumber(
    item
  );
}


/**
 * Returns the diagnostic rows belonging to one Catalogue Integrity key.
 */
function getIntegrityRows(
  key
) {

  const item =
    currentIntegrityData?.[
      key
    ];


  if (
    Array.isArray(
      item
    )
  ) {

    return item;
  }


  if (
    item &&
    typeof item ===
      "object" &&
    Array.isArray(
      item.rows
    )
  ) {

    return item.rows;
  }


  return [];
}


/**
 * Applies the healthy / warning / problem state to one integrity card.
 */
function setIntegrityCardState(
  key,
  state
) {

  const card =
    document.querySelector(
      `[data-integrity-key="${key}"]`
    );


  if (
    !card
  ) {

    return;
  }


  card.classList.remove(
    "healthy",
    "warning",
    "problem"
  );


  if (
    state
  ) {

    card.classList.add(
      state
    );
  }
}


/**
 * Displays a Catalogue Integrity loading failure.
 */
function renderCatalogueIntegrityError(
  error
) {

  currentIntegrityData =
    null;


  const cards = [
    integrityDuplicateUrls,
    integrityDuplicateFingerprints,
    integrityNoActors,
    integrityOldUrls,
    integrityMissingFilesize,
    integrityMissingDuration,
    integrityMissingResolution,
    integrityMissingFingerprint
  ];


  cards.forEach(
    element => {

      if (
        element
      ) {

        element.textContent =
          "—";
      }
    }
  );


  document
    .querySelectorAll(
      ".admin-integrity-card"
    )
    .forEach(
      card => {

        card.classList.remove(
          "healthy",
          "warning"
        );


        card.classList.add(
          "problem"
        );
      }
    );


  if (
    integrityResultsBody
  ) {

    integrityResultsBody.innerHTML = `
      <div class="admin-diagnostic-error">
        ${escapeHtml(
          error?.message ||
          "Could not load Catalogue Integrity."
        )}
      </div>
    `;
  }
}


/* =====================================================================
   17. CATALOGUE INTEGRITY INTERACTION
===================================================================== */

/**
 * Opens one Catalogue Integrity diagnostic result.
 */
function openIntegrityResult(
  key
) {

  if (
    !key ||
    !integrityResults ||
    !integrityResultsTitle ||
    !integrityResultsBody
  ) {

    return;
  }


  const titles = {

    duplicate_urls:
      "Duplicate URLs",

    duplicate_fingerprints:
      "Duplicate Fingerprints",

    videos_without_actors:
      "Videos Without Actors",

    old_media_urls:
      "Non-current Media URLs",

    missing_filesize:
      "Missing Filesize",

    missing_duration:
      "Missing Duration",

    missing_resolution:
      "Missing Resolution",

    missing_fingerprint:
      "Missing Fingerprint"
  };


  const rows =
    getIntegrityRows(
      key
    );


  integrityResults.dataset
    .integrityKey =
      key;


  integrityResultsTitle.textContent =
    titles[
      key
    ] ||
    "Catalogue Integrity";


  integrityResultsBody.innerHTML =
    renderIntegrityRows(
      key,
      rows
    );


  integrityResults.hidden =
    false;


  /*
   * Duplicate-fingerprint rows contain controls that are generated
   * dynamically by renderIntegrityRows(), so attach their handlers only
   * after the HTML has been inserted into the document.
   */
  if (
    key ===
      "duplicate_fingerprints"
  ) {

    attachDuplicateVideoEvents();

    attachDuplicateKeepBothEvents();

    attachDuplicateConsolidateEvents();
  }


  window.lucide?.createIcons();
}


/**
 * Closes the Catalogue Integrity diagnostic result drawer.
 */
function closeIntegrityResults() {

  if (
    !integrityResults
  ) {

    return;
  }


  integrityResults.hidden =
    true;


  delete integrityResults.dataset
    .integrityKey;
}


/**
 * Renders all rows belonging to one Catalogue Integrity diagnostic.
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

    return renderEmptyResult(
      "✓ No issues found."
    );
  }


  if (
    key ===
      "duplicate_fingerprints"
  ) {

    return rows
      .map(
        group =>
          renderDuplicateFingerprintGroup(
            group
          )
      )
      .join(
        ""
      );
  }


  return rows
    .map(
      row =>
        renderIntegrityRow(
          key,
          row
        )
    )
    .join(
      ""
    );
}


/**
 * Renders one ordinary Catalogue Integrity result row.
 */
function renderIntegrityRow(
  key,
  row
) {

  const uid =
    firstValue(
      row?.uid,
      row?.video_uid,
      row?.id
    );


  const film =
    firstValue(
      row?.film,
      row?.title,
      row?.name,
      "Untitled"
    );


  let heading =
    film;


  let meta =
    "";


  switch (
    key
  ) {

    case "duplicate_urls":

      heading =
        firstValue(
          row?.url,
          film,
          "Duplicate URL"
        );


      meta =
        renderGenericIntegrityMeta(
          row
        );

      break;


    case "videos_without_actors":

      meta = `
        <div class="admin-integrity-result-meta">

          <div>
            <strong>
              UID:
            </strong>

            <span>
              ${escapeHtml(
                uid ?? "—"
              )}
            </span>
          </div>

        </div>
      `;

      break;


    case "old_media_urls":

      meta = `
        <div class="admin-integrity-result-meta">

          <div>
            <strong>
              UID:
            </strong>

            <span>
              ${escapeHtml(
                uid ?? "—"
              )}
            </span>
          </div>

          <div>
            <strong>
              URL:
            </strong>

            <span class="admin-integrity-file">
              ${escapeHtml(
                firstValue(
                  row?.url,
                  row?.video_url,
                  "—"
                )
              )}
            </span>
          </div>

        </div>
      `;

      break;


    case "missing_filesize":

    case "missing_duration":

    case "missing_resolution":

    case "missing_fingerprint":

      meta = `
        <div class="admin-integrity-result-meta">

          <div>
            <strong>
              UID:
            </strong>

            <span>
              ${escapeHtml(
                uid ?? "—"
              )}
            </span>
          </div>

          ${
            row?.url
              ? `
                <div>
                  <strong>
                    File:
                  </strong>

                  <span class="admin-integrity-file">
                    ${escapeHtml(
                      filenameFromUrl(
                        row.url
                      ) ||
                      row.url
                    )}
                  </span>
                </div>
              `
              : ""
          }

        </div>
      `;

      break;


    default:

      meta =
        renderGenericIntegrityMeta(
          row
        );

      break;
  }


  return `
    <div class="admin-integrity-result-row">

      <div class="admin-integrity-result-main">

        <strong>
          ${escapeHtml(
            heading
          )}
        </strong>

        ${meta}

      </div>

    </div>
  `;
}


/**
 * Renders one duplicate-fingerprint group.
 *
 * Fingerprint equality by itself is NOT considered sufficient evidence
 * for destructive consolidation.
 *
 * The comparison block therefore also shows:
 *
 *     • filesize
 *     • duration
 *     • resolution
 *
 * and keeps all destructive repair behind a separate server-side
 * preview / confirmation flow.
 */
function renderDuplicateFingerprintGroup(
  group
) {

  const fingerprint =
    String(
      group?.fingerprint ||
      ""
    );


  const videos =
    normaliseDuplicateVideos(
      group
    );


  const review =
    normaliseDuplicateReview(
      group
    );


  const comparison =
    compareDuplicateVideos(
      videos
    );


  const exactlyTwoVideos =
    videos.length ===
      2;


  const technicalMatch =
    exactlyTwoVideos &&
    comparison
      .allTechnicalMetadataMatches;


  const reviewStatus =
    review
      ? formatDuplicateReviewStatus(
          review
        )
      : "";


  return `
    <section
      class="admin-duplicate-group"
      data-duplicate-fingerprint="${escapeHtml(
        fingerprint
      )}"
    >

      <div class="admin-duplicate-group-heading">

        <div>

          <span class="admin-duplicate-group-label">
            Fingerprint
          </span>

          <strong class="admin-duplicate-fingerprint">
            ${escapeHtml(
              fingerprint ||
              "—"
            )}
          </strong>

        </div>


        <span class="admin-duplicate-count">
          ${escapeHtml(
            videos.length
          )}
          ${
            videos.length === 1
              ? "record"
              : "records"
          }
        </span>

      </div>


      ${
        reviewStatus
          ? `
            <div class="admin-duplicate-review-status">
              ${escapeHtml(
                reviewStatus
              )}
            </div>
          `
          : ""
      }


      <div class="admin-duplicate-video-grid">

        ${videos
          .map(
            video =>
              renderDuplicateVideoCard(
                video
              )
          )
          .join(
            ""
          )}

      </div>


      ${
        exactlyTwoVideos
          ? `
            <div class="admin-duplicate-comparison">

              ${renderDuplicateComparisonRow(
                "Fingerprint",
                comparison.sameFingerprint,
                comparison.sameFingerprint
                  ? "Match"
                  : "Different"
              )}

              ${renderDuplicateComparisonRow(
                "Filesize",
                comparison.sameFilesize,
                comparison.sameFilesize
                  ? "Match"
                  : "Different"
              )}

              ${renderDuplicateComparisonRow(
                "Duration",
                comparison.sameDuration,
                comparison.sameDuration
                  ? "Match"
                  : "Different"
              )}

              ${renderDuplicateComparisonRow(
                "Resolution",
                comparison.sameResolution,
                comparison.sameResolution
                  ? "Match"
                  : "Different"
              )}

            </div>
          `
          : ""
      }


      <div class="admin-duplicate-group-actions">

        ${
          exactlyTwoVideos
            ? `
              <button
                type="button"
                class="admin-duplicate-consolidate"
                data-duplicate-consolidate="${escapeHtml(
                  fingerprint
                )}"
                ${
                  technicalMatch
                    ? ""
                    : "disabled"
                }
              >

                <i data-lucide="combine"></i>

                <span>
                  Consolidate
                </span>

              </button>


              <button
                type="button"
                class="admin-duplicate-keep-both"
                data-duplicate-keep-both="${escapeHtml(
                  fingerprint
                )}"
                disabled
              >

                <i data-lucide="copy-check"></i>

                <span>
                  Keep Both
                </span>

              </button>
            `
            : ""
        }

      </div>


      ${
        exactlyTwoVideos &&
        !technicalMatch
          ? `
            <div class="admin-duplicate-warning">

              <i data-lucide="triangle-alert"></i>

              <span>
                Technical metadata differs. Automatic consolidation
                is disabled.
              </span>

            </div>
          `
          : ""
      }


      <div
        class="admin-duplicate-consolidation-preview"
        hidden
      ></div>

    </section>
  `;
}


/**
 * Normalises the videos array returned inside one duplicate-fingerprint
 * diagnostic group.
 */
function normaliseDuplicateVideos(
  group
) {

  if (
    Array.isArray(
      group?.videos
    )
  ) {

    return group.videos;
  }


  if (
    Array.isArray(
      group?.rows
    )
  ) {

    return group.rows;
  }


  if (
    Array.isArray(
      group?.records
    )
  ) {

    return group.records;
  }


  return [];
}


/**
 * Normalises the optional review record attached to a duplicate group.
 */
function normaliseDuplicateReview(
  group
) {

  const review =
    group?.review ||
    group?.duplicate_review ||
    null;


  if (
    !review ||
    typeof review !==
      "object"
  ) {

    return null;
  }


  return review;
}


/**
 * Formats a stored duplicate review for display.
 */
function formatDuplicateReviewStatus(
  review
) {

  const status =
    normaliseStatus(
      firstValue(
        review?.status,
        review?.decision,
        review?.action
      )
    );


  switch (
    status
  ) {

    case "keep_both":

      return "Reviewed — keep both";


    case "consolidated":

      return "Reviewed — consolidated";


    case "ignored":

      return "Reviewed — ignored";


    default:

      return status
        ? `Reviewed — ${humaniseStatus(
            status
          )}`
        : "Reviewed";
  }
}


/**
 * Attaches the Consolidate controls for duplicate-fingerprint groups.
 *
 * Clicking Consolidate does NOT immediately change the catalogue.
 *
 * Instead it asks the protected zulu-catalogue-repair Edge Function for
 * a fresh server-side preview. The backend re-reads both catalogue rows
 * and revalidates the duplicate immediately before returning the impact
 * information shown to the administrator.
 */
function attachDuplicateConsolidateEvents() {

  document
    .querySelectorAll(
      "[data-duplicate-consolidate]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            const fingerprint =
              button.dataset
                .duplicateConsolidate;


            if (
              !fingerprint
            ) {

              return;
            }


            await requestDuplicateConsolidationPreview(
              fingerprint,
              button
            );
          }
        );
      }
    );
}


/**
 * Requests a fresh duplicate-consolidation preview from the protected
 * repair backend.
 */
async function requestDuplicateConsolidationPreview(
  fingerprint,
  button
) {

  const group =
    button.closest(
      ".admin-duplicate-group"
    );


  const preview =
    group?.querySelector(
      ".admin-duplicate-consolidation-preview"
    );


  if (
    !group ||
    !preview
  ) {

    return;
  }


  const originalHtml =
    button.innerHTML;


  button.disabled =
    true;


  button.classList.add(
    "is-working"
  );


  button.innerHTML = `
    <i data-lucide="loader-circle"></i>

    <span>
      Checking…
    </span>
  `;


  preview.hidden =
    true;


  preview.innerHTML =
    "";


  window.lucide?.createIcons();


  try {

    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        "zulu-catalogue-repair",
        {
          body: {

            action:
              "preview_duplicate",

            fingerprint
          }
        }
      );


    if (
      error
    ) {

      throw new Error(
        error.message ||
        "Catalogue repair preview failed."
      );
    }


    if (
      !data ||
      data.success !== true
    ) {

      throw new Error(
        data?.error ||
        "The catalogue repair preview was unsuccessful."
      );
    }


    renderDuplicateConsolidationPreview(
      group,
      fingerprint,
      data
    );


  } catch (
    error
  ) {

    console.error(
      "DUPLICATE CONSOLIDATION PREVIEW ERROR:",
      error
    );


    preview.hidden =
      false;


    preview.innerHTML = `
      <div class="admin-duplicate-consolidation-error">

        <i data-lucide="triangle-alert"></i>

        <span>
          ${escapeHtml(
            error?.message ||
            "Could not load consolidation preview."
          )}
        </span>

      </div>
    `;


    window.lucide?.createIcons();


  } finally {

    button.disabled =
      false;


    button.classList.remove(
      "is-working"
    );


    button.innerHTML =
      originalHtml;


    window.lucide?.createIcons();
  }
}


/**
 * Renders the server-validated duplicate consolidation preview.
 */
function renderDuplicateConsolidationPreview(
  group,
  fingerprint,
  data
) {

  const preview =
    group.querySelector(
      ".admin-duplicate-consolidation-preview"
    );


  if (
    !preview
  ) {

    return;
  }


  const videos =
    Array.isArray(
      data?.videos
    )
      ? data.videos
      : [];


  if (
    videos.length !==
      2
  ) {

    preview.hidden =
      false;


    preview.innerHTML = `
      <div class="admin-duplicate-consolidation-error">

        <i data-lucide="triangle-alert"></i>

        <span>
          The server did not return exactly two duplicate records.
          Consolidation has been stopped.
        </span>

      </div>
    `;


    window.lucide?.createIcons();


    return;
  }


  const impact =
    data?.impact ||
    {};


  preview.hidden =
    false;


  preview.innerHTML = `
    <div class="admin-duplicate-consolidation-panel">

      <div class="admin-duplicate-consolidation-heading">

        <div>

          <span class="admin-duplicate-consolidation-kicker">
            Server-validated repair preview
          </span>

          <h4>
            Choose the catalogue record to keep
          </h4>

        </div>

        <i data-lucide="shield-check"></i>

      </div>


      <p class="admin-duplicate-consolidation-copy">

        The backend has re-read both catalogue rows and confirmed
        that they are still eligible for consolidation.

        Choose the UID that should survive.

        The other catalogue row will be removed only after a final
        server-side revalidation.

      </p>


      <div class="admin-duplicate-survivor-options">

        ${videos
          .map(
            (
              video,
              index
            ) =>
              renderDuplicateSurvivorOption(
                video,
                index === 0
              )
          )
          .join(
            ""
          )}

      </div>


      ${renderDuplicateConsolidationImpact(
        impact
      )}


      <div class="admin-duplicate-consolidation-note">

        <i data-lucide="hard-drive"></i>

        <span>
          Catalogue consolidation does not delete the redundant
          Backblaze MP4 or thumbnail. Any redundant physical objects
          will subsequently appear in the relevant storage-health
          orphan diagnostics.
        </span>

      </div>


      <div
        class="admin-duplicate-consolidation-message"
        hidden
      ></div>


      <div class="admin-duplicate-consolidation-actions">

        <button
          type="button"
          class="admin-duplicate-consolidation-cancel"
        >
          Cancel
        </button>


        <button
          type="button"
          class="admin-duplicate-consolidation-confirm"
          data-duplicate-confirm="${escapeHtml(
            fingerprint
          )}"
        >

          <i data-lucide="combine"></i>

          <span>
            Consolidate Catalogue Records
          </span>

        </button>

      </div>

    </div>
  `;


  attachDuplicateConsolidationPreviewEvents(
    group,
    fingerprint,
    videos
  );


  window.lucide?.createIcons();
}


/**
 * Renders one radio option in the duplicate consolidation preview.
 */
function renderDuplicateSurvivorOption(
  video,
  checked
) {

  const uid =
    Number(
      video?.uid
    );


  return `
    <label class="admin-duplicate-survivor-option">

      <input
        type="radio"
        name="admin-duplicate-survivor"
        value="${escapeHtml(
          uid
        )}"
        ${
          checked
            ? "checked"
            : ""
        }
      >


      <span class="admin-duplicate-survivor-content">

        <span class="admin-duplicate-survivor-heading">

          <strong>
            UID ${escapeHtml(
              uid
            )}
          </strong>

          <span>
            ${escapeHtml(
              video?.film ||
              "Untitled"
            )}
          </span>

        </span>


        <span class="admin-duplicate-survivor-file">
          ${escapeHtml(
            getDuplicateMediaFilename(
              video?.url
            ) ||
            "—"
          )}
        </span>

      </span>

    </label>
  `;
}


/**
 * Renders the relationship / history migration counts returned by the
 * backend preview.
 */
function renderDuplicateConsolidationImpact(
  impact
) {

  const fields = [
    [
      "Views",
      firstValue(
        impact?.views,
        impact?.video_views,
        0
      )
    ],

    [
      "Actor relationships",
      firstValue(
        impact?.actors,
        impact?.actor_relationships,
        0
      )
    ],

    [
      "Ingestion references",
      firstValue(
        impact?.ingestions,
        impact?.ingestion_references,
        0
      )
    ]
  ];


  return `
    <div class="admin-duplicate-consolidation-impact">

      <strong>
        Related data to preserve
      </strong>


      <div class="admin-duplicate-consolidation-impact-grid">

        ${fields
          .map(
            (
              [
                label,
                value
              ]
            ) => `
              <div>

                <span>
                  ${escapeHtml(
                    label
                  )}
                </span>

                <strong>
                  ${escapeHtml(
                    safeNumber(
                      value
                    )
                  )}
                </strong>

              </div>
            `
          )
          .join(
            ""
          )}

      </div>

    </div>
  `;
}
/**
 * Attaches the controls inside a server-validated consolidation preview.
 */
function attachDuplicateConsolidationPreviewEvents(
  group,
  fingerprint,
  videos
) {

  const preview =
    group.querySelector(
      ".admin-duplicate-consolidation-preview"
    );


  if (
    !preview
  ) {

    return;
  }


  const cancelButton =
    preview.querySelector(
      ".admin-duplicate-consolidation-cancel"
    );


  const confirmButton =
    preview.querySelector(
      ".admin-duplicate-consolidation-confirm"
    );


  cancelButton?.addEventListener(
    "click",
    () => {

      preview.hidden =
        true;


      preview.innerHTML =
        "";
    }
  );


  confirmButton?.addEventListener(
    "click",
    async () => {

      const selected =
        preview.querySelector(
          'input[name="admin-duplicate-survivor"]:checked'
        );


      if (
        !selected
      ) {

        showDuplicateConsolidationError(
          group,
          "Choose the catalogue UID that should survive."
        );


        return;
      }


      const survivorUid =
        Number(
          selected.value
        );


      const survivor =
        videos.find(
          video =>
            Number(
              video?.uid
            ) ===
            survivorUid
        );


      const removed =
        videos.find(
          video =>
            Number(
              video?.uid
            ) !==
            survivorUid
        );


      if (
        !survivor ||
        !removed
      ) {

        showDuplicateConsolidationError(
          group,
          "Could not determine the surviving and removed catalogue records."
        );


        return;
      }


      clearDuplicateConsolidationMessage(
        group
      );


      resetDuplicateConsolidationConfirmButton(
        confirmButton
      );


      confirmButton.dataset
        .duplicateConfirmStage =
          "confirm";


      showDuplicateConsolidationConfirmation(
        group,
        survivor,
        removed
      );
    }
  );


  preview
    .querySelectorAll(
      'input[name="admin-duplicate-survivor"]'
    )
    .forEach(
      radio => {

        radio.addEventListener(
          "change",
          () => {

            clearDuplicateConsolidationMessage(
              group
            );


            resetDuplicateConsolidationConfirmButton(
              confirmButton
            );
          }
        );
      }
    );


  confirmButton?.addEventListener(
    "click",
    async event => {

      if (
        confirmButton.dataset
          .duplicateConfirmStage !==
          "confirm"
      ) {

        return;
      }


      event.preventDefault();
      event.stopImmediatePropagation();


      const selected =
        preview.querySelector(
          'input[name="admin-duplicate-survivor"]:checked'
        );


      if (
        !selected
      ) {

        showDuplicateConsolidationError(
          group,
          "Choose the catalogue UID that should survive."
        );


        return;
      }


      const survivorUid =
        Number(
          selected.value
        );


      const survivor =
        videos.find(
          video =>
            Number(
              video?.uid
            ) ===
            survivorUid
        );


      const removed =
        videos.find(
          video =>
            Number(
              video?.uid
            ) !==
            survivorUid
        );


      if (
        !survivor ||
        !removed
      ) {

        showDuplicateConsolidationError(
          group,
          "Could not determine the surviving and removed catalogue records."
        );


        return;
      }


      await performDuplicateConsolidation(
        group,
        fingerprint,
        survivor,
        removed,
        confirmButton
      );
    },
    true
  );
}


/**
 * Clears any confirmation / error message shown inside a duplicate
 * consolidation preview.
 */
function clearDuplicateConsolidationMessage(
  group
) {

  const message =
    group.querySelector(
      ".admin-duplicate-consolidation-message"
    );


  if (
    !message
  ) {

    return;
  }


  message.hidden =
    true;


  message.classList.remove(
    "is-confirmation",
    "is-error"
  );


  message.innerHTML =
    "";
}


/**
 * Restores the consolidation button to its initial state.
 */
function resetDuplicateConsolidationConfirmButton(
  button
) {

  if (
    !button
  ) {

    return;
  }


  delete button.dataset
    .duplicateConfirmStage;


  button.disabled =
    false;


  button.classList.remove(
    "is-working"
  );


  button.innerHTML = `
    <i data-lucide="combine"></i>

    <span>
      Consolidate Catalogue Records
    </span>
  `;


  window.lucide?.createIcons();
}


/**
 * Shows the explicit second-step confirmation before a destructive
 * catalogue consolidation.
 */
function showDuplicateConsolidationConfirmation(
  group,
  survivor,
  removed
) {

  const message =
    group.querySelector(
      ".admin-duplicate-consolidation-message"
    );


  const button =
    group.querySelector(
      ".admin-duplicate-consolidation-confirm"
    );


  if (
    !message ||
    !button
  ) {

    return;
  }


  message.hidden =
    false;


  message.classList.remove(
    "is-error"
  );


  message.classList.add(
    "is-confirmation"
  );


  message.innerHTML = `
    <div>

      <strong>
        Confirm catalogue consolidation
      </strong>

      <p>
        UID
        <strong>
          ${escapeHtml(
            survivor.uid
          )}
        </strong>
        will survive.

        UID
        <strong>
          ${escapeHtml(
            removed.uid
          )}
        </strong>
        will be removed from the catalogue.
      </p>

      <p>
        Related views, actor relationships and ingestion references
        will be migrated to the surviving UID where required.
      </p>

      <p>
        The physical Backblaze MP4 and thumbnail belonging to the
        removed catalogue row will NOT be deleted by this action.
      </p>

    </div>
  `;


  button.dataset
    .duplicateConfirmStage =
      "confirm";


  button.innerHTML = `
    <i data-lucide="triangle-alert"></i>

    <span>
      Confirm Consolidation
    </span>
  `;


  window.lucide?.createIcons();
}


/**
 * Shows an error inside the duplicate consolidation preview.
 */
function showDuplicateConsolidationError(
  group,
  messageText
) {

  const message =
    group.querySelector(
      ".admin-duplicate-consolidation-message"
    );


  if (
    !message
  ) {

    return;
  }


  message.hidden =
    false;


  message.classList.remove(
    "is-confirmation"
  );


  message.classList.add(
    "is-error"
  );


  message.innerHTML = `
    <div>

      <i data-lucide="triangle-alert"></i>

      <span>
        ${escapeHtml(
          messageText
        )}
      </span>

    </div>
  `;


  window.lucide?.createIcons();
}


/**
 * Performs the destructive catalogue consolidation after:
 *
 *     1. the backend preview has revalidated the duplicate
 *     2. the administrator has chosen the surviving UID
 *     3. the administrator has explicitly confirmed the action
 *
 * The backend performs its own final validation again before changing
 * any catalogue data.
 */
async function performDuplicateConsolidation(
  group,
  fingerprint,
  survivor,
  removed,
  button
) {

  if (
    !group ||
    !fingerprint ||
    !survivor ||
    !removed ||
    !button
  ) {

    return;
  }


  button.disabled =
    true;


  button.classList.add(
    "is-working"
  );


  button.innerHTML = `
    <i data-lucide="loader-circle"></i>

    <span>
      Consolidating…
    </span>
  `;


  clearDuplicateConsolidationMessage(
    group
  );


  window.lucide?.createIcons();


  try {

    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        "zulu-catalogue-repair",
        {
          body: {

            action:
              "consolidate_duplicate",

            fingerprint,

            survivor_uid:
              Number(
                survivor.uid
              ),

            removed_uid:
              Number(
                removed.uid
              )
          }
        }
      );


    if (
      error
    ) {

      throw new Error(
        error.message ||
        "Catalogue consolidation request failed."
      );
    }


    if (
      !data ||
      data.success !== true
    ) {

      throw new Error(
        data?.error ||
        "Catalogue consolidation was unsuccessful."
      );
    }


    /* ---------------------------------------------------------------
       SUCCESS

       Show the result before refreshing the health snapshots.
    --------------------------------------------------------------- */

    const preview =
      group?.querySelector(
        ".admin-duplicate-consolidation-preview"
      );


    if (
      preview
    ) {

      preview.innerHTML = `
        <div class="admin-duplicate-consolidation-success">

          <div class="admin-duplicate-consolidation-success-heading">

            <i data-lucide="circle-check"></i>

            <span>
              Catalogue consolidation complete
            </span>

          </div>


          <p>

            <strong>
              UID ${escapeHtml(
                survivor.uid
              )}
            </strong>

            has been retained and

            <strong>
              UID ${escapeHtml(
                removed.uid
              )}
            </strong>

            has been removed from the catalogue.

            Views, actor relationships and ingestion references
            have been preserved under the surviving UID.

            The redundant physical MP4 and thumbnail have not
            been deleted.

          </p>

        </div>
      `;
    }


    window.lucide?.createIcons();


    /*
     * Refresh all three Admin health sources:
     *
     *     • Catalogue Integrity
     *     • Video Storage Health
     *     • Thumbnail Health
     *
     * The redundant physical MP4 / thumbnail should now appear
     * through the relevant orphan diagnostics.
     *
     * Do not await this before the success message has been rendered.
     */
    await refreshAdmin();


    /*
     * Reopen Duplicate Fingerprints using the newly loaded dashboard
     * snapshot. The successfully consolidated pair should have vanished.
     */
    openIntegrityResult(
      "duplicate_fingerprints"
    );


  } catch (
    error
  ) {

    console.error(
      "DUPLICATE CONSOLIDATION ERROR:",
      error
    );


    showDuplicateConsolidationError(
      group,
      `Could not consolidate duplicate: ${
        error?.message ||
        "Unknown error"
      }`
    );


    button.disabled =
      false;


    button.classList.remove(
      "is-working"
    );


    button.innerHTML = `
      <i data-lucide="rotate-ccw"></i>

      <span>
        Try Consolidation Again
      </span>
    `;


    window.lucide?.createIcons();
  }
}


/**
 * Renders one zulu_videos record within a duplicate-fingerprint group.
 */
function renderDuplicateVideoCard(
  video
) {

  const uid =
    video?.uid ??
    "—";


  const film =
    String(
      video?.film ||
      "Untitled"
    );


  const url =
    String(
      video?.url ||
      ""
    );


  const filename =
    getDuplicateMediaFilename(
      url
    );


  const filesize =
    formatBytes(
      video?.filesize_bytes
    );


  const duration =
    formatDuplicateDuration(
      video?.duration_seconds
    );


  const resolution =
    formatDuplicateResolution(
      video?.width,
      video?.height
    );


  const tags =
    String(
      video?.tags ||
      ""
    );


  const ingested =
    video?.ingested_at
      ? formatDateTime(
          video.ingested_at
        )
      : "—";


  return `
    <div class="admin-duplicate-video-card">

      <div class="admin-duplicate-video-heading">

        <span class="admin-duplicate-video-uid">
          UID ${escapeHtml(
            uid
          )}
        </span>

        <strong>
          ${escapeHtml(
            film
          )}
        </strong>

      </div>


      <dl class="admin-duplicate-video-meta">

        <div>

          <dt>
            File
          </dt>

          <dd>
            ${escapeHtml(
              filename ||
              "—"
            )}
          </dd>

        </div>


        <div>

          <dt>
            Filesize
          </dt>

          <dd>
            ${escapeHtml(
              filesize
            )}
          </dd>

        </div>


        <div>

          <dt>
            Duration
          </dt>

          <dd>
            ${escapeHtml(
              duration
            )}
          </dd>

        </div>


        <div>

          <dt>
            Resolution
          </dt>

          <dd>
            ${escapeHtml(
              resolution
            )}
          </dd>

        </div>


        <div>

          <dt>
            Tags
          </dt>

          <dd>
            ${escapeHtml(
              tags ||
              "—"
            )}
          </dd>

        </div>


        <div>

          <dt>
            Ingested
          </dt>

          <dd>
            ${escapeHtml(
              ingested
            )}
          </dd>

        </div>

      </dl>


      ${
        url
          ? `
            <button
              type="button"
              class="admin-duplicate-video-link"
              data-duplicate-open-video="${escapeHtml(
                url
              )}"
            >

              <i data-lucide="play"></i>

              <span>
                Open Video
              </span>

            </button>
            `
          : ""
      }

    </div>
  `;
}


/**
 * Attaches the Open Video controls used by duplicate-fingerprint
 * catalogue records.
 *
 * The raw catalogue URL cannot be opened directly because the media
 * Worker correctly rejects unsigned requests.
 *
 * Instead we request a temporary signed URL from zulu-sign-media.
 */
function attachDuplicateVideoEvents() {

  document
    .querySelectorAll(
      "[data-duplicate-open-video]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            const originalUrl =
              button.dataset
                .duplicateOpenVideo;


            if (
              !originalUrl
            ) {

              return;
            }


            const originalHtml =
              button.innerHTML;


            button.disabled =
              true;


            button.innerHTML = `
              <i data-lucide="loader-circle"></i>

              <span>
                Opening…
              </span>
            `;


            window.lucide?.createIcons();


            try {

              const signedUrl =
                await getAdminSignedVideoUrl(
                  originalUrl
                );


              window.open(
                signedUrl,
                "_blank",
                "noopener,noreferrer"
              );


            } catch (
              error
            ) {

              console.error(
                "OPEN DUPLICATE VIDEO ERROR:",
                error
              );


              alert(
                `Could not open video: ${
                  error?.message ||
                  "Unknown error"
                }`
              );


            } finally {

              button.disabled =
                false;


              button.innerHTML =
                originalHtml;


              window.lucide?.createIcons();
            }
          }
        );
      }
    );
}


/**
 * Requests a temporary signed media URL for an Admin video preview.
 */
async function getAdminSignedVideoUrl(
  originalUrl
) {

  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "zulu-sign-media",
      {
        body: {
          url:
            originalUrl
        }
      }
    );


  if (
    error
  ) {

    throw new Error(
      error.message ||
      "Could not sign the video URL."
    );
  }


  if (
    !data ||
    data.success !== true ||
    !data.url
  ) {

    throw new Error(
      data?.error ||
      "The signing service did not return a usable video URL."
    );
  }


  return data.url;
}


/**
 * Attaches the Keep Both controls for duplicate-fingerprint groups.
 */
function attachDuplicateKeepBothEvents() {

  document
    .querySelectorAll(
      "[data-duplicate-keep-both]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          async () => {

            /*
             * Disabled Keep Both buttons cannot normally trigger this
             * handler. Keep this guard so the action remains protected
             * even if the DOM is changed manually.
             */
            if (
              button.disabled
            ) {

              return;
            }


            const fingerprint =
              button.dataset
                .duplicateKeepBoth;


            if (
              !fingerprint
            ) {

              return;
            }


            const confirmed =
              window.confirm(
                "Keep both catalogue records?\n\n" +
                "This will mark this duplicate fingerprint group as reviewed and intentionally retained.\n\n" +
                "No catalogue records, videos or thumbnails will be deleted."
              );


            if (
              !confirmed
            ) {

              return;
            }


            const originalHtml =
              button.innerHTML;


            button.disabled =
              true;


            button.innerHTML = `
              <i data-lucide="loader-circle"></i>

              <span>
                Saving…
              </span>
            `;


            window.lucide?.createIcons();


            try {

              const {
                data,
                error
              } =
                await supabase.functions.invoke(
                  "zulu-catalogue-repair",
                  {
                    body: {
                      action:
                        "keep_both",

                      fingerprint
                    }
                  }
                );


              if (
                error
              ) {

                throw new Error(
                  error.message ||
                  "Catalogue repair request failed."
                );
              }


              if (
                !data ||
                data.success !== true
              ) {

                throw new Error(
                  data?.error ||
                  "The Keep Both request was unsuccessful."
                );
              }


              button.innerHTML = `
                <i data-lucide="circle-check"></i>

                <span>
                  Kept Both
                </span>
              `;


              window.lucide?.createIcons();


              await refreshAdmin();


            } catch (
              error
            ) {

              console.error(
                "KEEP BOTH ERROR:",
                error
              );


              alert(
                `Could not record Keep Both: ${
                  error?.message ||
                  "Unknown error"
                }`
              );


              button.disabled =
                false;


              button.innerHTML =
                originalHtml;


              window.lucide?.createIcons();
            }
          }
        );
      }
    );
}


/**
 * Compares the fields that help determine whether catalogue records
 * appear to represent the same physical video.
 *
 * Fingerprint equality alone is not treated as sufficient evidence for
 * deletion. Filesize, duration and resolution are also compared.
 */
function compareDuplicateVideos(
  videos
) {

  const allEqual =
    getter => {

      if (
        videos.length <
          2
      ) {

        return true;
      }


      const firstValue =
        getter(
          videos[0]
        );


      return videos
        .slice(
          1
        )
        .every(
          video =>
            getter(
              video
            ) ===
            firstValue
        );
    };


  const sameFingerprint =
    allEqual(
      video =>
        String(
          video?.fingerprint ||
          ""
        )
    );


  const sameFilesize =
    allEqual(
      video =>
        normaliseDuplicateNumber(
          video?.filesize_bytes
        )
    );


  const sameDuration =
    allEqual(
      video =>
        normaliseDuplicateNumber(
          video?.duration_seconds
        )
    );


  const sameResolution =
    allEqual(
      video => {

        const width =
          normaliseDuplicateNumber(
            video?.width
          );


        const height =
          normaliseDuplicateNumber(
            video?.height
          );


        return `${width}x${height}`;
      }
    );


  const sameFilm =
    allEqual(
      video =>
        String(
          video?.film ||
          ""
        )
          .trim()
          .toLowerCase()
    );


  const sameUrl =
    allEqual(
      video =>
        String(
          video?.url ||
          ""
        )
          .trim()
    );


  return {
    sameFingerprint,
    sameFilesize,
    sameDuration,
    sameResolution,
    sameFilm,
    sameUrl,

    allTechnicalMetadataMatches:
      sameFingerprint &&
      sameFilesize &&
      sameDuration &&
      sameResolution
  };
}


/**
 * Normalises numeric catalogue metadata for comparison.
 */
function normaliseDuplicateNumber(
  value
) {

  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ""
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}
/**
 * Renders one duplicate comparison result.
 */
function renderDuplicateComparisonRow(
  label,
  matches,
  text
) {

  return `
    <div
      class="
        admin-duplicate-comparison-row
        ${
          matches
            ? "is-match"
            : "is-different"
        }
      "
    >

      <span>
        ${escapeHtml(
          label
        )}
      </span>


      <strong>

        <i
          data-lucide="${
            matches
              ? "circle-check"
              : "triangle-alert"
          }"
        ></i>

        ${escapeHtml(
          text
        )}

      </strong>

    </div>
  `;
}


/**
 * Extracts a readable filename from a duplicate catalogue media URL.
 */
function getDuplicateMediaFilename(
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


    const parts =
      parsed.pathname.split(
        "/"
      );


    const filename =
      parts[
        parts.length - 1
      ] ||
      "";


    return decodeURIComponent(
      filename
    );


  } catch {

    const parts =
      String(
        value
      ).split(
        "/"
      );


    const filename =
      parts[
        parts.length - 1
      ] ||
      "";


    try {

      return decodeURIComponent(
        filename
      );


    } catch {

      return filename;
    }
  }
}


/**
 * Formats duplicate duration metadata.
 */
function formatDuplicateDuration(
  value
) {

  const seconds =
    Number(
      value
    );


  if (
    !Number.isFinite(
      seconds
    ) ||
    seconds < 0
  ) {

    return "—";
  }


  const rounded =
    Math.round(
      seconds
    );


  const hours =
    Math.floor(
      rounded /
      3600
    );


  const minutes =
    Math.floor(
      (
        rounded %
        3600
      ) /
      60
    );


  const remainingSeconds =
    rounded %
    60;


  if (
    hours > 0
  ) {

    return [
      hours,
      String(
        minutes
      ).padStart(
        2,
        "0"
      ),
      String(
        remainingSeconds
      ).padStart(
        2,
        "0"
      )
    ].join(
      ":"
    );
  }


  return [
    minutes,
    String(
      remainingSeconds
    ).padStart(
      2,
      "0"
    )
  ].join(
    ":"
  );
}


/**
 * Formats duplicate resolution metadata.
 */
function formatDuplicateResolution(
  width,
  height
) {

  const parsedWidth =
    Number(
      width
    );


  const parsedHeight =
    Number(
      height
    );


  if (
    !Number.isFinite(
      parsedWidth
    ) ||
    !Number.isFinite(
      parsedHeight
    ) ||
    parsedWidth <= 0 ||
    parsedHeight <= 0
  ) {

    return "—";
  }


  return `${parsedWidth} × ${parsedHeight}`;
}


/**
 * Provides a conservative generic diagnostic display for any integrity
 * row whose schema does not need a specialised renderer.
 */
function renderGenericIntegrityMeta(
  row
) {

  const ignoredKeys =
    new Set(
      [
        "film",
        "title",
        "name"
      ]
    );


  const entries =
    Object.entries(
      row ||
      {}
    )
      .filter(
        (
          [
            key,
            value
          ]
        ) => {

          return (
            !ignoredKeys.has(
              key
            ) &&
            value !==
              undefined &&
            value !==
              null &&
            value !==
              ""
          );
        }
      );


  if (
    !entries.length
  ) {

    return "";
  }


  return `
    <div class="admin-integrity-result-meta">

      ${entries
        .map(
          (
            [
              key,
              value
            ]
          ) => {

            let display =
              value;


            if (
              Array.isArray(
                value
              )
            ) {

              display =
                value.join(
                  ", "
                );


            } else if (
              typeof value ===
                "object"
            ) {

              display =
                safeJson(
                  value
                );
            }


            return `
              <div>

                <strong>
                  ${escapeHtml(
                    humaniseStatus(
                      key
                    )
                  )}:
                </strong>

                <span>
                  ${escapeHtml(
                    display
                  )}
                </span>

              </div>
            `;
          }
        )
        .join(
          ""
        )}

    </div>
  `;
}


/* =====================================================================
   18. RECENT INGESTIONS
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
   19. INGESTION DETAILS TOGGLE
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
   20. INGESTION COMPONENT STATES
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
   21. STATUS BADGES
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
   22. COMPONENT STATE RENDERING
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
   23. DETAIL ITEMS
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
   24. TABLE ERROR
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
   25. PAGE STATUS
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
   26. REFRESH BUTTON STATE
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
   27. BASIC DOM HELPERS
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
   28. STRING NORMALISATION
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
   29. DATE / TIME FORMATTING
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
   30. FILESIZE FORMATTING
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
   31. GENERIC VALUE HELPERS
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
   32. URL / FILENAME HELPERS
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
   33. DIAGNOSTIC BOOLEAN HELPERS
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
   34. TEXT FALLBACK HELPERS
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
   35. OPTIONAL COPY HELPER
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
   36. ERROR NORMALISATION
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
   37. SAFE JSON DISPLAY
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
   38. SORTING HELPERS
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
   39. GENERIC EMPTY RESULT
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
   40. HTML ESCAPING
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
