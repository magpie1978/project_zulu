import {
  supabase
} from "../supabaseClient.js";


import {
  generateThumbnailCandidatesFromUrl,
  getSelectedThumbnailBlob,
  getSelectedThumbnailCandidate,
  selectPreviousThumbnailCandidate,
  selectNextThumbnailCandidate,
  resetThumbnailState,
  uploadThumbnailToBackblaze
} from "./thumbnails.js";


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


/* ---------------------------------------------------------------------
   VIDEO STORAGE HEALTH
--------------------------------------------------------------------- */

const videoHealthStatus =
  document.getElementById(
    "admin-video-health-status"
  );


const videoHealthCoverage =
  document.getElementById(
    "admin-video-health-coverage"
  );


const videoHealthCoverageTitle =
  document.getElementById(
    "admin-video-health-coverage-title"
  );


const videoHealthCoverageDetail =
  document.getElementById(
    "admin-video-health-coverage-detail"
  );


const videoHealthCatalogue =
  document.getElementById(
    "admin-video-health-catalogue"
  );


const videoHealthB2 =
  document.getElementById(
    "admin-video-health-b2"
  );


const videoHealthMatched =
  document.getElementById(
    "admin-video-health-matched"
  );


const videoHealthMissing =
  document.getElementById(
    "admin-video-health-missing"
  );


const videoHealthOrphaned =
  document.getElementById(
    "admin-video-health-orphaned"
  );


const videoHealthCaseMismatch =
  document.getElementById(
    "admin-video-health-case-mismatch"
  );


const videoHealthUrlError =
  document.getElementById(
    "admin-video-health-url-error"
  );


const videoHealthInvalid =
  document.getElementById(
    "admin-video-health-invalid"
  );


const videoHealthResults =
  document.getElementById(
    "admin-video-health-results"
  );


const videoHealthResultsTitle =
  document.getElementById(
    "admin-video-health-results-title"
  );


const videoHealthResultsBody =
  document.getElementById(
    "admin-video-health-results-body"
  );


const videoHealthResultsClose =
  document.getElementById(
    "admin-video-health-results-close"
  );


/* ---------------------------------------------------------------------
   THUMBNAIL HEALTH
--------------------------------------------------------------------- */

const thumbnailExpected =
  document.getElementById(
    "admin-thumbnail-expected"
  );


const thumbnailPresent =
  document.getElementById(
    "admin-thumbnail-present"
  );


const thumbnailMissing =
  document.getElementById(
    "admin-thumbnail-missing"
  );


const thumbnailOrphaned =
  document.getElementById(
    "admin-thumbnail-orphaned"
  );


const thumbnailInvalid =
  document.getElementById(
    "admin-thumbnail-invalid"
  );


const thumbnailStatus =
  document.getElementById(
    "admin-thumbnail-status"
  );


const thumbnailResults =
  document.getElementById(
    "admin-thumbnail-results"
  );


const thumbnailResultsTitle =
  document.getElementById(
    "admin-thumbnail-results-title"
  );


const thumbnailResultsBody =
  document.getElementById(
    "admin-thumbnail-results-body"
  );


const thumbnailResultsClose =
  document.getElementById(
    "admin-thumbnail-results-close"
  );


/* =====================================================================
   02. DASHBOARD STATE
===================================================================== */

/*
 * Latest Catalogue Integrity snapshot.
 */
let currentIntegrityData =
  null;


/*
 * Latest Video Storage Health snapshot.
 */
let currentVideoHealthData =
  null;


/*
 * Latest Thumbnail Health snapshot.
 */
let currentThumbnailData =
  null;


/*
 * UID currently undergoing Stage 10.1 thumbnail repair.
 *
 * thumbnails.js maintains shared thumbnail-candidate state. Only one
 * repair may therefore run at once.
 */
let repairingThumbnailUid =
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

  document
    .querySelectorAll(
      ".admin-video-health-card-action"
    )
    .forEach(
      card => {

        card.addEventListener(
          "click",
          () =>
            openVideoHealthResult(
              card.dataset.videoHealthKey
            )
        );
      }
    );


  videoHealthResultsClose?.addEventListener(
    "click",
    closeVideoHealthResults
  );


  /* -------------------------------------------------------------------
     THUMBNAIL HEALTH
  ------------------------------------------------------------------- */

  document
    .querySelectorAll(
      ".admin-thumbnail-card-action"
    )
    .forEach(
      card => {

        card.addEventListener(
          "click",
          () =>
            openThumbnailResult(
              card.dataset.thumbnailKey
            )
        );
      }
    );


  thumbnailResultsClose?.addEventListener(
    "click",
    closeThumbnailResults
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
   07. VIDEO STORAGE HEALTH REQUEST
===================================================================== */

/**
 * Retrieves the catalogue ↔ Backblaze MP4 reconciliation from the
 * protected zulu-video-health Edge Function.
 */
async function loadVideoHealth() {

  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "zulu-video-health",
      {
        body: {}
      }
    );


  if (
    error
  ) {

    throw new Error(
      `Could not load Video Storage Health: ${
        error.message ||
        "Edge Function request failed"
      }`
    );
  }


  if (
    !data
  ) {

    throw new Error(
      "Video Storage Health returned no data."
    );
  }


  if (
    data.success !== true
  ) {

    throw new Error(
      data.error ||
      "The Video Storage Health request was unsuccessful."
    );
  }


  if (
    !data.summary ||
    !data.missing ||
    !data.orphaned ||
    !data.case_mismatch ||
    !data.url_filename_error ||
    !data.invalid
  ) {

    throw new Error(
      "Video Storage Health returned an invalid response."
    );
  }


  return data;
}


/* =====================================================================
   08. THUMBNAIL HEALTH REQUEST
===================================================================== */

/**
 * Retrieves the actual thumbnail inventory from Backblaze through the
 * protected zulu-thumbnail-health Edge Function.
 *
 * The browser receives reconciliation results only.
 *
 * It never receives Backblaze credentials or direct B2 API tokens.
 */
async function loadThumbnailHealth() {

  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "zulu-thumbnail-health",
      {
        body: {}
      }
    );


  if (
    error
  ) {

    throw new Error(
      `Could not load Thumbnail Health: ${
        error.message ||
        "Edge Function request failed"
      }`
    );
  }


  if (
    !data
  ) {

    throw new Error(
      "Thumbnail Health returned no data."
    );
  }


  if (
    data.success !== true
  ) {

    throw new Error(
      data.error ||
      "The Thumbnail Health request was unsuccessful."
    );
  }


  if (
    !data.summary ||
    !data.missing ||
    !data.orphaned ||
    !data.invalid
  ) {

    throw new Error(
      "Thumbnail Health returned an invalid response."
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
   11. VIDEO STORAGE HEALTH
===================================================================== */

/**
 * Stores and renders the latest catalogue ↔ Backblaze MP4
 * reconciliation.
 */
function renderVideoHealth(
  data
) {

  currentVideoHealthData =
    data;


  const summary =
    data.summary ||
    {};


  const catalogueCount =
    Number(
      summary.catalogue_videos ||
      0
    );


  const b2Count =
    Number(
      summary.b2_videos ||
      0
    );


  const matched =
    Number(
      summary.matched ||
      0
    );


  const physicallyPresent =
    Number(
      summary.physically_present ??
      matched
    );


  const missing =
    Number(
      summary.missing ||
      0
    );


  const orphaned =
    Number(
      summary.orphaned ||
      0
    );


  const caseMismatch =
    Number(
      summary.case_mismatch ||
      0
    );


  const urlError =
    Number(
      summary.url_filename_error ||
      0
    );


  const invalid =
    Number(
      summary.invalid ||
      0
    );


  const coverage =
    Number.isFinite(
      Number(
        summary.coverage_percent
      )
    )
      ? Number(
          summary.coverage_percent
        )
      : catalogueCount > 0
        ? (
            physicallyPresent /
            catalogueCount
          ) * 100
        : 0;


  /* -------------------------------------------------------------------
     COUNTERS
  ------------------------------------------------------------------- */

  setNumber(
    videoHealthCatalogue,
    catalogueCount
  );


  setNumber(
    videoHealthB2,
    b2Count
  );


  setNumber(
    videoHealthMatched,
    matched
  );


  setNumber(
    videoHealthMissing,
    missing
  );


  setNumber(
    videoHealthOrphaned,
    orphaned
  );


  setNumber(
    videoHealthCaseMismatch,
    caseMismatch
  );


  setNumber(
    videoHealthUrlError,
    urlError
  );


  setNumber(
    videoHealthInvalid,
    invalid
  );


  /* -------------------------------------------------------------------
     STATIC CARD STATES
  ------------------------------------------------------------------- */

  setVideoHealthStaticCardState(
    videoHealthCatalogue,
    "healthy"
  );


  setVideoHealthStaticCardState(
    videoHealthB2,
    "healthy"
  );


  setVideoHealthStaticCardState(
    videoHealthMatched,
    matched === catalogueCount
      ? "healthy"
      : "warning"
  );


  /* -------------------------------------------------------------------
     DIAGNOSTIC CARD STATES
  ------------------------------------------------------------------- */

  setVideoHealthCardState(
    "missing",
    missing === 0
      ? "healthy"
      : "problem"
  );


  setVideoHealthCardState(
    "orphaned",
    orphaned === 0
      ? "healthy"
      : "warning"
  );


  setVideoHealthCardState(
    "case_mismatch",
    caseMismatch === 0
      ? "healthy"
      : "warning"
  );


  setVideoHealthCardState(
    "url_filename_error",
    urlError === 0
      ? "healthy"
      : "problem"
  );


  setVideoHealthCardState(
    "invalid",
    invalid === 0
      ? "healthy"
      : "warning"
  );


  /* -------------------------------------------------------------------
     COVERAGE
  ------------------------------------------------------------------- */

  const completelyHealthy =
    catalogueCount > 0 &&
    physicallyPresent ===
      catalogueCount &&
    missing === 0 &&
    orphaned === 0 &&
    caseMismatch === 0 &&
    urlError === 0 &&
    invalid === 0;


  if (
    videoHealthCoverage
  ) {

    videoHealthCoverage.classList.remove(
      "is-loading",
      "is-error",
      "is-healthy",
      "is-warning",
      "is-problem"
    );


    videoHealthCoverage.classList.add(
      completelyHealthy
        ? "is-healthy"
        : missing > 0 ||
          urlError > 0
          ? "is-problem"
          : "is-warning"
    );
  }


  if (
    videoHealthCoverageTitle
  ) {

    videoHealthCoverageTitle.textContent =
      `${coverage.toFixed(
        1
      )}% storage coverage`;
  }


  if (
    videoHealthCoverageDetail
  ) {

    videoHealthCoverageDetail.textContent =
      `${physicallyPresent.toLocaleString()} of ${catalogueCount.toLocaleString()} catalogue videos are physically present in Backblaze.`;
  }


  /* -------------------------------------------------------------------
     CHECKED TIME
  ------------------------------------------------------------------- */

  if (
    videoHealthStatus
  ) {

    const generatedAt =
      data.generated_at
        ? new Date(
            data.generated_at
          )
        : new Date();


    videoHealthStatus.textContent =
      `Checked ${generatedAt.toLocaleTimeString(
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


  /*
   * If a diagnostic result was open before Refresh, close it because
   * the underlying reconciliation snapshot has changed.
   */
  closeVideoHealthResults();


  window.lucide?.createIcons();
}


/**
 * Applies a loading state to the complete Video Storage Health section.
 */
function setVideoHealthLoadingState() {

  currentVideoHealthData =
    null;


  if (
    videoHealthStatus
  ) {

    videoHealthStatus.textContent =
      "Checking Backblaze video storage…";
  }


  if (
    videoHealthCoverageTitle
  ) {

    videoHealthCoverageTitle.textContent =
      "Checking storage coverage…";
  }


  if (
    videoHealthCoverageDetail
  ) {

    videoHealthCoverageDetail.textContent =
      "Reconciling catalogue videos with Backblaze MP4 objects.";
  }


  const elements = [
    videoHealthCoverage,
    videoHealthCatalogue,
    videoHealthB2,
    videoHealthMatched,
    videoHealthMissing,
    videoHealthOrphaned,
    videoHealthCaseMismatch,
    videoHealthUrlError,
    videoHealthInvalid
  ];


  for (
    const element of elements
  ) {

    const card =
      element?.closest(
        ".admin-video-health-card"
      ) ||
      element;


    card?.classList.remove(
      "is-error",
      "is-healthy",
      "is-warning",
      "is-problem"
    );


    card?.classList.add(
      "is-loading"
    );
  }


  setText(
    videoHealthCatalogue,
    "—"
  );


  setText(
    videoHealthB2,
    "—"
  );


  setText(
    videoHealthMatched,
    "—"
  );


  setText(
    videoHealthMissing,
    "—"
  );


  setText(
    videoHealthOrphaned,
    "—"
  );


  setText(
    videoHealthCaseMismatch,
    "—"
  );


  setText(
    videoHealthUrlError,
    "—"
  );


  setText(
    videoHealthInvalid,
    "—"
  );


  closeVideoHealthResults();
}


/**
 * Displays an independent Video Storage Health failure.
 */
function renderVideoHealthError(
  error
) {

  currentVideoHealthData =
    null;


  if (
    videoHealthStatus
  ) {

    videoHealthStatus.textContent =
      `Video Storage Health unavailable: ${
        error?.message ||
        "Unknown error"
      }`;
  }


  if (
    videoHealthCoverageTitle
  ) {

    videoHealthCoverageTitle.textContent =
      "Storage health unavailable";
  }


  if (
    videoHealthCoverageDetail
  ) {

    videoHealthCoverageDetail.textContent =
      "The Backblaze video inventory could not be reconciled.";
  }


  const elements = [
    videoHealthCoverage,
    videoHealthCatalogue,
    videoHealthB2,
    videoHealthMatched,
    videoHealthMissing,
    videoHealthOrphaned,
    videoHealthCaseMismatch,
    videoHealthUrlError,
    videoHealthInvalid
  ];


  for (
    const element of elements
  ) {

    const card =
      element?.closest(
        ".admin-video-health-card"
      ) ||
      element;


    card?.classList.remove(
      "is-loading",
      "is-healthy",
      "is-warning",
      "is-problem"
    );


    card?.classList.add(
      "is-error"
    );
  }


  setText(
    videoHealthCatalogue,
    "—"
  );


  setText(
    videoHealthB2,
    "—"
  );


  setText(
    videoHealthMatched,
    "—"
  );


  setText(
    videoHealthMissing,
    "—"
  );


  setText(
    videoHealthOrphaned,
    "—"
  );


  setText(
    videoHealthCaseMismatch,
    "—"
  );


  setText(
    videoHealthUrlError,
    "—"
  );


  setText(
    videoHealthInvalid,
    "—"
  );


  closeVideoHealthResults();
}


/**
 * Applies a health state to one clickable Video Storage Health card.
 */
function setVideoHealthCardState(
  key,
  state
) {

  const card =
    document.querySelector(
      `[data-video-health-key="${key}"]`
    );


  if (
    !card
  ) {

    return;
  }


  card.classList.remove(
    "is-loading",
    "is-error",
    "is-healthy",
    "is-warning",
    "is-problem"
  );


  card.classList.add(
    `is-${state}`
  );
}


/**
 * Applies a health state to one informational Video Storage Health card.
 */
function setVideoHealthStaticCardState(
  element,
  state
) {

  const card =
    element?.closest(
      ".admin-video-health-card"
    );


  if (
    !card
  ) {

    return;
  }


  card.classList.remove(
    "is-loading",
    "is-error",
    "is-healthy",
    "is-warning",
    "is-problem"
  );


  card.classList.add(
    `is-${state}`
  );
}


/* =====================================================================
   12. VIDEO STORAGE HEALTH INTERACTION
===================================================================== */

/**
 * Opens one detailed Video Storage Health diagnostic collection.
 */
function openVideoHealthResult(
  key
) {

  if (
    !key ||
    !currentVideoHealthData
  ) {

    return;
  }


  const result =
    currentVideoHealthData[
      key
    ];


  if (
    !result
  ) {

    return;
  }


  document
    .querySelectorAll(
      ".admin-video-health-card-action"
    )
    .forEach(
      card => {

        card.classList.toggle(
          "is-selected",
          card.dataset.videoHealthKey ===
            key
        );
      }
    );


  const titles = {
    missing:
      "Missing Videos",

    orphaned:
      "Orphaned Videos",

    case_mismatch:
      "Filename Case Mismatches",

    url_filename_error:
      "URL / Filename Errors",

    invalid:
      "Invalid Storage Objects"
  };


  if (
    videoHealthResultsTitle
  ) {

    videoHealthResultsTitle.textContent =
      titles[key] ||
      "Video Storage Health";
  }


  if (
    videoHealthResultsBody
  ) {

    videoHealthResultsBody.innerHTML =
      renderVideoHealthRows(
        key,
        result.rows ||
        []
      );
  }


  if (
    videoHealthResults
  ) {

    videoHealthResults.hidden =
      false;
  }


  window.lucide?.createIcons();
}


/**
 * Closes the Video Storage Health result panel.
 */
function closeVideoHealthResults() {

  if (
    videoHealthResults
  ) {

    videoHealthResults.hidden =
      true;
  }


  document
    .querySelectorAll(
      ".admin-video-health-card-action"
    )
    .forEach(
      card => {

        card.classList.remove(
          "is-selected"
        );
      }
    );
}


/**
 * Converts a Video Storage Health collection to HTML.
 */
function renderVideoHealthRows(
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
      <div class="admin-video-health-empty">
        ✓ No issues found.
      </div>
    `;
  }


  return rows
    .map(
      row =>
        renderVideoHealthRow(
          key,
          row
        )
    )
    .join(
      ""
    );
}


/**
 * Renders one Video Storage Health diagnostic row.
 *
 * Several alternative property names are supported intentionally. This
 * keeps the Admin UI tolerant of diagnostic-field naming differences
 * while the zulu-video-health function evolves.
 */
function renderVideoHealthRow(
  key,
  row
) {

  const catalogueFilename =
    row.catalogue_filename ??
    row.catalogue_file ??
    row.expected_file ??
    null;


  const b2Filename =
    row.b2_file_name ??
    row.b2_file ??
    row.file_name ??
    null;


  const film =
    row.film ||
    (
      key === "orphaned"
        ? "Orphaned Backblaze video"
        : key === "invalid"
          ? "Invalid storage object"
          : "Untitled"
    );


  const uid =
    row.uid ??
    null;


  const meta = [];


  if (
    catalogueFilename
  ) {

    meta.push(
      `
        <div>
          <strong>Catalogue filename:</strong>
          <span class="admin-video-health-file">
            ${escapeHtml(
              catalogueFilename
            )}
          </span>
        </div>
      `
    );
  }


  if (
    b2Filename &&
    b2Filename !==
      catalogueFilename
  ) {

    meta.push(
      `
        <div>
          <strong>Backblaze filename:</strong>
          <span class="admin-video-health-file">
            ${escapeHtml(
              b2Filename
            )}
          </span>
        </div>
      `
    );
  }


  if (
    row.url
  ) {

    meta.push(
      `
        <div>
          <strong>URL:</strong>
          <span class="admin-video-health-file">
            ${escapeHtml(
              row.url
            )}
          </span>
        </div>
      `
    );
  }


  if (
    row.reason
  ) {

    meta.push(
      `
        <div>
          <strong>Reason:</strong>
          ${escapeHtml(
            row.reason
          )}
        </div>
      `
    );
  }


  if (
    row.size_bytes !==
      undefined &&
    row.size_bytes !==
      null
  ) {

    meta.push(
      `
        <div>
          <strong>Size:</strong>
          ${escapeHtml(
            formatBytes(
              row.size_bytes
            )
          )}
        </div>
      `
    );
  }


  if (
    row.uploaded_at
  ) {

    meta.push(
      `
        <div>
          <strong>Uploaded:</strong>
          ${escapeHtml(
            formatDateTime(
              row.uploaded_at
            )
          )}
        </div>
      `
    );
  }


  return `
    <div class="admin-video-health-result">

      <div class="admin-video-health-result-title">

        ${
          uid !== null
            ? `
                <span class="admin-video-health-result-uid">
                  UID ${escapeHtml(
                    uid
                  )}
                </span>
              `
            : ""
        }

        <span class="admin-video-health-result-film">
          ${escapeHtml(
            film
          )}
        </span>

      </div>

      ${
        meta.length
          ? `
              <div class="admin-video-health-result-meta">
                ${meta.join("")}
              </div>
            `
          : ""
      }

    </div>
  `;
}

/* =====================================================================
   13. THUMBNAIL HEALTH
===================================================================== */

/**
 * Stores and renders the latest Backblaze thumbnail reconciliation.
 *
 * Expected:
 *     Number of catalogue videos requiring images/{uid}.png.
 *
 * Present:
 *     Catalogue UIDs whose expected thumbnail exists in B2.
 *
 * Missing:
 *     Catalogue UIDs with no corresponding B2 thumbnail.
 *
 * Orphaned:
 *     Numeric thumbnail objects whose UID does not exist in zulu_videos.
 *
 * Invalid:
 *     Objects under images/ that do not follow images/{uid}.png.
 */
function renderThumbnailHealth(
  data
) {

  currentThumbnailData =
    data;


  const summary =
    data.summary ||
    {};


  setNumber(
    thumbnailExpected,
    summary.expected
  );


  setNumber(
    thumbnailPresent,
    summary.present
  );


  setNumber(
    thumbnailMissing,
    summary.missing
  );


  setNumber(
    thumbnailOrphaned,
    summary.orphaned
  );


  setNumber(
    thumbnailInvalid,
    summary.invalid
  );


  /* -------------------------------------------------------------------
     DIAGNOSTIC CARD STATES
  ------------------------------------------------------------------- */

  setThumbnailCardState(
    "missing",
    Number(
      summary.missing ||
      0
    ) === 0
      ? "healthy"
      : "problem"
  );


  setThumbnailCardState(
    "orphaned",
    Number(
      summary.orphaned ||
      0
    ) === 0
      ? "healthy"
      : "warning"
  );


  setThumbnailCardState(
    "invalid",
    Number(
      summary.invalid ||
      0
    ) === 0
      ? "healthy"
      : "warning"
  );


  /* -------------------------------------------------------------------
     EXPECTED CARD
  ------------------------------------------------------------------- */

  const expectedCard =
    thumbnailExpected?.closest(
      ".admin-thumbnail-card"
    );


  expectedCard?.classList.remove(
    "is-loading",
    "is-error",
    "is-healthy",
    "is-warning",
    "is-problem"
  );


  /* -------------------------------------------------------------------
     PRESENT CARD
  ------------------------------------------------------------------- */

  const presentCard =
    thumbnailPresent?.closest(
      ".admin-thumbnail-card"
    );


  presentCard?.classList.remove(
    "is-loading",
    "is-error",
    "is-healthy",
    "is-warning",
    "is-problem"
  );


  if (
    presentCard
  ) {

    const expected =
      Number(
        summary.expected ||
        0
      );


    const present =
      Number(
        summary.present ||
        0
      );


    if (
      expected > 0 &&
      present === expected
    ) {

      presentCard.classList.add(
        "is-healthy"
      );


    } else if (
      present > 0
    ) {

      presentCard.classList.add(
        "is-warning"
      );
    }
  }


  /* -------------------------------------------------------------------
     STATUS / COVERAGE
  ------------------------------------------------------------------- */

  if (
    thumbnailStatus
  ) {

    const generatedAt =
      data.generated_at
        ? new Date(
            data.generated_at
          )
        : new Date();


    const expected =
      Number(
        summary.expected ||
        0
      );


    const present =
      Number(
        summary.present ||
        0
      );


    const percentage =
      expected > 0
        ? (
            (
              present /
              expected
            ) *
            100
          ).toFixed(
            1
          )
        : "0.0";


    thumbnailStatus.textContent =
      `${percentage}% coverage · Checked ${
        generatedAt.toLocaleTimeString(
          [],
          {
            hour:
              "2-digit",

            minute:
              "2-digit",

            second:
              "2-digit"
          }
        )
      }`;
  }


  /*
   * The health snapshot has changed, so close any old diagnostic panel.
   *
   * Stage 10.1 explicitly reopens Missing after a successful repair.
   */
  closeThumbnailResults();


  window.lucide?.createIcons();
}


/**
 * Applies the loading state while zulu-thumbnail-health is running.
 */
function setThumbnailLoadingState() {

  currentThumbnailData =
    null;


  if (
    thumbnailStatus
  ) {

    thumbnailStatus.textContent =
      "Checking Backblaze…";
  }


  setText(
    thumbnailExpected,
    "—"
  );


  setText(
    thumbnailPresent,
    "—"
  );


  setText(
    thumbnailMissing,
    "—"
  );


  setText(
    thumbnailOrphaned,
    "—"
  );


  setText(
    thumbnailInvalid,
    "—"
  );


  document
    .querySelectorAll(
      ".admin-thumbnail-card"
    )
    .forEach(
      card => {

        card.classList.remove(
          "is-error",
          "is-healthy",
          "is-warning",
          "is-problem",
          "is-selected"
        );


        card.classList.add(
          "is-loading"
        );
      }
    );


  closeThumbnailResults();
}


/**
 * Displays an independent Thumbnail Health failure.
 */
function renderThumbnailHealthError(
  error
) {

  currentThumbnailData =
    null;


  if (
    thumbnailStatus
  ) {

    thumbnailStatus.textContent =
      `Thumbnail Health unavailable: ${
        error?.message ||
        "Unknown error"
      }`;
  }


  setText(
    thumbnailExpected,
    "—"
  );


  setText(
    thumbnailPresent,
    "—"
  );


  setText(
    thumbnailMissing,
    "—"
  );


  setText(
    thumbnailOrphaned,
    "—"
  );


  setText(
    thumbnailInvalid,
    "—"
  );


  document
    .querySelectorAll(
      ".admin-thumbnail-card"
    )
    .forEach(
      card => {

        card.classList.remove(
          "is-loading",
          "is-healthy",
          "is-warning",
          "is-problem",
          "is-selected"
        );


        card.classList.add(
          "is-error"
        );
      }
    );


  closeThumbnailResults();
}


/**
 * Applies a health state to one clickable Thumbnail Health card.
 */
function setThumbnailCardState(
  key,
  state
) {

  const card =
    document.querySelector(
      `[data-thumbnail-key="${key}"]`
    );


  if (
    !card
  ) {

    return;
  }


  card.classList.remove(
    "is-loading",
    "is-error",
    "is-healthy",
    "is-warning",
    "is-problem"
  );


  card.classList.add(
    `is-${state}`
  );
}


/* =====================================================================
   14. THUMBNAIL HEALTH INTERACTION
===================================================================== */

/**
 * Opens one detailed Thumbnail Health diagnostic collection.
 */
function openThumbnailResult(
  key
) {

  if (
    !key ||
    !currentThumbnailData
  ) {

    return;
  }


  const result =
    currentThumbnailData[
      key
    ];


  if (
    !result
  ) {

    return;
  }


  document
    .querySelectorAll(
      ".admin-thumbnail-card-action"
    )
    .forEach(
      card => {

        card.classList.toggle(
          "is-selected",
          card.dataset.thumbnailKey ===
            key
        );
      }
    );


  const titles = {
    missing:
      "Missing Thumbnails",

    orphaned:
      "Orphaned Thumbnails",

    invalid:
      "Invalid Thumbnail Objects"
  };


  if (
    thumbnailResultsTitle
  ) {

    thumbnailResultsTitle.textContent =
      titles[key] ||
      "Thumbnail Health";
  }


  if (
    thumbnailResultsBody
  ) {

    thumbnailResultsBody.innerHTML =
      renderThumbnailRows(
        key,
        result.rows ||
        []
      );
  }


  if (
    thumbnailResults
  ) {

    thumbnailResults.hidden =
      false;
  }


  /*
   * Stage 10.1 repair buttons are dynamically created when the Missing
   * diagnostic panel is rendered.
   */
    attachThumbnailRepairEvents();
    attachThumbnailDeleteEvents();
    
    
    window.lucide?.createIcons();
}


/**
 * Closes the Thumbnail Health diagnostic panel.
 */
function closeThumbnailResults() {

  if (
    thumbnailResults
  ) {

    thumbnailResults.hidden =
      true;
  }


  document
    .querySelectorAll(
      ".admin-thumbnail-card-action"
    )
    .forEach(
      card => {

        card.classList.remove(
          "is-selected"
        );
      }
    );
}


/**
 * Converts a Thumbnail Health diagnostic collection to HTML.
 */
function renderThumbnailRows(
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
      <div class="admin-thumbnail-empty">
        ✓ No issues found.
      </div>
    `;
  }


  switch (
    key
  ) {

    case "missing":

      return rows
        .map(
          item =>
            renderMissingThumbnail(
              item
            )
        )
        .join(
          ""
        );


    case "orphaned":

      return rows
        .map(
          item =>
            renderOrphanedThumbnail(
              item
            )
        )
        .join(
          ""
        );


    case "invalid":

      return rows
        .map(
          item =>
            renderInvalidThumbnail(
              item
            )
        )
        .join(
          ""
        );


    default:

      return `
        <div class="admin-thumbnail-empty">
          No diagnostic renderer is available.
        </div>
      `;
  }
}


/**
 * Renders one catalogue video whose expected thumbnail does not exist
 * in Backblaze.
 *
 * Stage 10.1 adds a controlled repair action here.
 *
 * The catalogue row itself is not changed.
 *
 * Repair:
 *
 *     1. signs the existing MP4 URL
 *     2. generates a thumbnail from the existing video
 *     3. uploads images/{uid}.png
 *     4. reruns Thumbnail Health
 */
function renderMissingThumbnail(
  item
) {

  const uid =
    item.uid;


  const hasVideoUrl =
    Boolean(
      item.url
    );


  return `
    <div
      class="admin-thumbnail-result"
      data-thumbnail-repair-row="${escapeHtml(
        uid
      )}"
    >

      <div class="admin-thumbnail-result-main">

        <div class="admin-thumbnail-result-title">

          <span class="admin-thumbnail-result-uid">
            UID ${escapeHtml(
              uid
            )}
          </span>

          <span class="admin-thumbnail-result-film">
            ${escapeHtml(
              item.film ||
              "Untitled"
            )}
          </span>

        </div>


        <div class="admin-thumbnail-result-meta">

          <div>

            <strong>
              Expected:
            </strong>

            <span class="admin-thumbnail-file">
              ${escapeHtml(
                item.expected_file ||
                `images/${uid}.png`
              )}
            </span>

          </div>


          ${
            !hasVideoUrl
              ? `
                  <div class="admin-thumbnail-repair-warning">
                    Catalogue video URL is unavailable.
                  </div>
                `
              : ""
          }

        </div>

      </div>


      <div class="admin-thumbnail-repair-actions">

        <button
          type="button"
          class="admin-thumbnail-repair-button"
          data-thumbnail-repair-uid="${escapeHtml(
            uid
          )}"
          ${hasVideoUrl ? "" : "disabled"}
        >

          <i data-lucide="wand-sparkles"></i>

          <span>
            Repair Thumbnail
          </span>

        </button>

      </div>


      <div
        class="admin-thumbnail-repair-status"
        data-thumbnail-repair-status="${escapeHtml(
          uid
        )}"
        hidden
      ></div>

    </div>
  `;
}


/**
 * Renders one Backblaze thumbnail whose numeric UID no longer exists
 * in the catalogue.
 *
 * Stage 10.1 remains read-only for orphaned objects. Deletion belongs to
 * the later storage-cleanup stage.
 */
/**
 * Renders one Backblaze thumbnail whose numeric UID no longer exists
 * in zulu_videos.
 *
 * The Delete Orphan action does NOT delete directly from the browser.
 *
 * Instead:
 *
 *   1. Admin sends UID + filename + exact B2 file ID
 *   2. zulu-thumbnail-health rechecks zulu_videos
 *   3. the Edge Function deletes the exact B2 file version
 *   4. Admin reruns Thumbnail Health
 */
function renderOrphanedThumbnail(
  item
) {

  const uid =
    Number(
      item.uid
    );


  const fileName =
    item.file_name ||
    "";


  const fileId =
    item.file_id ||
    "";


  const canDelete =
    Number.isInteger(
      uid
    ) &&
    uid > 0 &&
    Boolean(
      fileName
    ) &&
    Boolean(
      fileId
    );


  return `
    <div
      class="admin-thumbnail-result"
      data-thumbnail-orphan-row="${escapeHtml(
        uid
      )}"
    >

      <div class="admin-thumbnail-result-main">

        <div class="admin-thumbnail-result-title">

          <span class="admin-thumbnail-result-uid">
            UID ${escapeHtml(
              uid
            )}
          </span>

          <span class="admin-thumbnail-result-film">
            Orphaned thumbnail
          </span>

        </div>


        <div class="admin-thumbnail-result-meta">

          <div>
            <strong>
              File:
            </strong>

            <span class="admin-thumbnail-file">
              ${escapeHtml(
                fileName
              )}
            </span>
          </div>


          <div>
            <strong>
              Size:
            </strong>

            ${escapeHtml(
              formatBytes(
                item.size_bytes
              )
            )}
          </div>


          <div>
            <strong>
              Uploaded:
            </strong>

            ${escapeHtml(
              formatDateTime(
                item.uploaded_at
              )
            )}
          </div>


          <div>
            <strong>
              B2 file ID:
            </strong>

            <span class="admin-thumbnail-file">
              ${escapeHtml(
                fileId
              )}
            </span>
          </div>

        </div>

      </div>


      <div class="admin-thumbnail-repair-actions">

        <button
          type="button"
          class="admin-thumbnail-delete-button"
          data-thumbnail-delete-uid="${escapeHtml(
            uid
          )}"
          ${canDelete ? "" : "disabled"}
        >

          <i data-lucide="trash-2"></i>

          <span>
            Delete Orphan
          </span>

        </button>

      </div>


      <div
        class="admin-thumbnail-repair-status"
        data-thumbnail-delete-status="${escapeHtml(
          uid
        )}"
        hidden
      ></div>

    </div>
  `;
}


/**
 * Renders one object under images/ that does not match
 * images/{uid}.png.
 */
function renderInvalidThumbnail(
  item
) {

  return `
    <div class="admin-thumbnail-result">

      <div class="admin-thumbnail-result-title">

        <span class="admin-thumbnail-result-film">
          Invalid thumbnail object
        </span>

      </div>


      <div class="admin-thumbnail-result-meta">

        <div>

          <strong>
            File:
          </strong>

          <span class="admin-thumbnail-file">
            ${escapeHtml(
              item.file_name ||
              ""
            )}
          </span>

        </div>


        <div>

          <strong>
            Size:
          </strong>

          ${escapeHtml(
            formatBytes(
              item.size_bytes
            )
          )}

        </div>


        <div>

          <strong>
            Uploaded:
          </strong>

          ${escapeHtml(
            formatDateTime(
              item.uploaded_at
            )
          )}

        </div>


        ${
          item.file_id
            ? `
                <div>

                  <strong>
                    B2 file ID:
                  </strong>

                  <span class="admin-thumbnail-file">
                    ${escapeHtml(
                      item.file_id
                    )}
                  </span>

                </div>
              `
            : ""
        }

      </div>

    </div>
  `;
}


/* =====================================================================
   15. MISSING THUMBNAIL REPAIR — STAGE 10.1
===================================================================== */

/**
 * Attaches repair handlers to the currently-rendered Missing Thumbnail
 * rows.
 *
 * Buttons are recreated whenever the diagnostic panel is rendered, so
 * listeners are deliberately attached after each render.
 */
function attachThumbnailRepairEvents() {

  document
    .querySelectorAll(
      ".admin-thumbnail-repair-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const uid =
              button.dataset
                .thumbnailRepairUid;


            if (
              uid
            ) {

              repairMissingThumbnail(
                uid
              );
            }
          }
        );
      }
    );
}


/**
 * Repairs one missing thumbnail using the catalogue MP4 that already
 * exists in Backblaze.
 *
 * IMPORTANT:
 *
 * This does not:
 *
 *     • upload another MP4
 *     • modify zulu_videos
 *     • create an ingestion
 *     • delete any B2 object
 *
 * It creates only the missing images/{uid}.png object.
 */

/**
 * Builds the manual thumbnail-selection interface used during a repair.
 *
 * Nothing is uploaded at this point. The user must explicitly press
 * Upload Thumbnail.
 */
function showThumbnailRepairCandidatePicker(
  uid
) {

  const row =
    document.querySelector(
      `[data-thumbnail-repair-row="${cssEscapeValue(
        uid
      )}"]`
    );


  if (!row) {

    throw new Error(
      "Could not find the thumbnail repair row."
    );
  }


  let picker =
    row.querySelector(
      ".admin-thumbnail-repair-picker"
    );


  if (!picker) {

    picker =
      document.createElement(
        "div"
      );


    picker.className =
      "admin-thumbnail-repair-picker";


    row.appendChild(
      picker
    );
  }


  picker.innerHTML =
    `
      <div class="admin-thumbnail-repair-preview-wrap">

        <img
          class="admin-thumbnail-repair-preview"
          data-thumbnail-repair-preview="${escapeHtml(
            uid
          )}"
          alt="Thumbnail candidate"
        >

      </div>


      <div class="admin-thumbnail-repair-navigation">

        <button
          type="button"
          class="admin-thumbnail-picker-button"
          data-thumbnail-repair-prev="${escapeHtml(
            uid
          )}"
        >
          <i data-lucide="chevron-left"></i>
          <span>Previous</span>
        </button>


        <div
          class="admin-thumbnail-repair-counter"
          data-thumbnail-repair-counter="${escapeHtml(
            uid
          )}"
        ></div>


        <button
          type="button"
          class="admin-thumbnail-picker-button"
          data-thumbnail-repair-next="${escapeHtml(
            uid
          )}"
        >
          <span>Next</span>
          <i data-lucide="chevron-right"></i>
        </button>

      </div>


      <div
        class="admin-thumbnail-repair-candidate-detail"
        data-thumbnail-repair-detail="${escapeHtml(
          uid
        )}"
      ></div>


      <div class="admin-thumbnail-repair-confirm-actions">

        <button
          type="button"
          class="admin-thumbnail-upload-selected"
          data-thumbnail-repair-upload="${escapeHtml(
            uid
          )}"
        >
          <i data-lucide="upload"></i>
          <span>Upload Thumbnail</span>
        </button>


        <button
          type="button"
          class="admin-thumbnail-cancel-selection"
          data-thumbnail-repair-cancel="${escapeHtml(
            uid
          )}"
        >
          Cancel
        </button>

      </div>
    `;


  const previousButton =
    picker.querySelector(
      `[data-thumbnail-repair-prev="${cssEscapeValue(
        uid
      )}"]`
    );


  const nextButton =
    picker.querySelector(
      `[data-thumbnail-repair-next="${cssEscapeValue(
        uid
      )}"]`
    );


  previousButton?.addEventListener(
    "click",
    () => {

      selectPreviousThumbnailCandidate();

      updateThumbnailRepairCandidatePreview(
        uid
      );
    }
  );


  nextButton?.addEventListener(
    "click",
    () => {

      selectNextThumbnailCandidate();

      updateThumbnailRepairCandidatePreview(
        uid
      );
    }
  );


  updateThumbnailRepairCandidatePreview(
    uid
  );


  window.lucide?.createIcons();
}


/**
 * Refreshes the Admin preview after Previous / Next changes the selected
 * candidate.
 */
function updateThumbnailRepairCandidatePreview(
  uid
) {

  const candidate =
    getSelectedThumbnailCandidate();


  if (!candidate) {

    return;
  }


  const preview =
    document.querySelector(
      `[data-thumbnail-repair-preview="${cssEscapeValue(
        uid
      )}"]`
    );


  const counter =
    document.querySelector(
      `[data-thumbnail-repair-counter="${cssEscapeValue(
        uid
      )}"]`
    );


  const detail =
    document.querySelector(
      `[data-thumbnail-repair-detail="${cssEscapeValue(
        uid
      )}"]`
    );


  if (preview) {

    /*
     * Revoke the Admin-specific preview URL whenever the candidate
     * changes.
     */
    if (
      preview.dataset.objectUrl
    ) {

      URL.revokeObjectURL(
        preview.dataset.objectUrl
      );
    }


    const objectUrl =
      URL.createObjectURL(
        candidate.blob
      );


    preview.dataset.objectUrl =
      objectUrl;


    preview.src =
      objectUrl;
  }


  if (counter) {

    counter.textContent =
      `${candidate.number} of ${candidate.count}`;
  }


  if (detail) {

    const seconds =
      Math.round(
        candidate.time
      );


    const faces =
      Number(
        candidate.faceCount ||
        0
      );


    if (
      faces >= 2
    ) {

      detail.textContent =
        `Suggested frame — ${faces} faces detected at ${seconds}s`;

    } else if (
      faces === 1
    ) {

      detail.textContent =
        `Alternative frame — 1 face detected at ${seconds}s`;

    } else {

      detail.textContent =
        `Fallback frame at ${seconds}s`;
    }
  }
}


/**
 * Waits for the user to either approve the currently displayed candidate
 * or cancel the repair.
 */
function waitForThumbnailRepairChoice(
  uid
) {

  return new Promise(
    resolve => {

      const uploadButton =
        document.querySelector(
          `[data-thumbnail-repair-upload="${cssEscapeValue(
            uid
          )}"]`
        );


      const cancelButton =
        document.querySelector(
          `[data-thumbnail-repair-cancel="${cssEscapeValue(
            uid
          )}"]`
        );


      uploadButton?.addEventListener(
        "click",
        () => {

          resolve(
            "upload"
          );
        },
        {
          once: true
        }
      );


      cancelButton?.addEventListener(
        "click",
        () => {

          resolve(
            "cancel"
          );
        },
        {
          once: true
        }
      );
    }
  );
}


async function repairMissingThumbnail(
  uid
) {

  /*
   * thumbnails.js maintains shared candidate state.
   *
   * Running two repairs simultaneously could cause one repair to upload
   * the candidate generated for another video.
   */
  if (
    repairingThumbnailUid !==
      null
  ) {

    return;
  }


  const missingRows =
    currentThumbnailData
      ?.missing
      ?.rows ||
    [];


  const item =
    missingRows.find(
      row =>
        String(
          row.uid
        ) ===
        String(
          uid
        )
    );


  if (
    !item
  ) {

    setStatus(
      `Could not find missing thumbnail record for UID ${uid}.`,
      "error"
    );


    return;
  }


  if (
    !item.url
  ) {

    setThumbnailRepairStatus(
      uid,
      "Catalogue video URL is unavailable.",
      "error"
    );


    return;
  }


  repairingThumbnailUid =
    String(
      uid
    );


  const button =
    document.querySelector(
      `[data-thumbnail-repair-uid="${cssEscapeValue(
        uid
      )}"]`
    );


  /*
   * Disable every repair button while this video is processed.
   */
  setAllThumbnailRepairButtonsDisabled(
    true
  );


  if (
    button
  ) {

    button.classList.remove(
      "is-error",
      "is-success"
    );


    button.classList.add(
      "is-working"
    );


    button.innerHTML =
      `
        <i data-lucide="loader-circle"></i>
        <span>Preparing…</span>
      `;
  }


  window.lucide?.createIcons();


  try {

    /* ===============================================================
       STEP 1 — SIGN EXISTING MP4
    =============================================================== */

    setThumbnailRepairStatus(
      uid,
      "Requesting secure video access…",
      "working"
    );


    setThumbnailRepairButtonText(
      button,
      "Signing video…"
    );


    const signedUrl =
      await getAdminSignedVideoUrl(
        item.url
      );


    /* ===============================================================
       STEP 2 — GENERATE THUMBNAIL
    =============================================================== */

    resetThumbnailState();


    setThumbnailRepairButtonText(
      button,
      "Analysing…"
    );


    const analysis =
      await generateThumbnailCandidatesFromUrl(
        signedUrl,
        {
          onStatus:
            message => {

              setThumbnailRepairStatus(
                uid,
                message,
                "working"
              );
            }
        }
      );


/* ===============================================================
   STEP 2B — LET USER CHOOSE THE FRAME
=============================================================== */

    showThumbnailRepairCandidatePicker(
      uid
    );
    
    
    setThumbnailRepairButtonText(
      button,
      "Choose Thumbnail"
    );
    
    
    setThumbnailRepairStatus(
      uid,
      "Choose a thumbnail, then press Upload Thumbnail.",
      "working"
    );
    
    
    const choice =
      await waitForThumbnailRepairChoice(
        uid
      );
    
    
    if (
      choice === "cancel"
    ) {
    
      setThumbnailRepairStatus(
        uid,
        "Thumbnail repair cancelled.",
        ""
      );
    
    
      if (
        button
      ) {
    
        button.classList.remove(
          "is-working",
          "is-error",
          "is-success"
        );
    
    
        button.innerHTML =
          `
            <i data-lucide="wand-sparkles"></i>
            <span>Repair Thumbnail</span>
          `;
      }
    
    
      window.lucide?.createIcons();
    
    
      return;
    }
    
    
    const thumbnailBlob =
      getSelectedThumbnailBlob();
    
    
    if (
      !thumbnailBlob
    ) {
    
      throw new Error(
        "No thumbnail candidate is selected."
      );
    }

    /* ===============================================================
       STEP 3 — UPLOAD images/{uid}.png
    =============================================================== */

    setThumbnailRepairButtonText(
      button,
      "Uploading…"
    );


    setThumbnailRepairStatus(
      uid,
      "Publishing repaired thumbnail to Backblaze…",
      "working"
    );


    await uploadThumbnailToBackblaze(
      item.uid,
      thumbnailBlob,
      {
        onStatus:
          message => {

            setThumbnailRepairStatus(
              uid,
              message,
              "working"
            );
          }
      }
    );


    /* ===============================================================
       STEP 4 — LOCAL SUCCESS STATE
    =============================================================== */

    if (
      button
    ) {

      button.classList.remove(
        "is-working",
        "is-error"
      );


      button.classList.add(
        "is-success"
      );


      button.innerHTML =
        `
          <i data-lucide="circle-check"></i>
          <span>Repaired</span>
        `;
    }


    window.lucide?.createIcons();


    const faceCount =
      Number(
        analysis?.faceCount ||
        0
      );


    const faceDescription =
      faceCount > 0
        ? ` Best frame contained ${faceCount} detected ${
            faceCount === 1
              ? "face"
              : "faces"
          }.`
        : "";


    setThumbnailRepairStatus(
      uid,
      `Thumbnail uploaded successfully.${faceDescription} Verifying…`,
      "success"
    );


    /* ===============================================================
       STEP 5 — VERIFY AGAINST BACKBLAZE
    =============================================================== */

    const refreshed =
      await loadThumbnailHealth();


    currentThumbnailData =
      refreshed;


    /*
     * Verify that the repaired UID genuinely disappeared from the
     * Missing collection.
     */
    const stillMissing =
      refreshed
        ?.missing
        ?.rows
        ?.some(
          row =>
            String(
              row.uid
            ) ===
            String(
              uid
            )
        );


    if (
      stillMissing
    ) {

      throw new Error(
        "The thumbnail upload completed, but Backblaze verification still reports the thumbnail as missing."
      );
    }


    renderThumbnailHealth(
      refreshed
    );


    /*
     * Re-open Missing after rendering the new snapshot.
     *
     * The successfully repaired UID will no longer appear in the list.
     */
    openThumbnailResult(
      "missing"
    );


    setStatus(
      `Thumbnail repaired for UID ${item.uid}.`,
      "success"
    );


  } catch (
    error
  ) {

    console.error(
      "THUMBNAIL REPAIR FAILED:",
      error
    );


    setThumbnailRepairStatus(
      uid,
      error?.message ||
      "Thumbnail repair failed.",
      "error"
    );


    if (
      button
    ) {

      button.classList.remove(
        "is-working",
        "is-success"
      );


      button.classList.add(
        "is-error"
      );


      button.innerHTML =
        `
          <i data-lucide="rotate-ccw"></i>
          <span>Retry Repair</span>
        `;


      button.disabled =
        false;
    }


    window.lucide?.createIcons();


    setStatus(
      `Could not repair thumbnail for UID ${uid}: ${
        error?.message ||
        "Unknown error"
      }`,
      "error"
    );


  } finally {

    /*
     * Always clear candidate state after the repair attempt.
     */
    resetThumbnailState();


    repairingThumbnailUid =
      null;


    /*
     * A successful repair normally rerenders the Missing panel and
     * removes this UID. If the repair failed, restore the remaining
     * repair buttons.
     */
    setAllThumbnailRepairButtonsDisabled(
      false
    );
  }
}


/**
 * Requests a temporary signed URL for an existing catalogue MP4.
 *
 * This uses the same zulu-sign-media contract as the main PornFlix
 * library:
 *
 *     { path: "/Filename.mp4" }
 *
 * and expects:
 *
 *     { url: "https://media....?expires=...&signature=..." }
 */
async function getAdminSignedVideoUrl(
  originalUrl
) {

  if (
    !originalUrl
  ) {

    throw new Error(
      "No catalogue video URL was supplied."
    );
  }


  let path;


  try {

    const parsedUrl =
      new URL(
        originalUrl
      );


    path =
      parsedUrl.pathname;


  } catch {

    path =
      originalUrl.startsWith(
        "/"
      )
        ? originalUrl
        : `/${originalUrl}`;
  }


  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "zulu-sign-media",
      {
        body: {
          path
        }
      }
    );


  if (
    error
  ) {

    throw new Error(
      `Could not sign video URL: ${
        error.message ||
        "Edge Function request failed"
      }`
    );
  }


  if (
    !data?.url
  ) {

    throw new Error(
      data?.error ||
      "Signing service did not return a video URL."
    );
  }


  return data.url;
}


/**
 * Updates the working label of one thumbnail repair button.
 */
function setThumbnailRepairButtonText(
  button,
  text
) {

  if (
    !button
  ) {

    return;
  }


  button.innerHTML =
    `
      <i data-lucide="loader-circle"></i>

      <span>
        ${escapeHtml(
          text
        )}
      </span>
    `;


  window.lucide?.createIcons();
}


/**
 * Displays progress, success or failure information beneath one
 * missing-thumbnail row.
 */
function setThumbnailRepairStatus(
  uid,
  message,
  state =
    "working"
) {

  const element =
    document.querySelector(
      `[data-thumbnail-repair-status="${cssEscapeValue(
        uid
      )}"]`
    );


  if (
    !element
  ) {

    return;
  }


  element.hidden =
    false;


  element.textContent =
    message;


  element.classList.remove(
    "is-working",
    "is-success",
    "is-error"
  );


  element.classList.add(
    `is-${state}`
  );
}


/**
 * Prevents two repairs from using thumbnails.js shared candidate state
 * simultaneously.
 */
function setAllThumbnailRepairButtonsDisabled(
  disabled
) {

  document
    .querySelectorAll(
      ".admin-thumbnail-repair-button"
    )
    .forEach(
      button => {

        const uid =
          button.dataset
            .thumbnailRepairUid;


        const item =
          currentThumbnailData
            ?.missing
            ?.rows
            ?.find(
              row =>
                String(
                  row.uid
                ) ===
                String(
                  uid
                )
            );


        /*
         * A row with no catalogue URL must remain disabled even after
         * another repair finishes.
         */
        button.disabled =
          disabled ||
          !item?.url;
      }
    );
}


/**
 * Escapes a value before using it inside a CSS attribute selector.
 */
function cssEscapeValue(
  value
) {

  const stringValue =
    String(
      value
    );


  if (
    window.CSS?.escape
  ) {

    return window.CSS.escape(
      stringValue
    );
  }


  return stringValue.replace(
    /["\\]/g,
    "\\$&"
  );
}



/* =====================================================================
   STAGE 10 — ORPHANED THUMBNAIL CLEANUP
===================================================================== */

/*
 * Only one orphan deletion may run at a time.
 */
let deletingThumbnailUid =
  null;


/**
 * Connects the dynamically-rendered Delete Orphan buttons.
 */
function attachThumbnailDeleteEvents() {

  document
    .querySelectorAll(
      ".admin-thumbnail-delete-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const uid =
              Number(
                button.dataset
                  .thumbnailDeleteUid
              );


            if (
              !Number.isInteger(
                uid
              ) ||
              uid <= 0
            ) {

              return;
            }


            deleteOrphanedThumbnail(
              uid,
              button
            );
          }
        );
      }
    );
}


/**
 * Deletes one orphaned thumbnail through the protected
 * zulu-thumbnail-health Edge Function.
 *
 * The browser does not possess B2 credentials.
 */
async function deleteOrphanedThumbnail(
  uid,
  button
) {

  /*
   * Prevent concurrent cleanup operations.
   */
  if (
    deletingThumbnailUid !==
      null
  ) {

    return;
  }


  /*
   * Retrieve the object from the latest server-generated health
   * snapshot rather than trusting information stored in the button.
   */
  const item =
    currentThumbnailData
      ?.orphaned
      ?.rows
      ?.find(
        row =>
          Number(
            row.uid
          ) ===
          Number(
            uid
          )
      );


  if (
    !item
  ) {

    setThumbnailDeleteStatus(
      uid,
      "This orphan is no longer present in the current health results.",
      "error"
    );


    return;
  }


  if (
    !item.file_name ||
    !item.file_id
  ) {

    setThumbnailDeleteStatus(
      uid,
      "This orphan does not contain enough Backblaze information to delete safely.",
      "error"
    );


    return;
  }


  /*
   * Every deletion requires explicit confirmation.
   *
   * There is intentionally no bulk-delete behaviour here.
   */
  const confirmed =
    window.confirm(
      `Delete orphaned thumbnail?\n\n` +
      `${item.file_name}\n\n` +
      `UID ${uid} does not exist in the current catalogue health check.\n\n` +
      `The server will check the catalogue again immediately before deletion.`
    );


  if (
    !confirmed
  ) {

    return;
  }


  deletingThumbnailUid =
    uid;


  /*
   * Disable every Delete Orphan button while the operation is active.
   */
  setAllThumbnailDeleteButtonsDisabled(
    true
  );


  if (
    button
  ) {

    button.classList.remove(
      "is-error",
      "is-success"
    );


    button.classList.add(
      "is-working"
    );


    button.innerHTML = `
      <i data-lucide="loader-circle"></i>
      <span>Deleting…</span>
    `;
  }


  setThumbnailDeleteStatus(
    uid,
    "Checking catalogue and deleting the orphaned thumbnail…",
    "working"
  );


  window.lucide?.createIcons();


  try {

    /* ---------------------------------------------------------------
       DELETE THROUGH EDGE FUNCTION
    --------------------------------------------------------------- */

    const {
      data,
      error
    } =
      await supabase
        .functions
        .invoke(
          "zulu-thumbnail-health",
          {
            body: {
              action:
                "delete_orphan",

              uid:
                item.uid,

              file_name:
                item.file_name,

              file_id:
                item.file_id
            }
          }
        );


    if (
      error
    ) {

      throw new Error(
        error.message ||
        "Thumbnail cleanup request failed."
      );
    }


    if (
      !data ||
      data.success !==
        true
    ) {

      throw new Error(
        data?.error ||
        "Thumbnail deletion was unsuccessful."
      );
    }


    /* ---------------------------------------------------------------
       B2 REPORTED SUCCESS
    --------------------------------------------------------------- */

    if (
      button
    ) {

      button.classList.remove(
        "is-working"
      );


      button.classList.add(
        "is-success"
      );


      button.innerHTML = `
        <i data-lucide="check"></i>
        <span>Deleted</span>
      `;
    }


    setThumbnailDeleteStatus(
      uid,
      "Thumbnail deleted. Verifying storage health…",
      "success"
    );


    window.lucide?.createIcons();


    /* ---------------------------------------------------------------
       RECONCILE AGAIN
    --------------------------------------------------------------- */

    const refreshed =
      await loadThumbnailHealth();


    /*
     * Never assume that a successful API response means our diagnostic
     * problem has disappeared.
     *
     * Verify against a fresh B2 inventory.
     */
    const stillOrphaned =
      refreshed
        ?.orphaned
        ?.rows
        ?.some(
          row =>
            Number(
              row.uid
            ) ===
            Number(
              uid
            )
        );


    if (
      stillOrphaned
    ) {

      throw new Error(
        `Thumbnail ${item.file_name} was reported deleted but still appears in Thumbnail Health.`
      );
    }


    /* ---------------------------------------------------------------
       UPDATE DASHBOARD
    --------------------------------------------------------------- */

    renderThumbnailHealth(
      refreshed
    );


    /*
     * Keep the user in the Orphaned diagnostic panel.
     *
     * The deleted row will now be absent and the count should have
     * decreased by one.
     */
    openThumbnailResult(
      "orphaned"
    );


  } catch (error) {

    console.error(
      "ORPHAN THUMBNAIL DELETE FAILED:",
      error
    );


    setThumbnailDeleteStatus(
      uid,
      error?.message ||
      "Could not delete the orphaned thumbnail.",
      "error"
    );


    if (
      button
    ) {

      button.disabled =
        false;


      button.classList.remove(
        "is-working",
        "is-success"
      );


      button.classList.add(
        "is-error"
      );


      button.innerHTML = `
        <i data-lucide="trash-2"></i>
        <span>Try Again</span>
      `;
    }


    window.lucide?.createIcons();

  } finally {

    deletingThumbnailUid =
      null;


    setAllThumbnailDeleteButtonsDisabled(
      false
    );
  }
}


/**
 * Enables/disables all currently-rendered Delete Orphan buttons.
 */
function setAllThumbnailDeleteButtonsDisabled(
  disabled
) {

  document
    .querySelectorAll(
      ".admin-thumbnail-delete-button"
    )
    .forEach(
      button => {

        button.disabled =
          Boolean(
            disabled
          );
      }
    );
}


/**
 * Displays progress, success or failure beneath one orphan row.
 */
function setThumbnailDeleteStatus(
  uid,
  message,
  state = ""
) {

  const status =
    document.querySelector(
      `[data-thumbnail-delete-status="${cssEscapeValue(
        uid
      )}"]`
    );


  if (
    !status
  ) {

    return;
  }


  status.hidden =
    false;


  status.textContent =
    message;


  status.classList.remove(
    "is-working",
    "is-success",
    "is-error"
  );


  if (
    state
  ) {

    status.classList.add(
      `is-${state}`
    );
  }
}


/* =====================================================================
   16. CATALOGUE INTEGRITY
===================================================================== */

/**
 * Stores and renders the latest Catalogue Integrity snapshot returned by
 * zulu-admin-dashboard.
 */
function renderCatalogueIntegrity(
  integrity
) {

  currentIntegrityData =
    integrity ||
    null;


  if (
    !integrity
  ) {

    renderCatalogueIntegrityError(
      new Error(
        "Catalogue Integrity data is unavailable."
      )
    );


    return;
  }


  const duplicateUrls =
    getIntegrityCount(
      integrity,
      "duplicate_urls"
    );


  const duplicateFingerprints =
    getIntegrityCount(
      integrity,
      "duplicate_fingerprints"
    );


  const noActors =
    getIntegrityCount(
      integrity,
      "videos_without_actors"
    );


  const oldUrls =
    getIntegrityCount(
      integrity,
      "old_media_urls"
    );


  const missingFilesize =
    getIntegrityCount(
      integrity,
      "missing_filesize"
    );


  const missingDuration =
    getIntegrityCount(
      integrity,
      "missing_duration"
    );


  const missingResolution =
    getIntegrityCount(
      integrity,
      "missing_resolution"
    );


  const missingFingerprint =
    getIntegrityCount(
      integrity,
      "missing_fingerprint"
    );


  setNumber(
    integrityDuplicateUrls,
    duplicateUrls
  );


  setNumber(
    integrityDuplicateFingerprints,
    duplicateFingerprints
  );


  setNumber(
    integrityNoActors,
    noActors
  );


  setNumber(
    integrityOldUrls,
    oldUrls
  );


  setNumber(
    integrityMissingFilesize,
    missingFilesize
  );


  setNumber(
    integrityMissingDuration,
    missingDuration
  );


  setNumber(
    integrityMissingResolution,
    missingResolution
  );


  setNumber(
    integrityMissingFingerprint,
    missingFingerprint
  );


  /*
   * Duplicate URLs are a strong integrity problem.
   */
  setIntegrityCardState(
    "duplicate_urls",
    duplicateUrls === 0
      ? "healthy"
      : "problem"
  );


  /*
   * Duplicate fingerprints need human review rather than automatic
   * deletion because two legitimate catalogue records can potentially
   * reference identical media.
   */
  setIntegrityCardState(
    "duplicate_fingerprints",
    duplicateFingerprints === 0
      ? "healthy"
      : "warning"
  );


  setIntegrityCardState(
    "videos_without_actors",
    noActors === 0
      ? "healthy"
      : "warning"
  );


  setIntegrityCardState(
    "old_media_urls",
    oldUrls === 0
      ? "healthy"
      : "problem"
  );


  setIntegrityCardState(
    "missing_filesize",
    missingFilesize === 0
      ? "healthy"
      : "warning"
  );


  setIntegrityCardState(
    "missing_duration",
    missingDuration === 0
      ? "healthy"
      : "warning"
  );


  setIntegrityCardState(
    "missing_resolution",
    missingResolution === 0
      ? "healthy"
      : "warning"
  );


  setIntegrityCardState(
    "missing_fingerprint",
    missingFingerprint === 0
      ? "healthy"
      : "warning"
  );


  closeIntegrityResults();


  window.lucide?.createIcons();
}


/**
 * Returns a count from a Catalogue Integrity section.
 *
 * zulu_catalogue_integrity() sections are expected to use:
 *
 *     {
 *       count: 7,
 *       rows: [...]
 *     }
 *
 * The fallback also accepts an array directly.
 */
function getIntegrityCount(
  integrity,
  key
) {

  const section =
    integrity?.[
      key
    ];


  if (
    Array.isArray(
      section
    )
  ) {

    return section.length;
  }


  const count =
    Number(
      section?.count
    );


  return Number.isFinite(
    count
  )
    ? count
    : 0;
}


/**
 * Returns detailed rows from one Catalogue Integrity section.
 */
function getIntegrityRows(
  integrity,
  key
) {

  const section =
    integrity?.[
      key
    ];


  if (
    Array.isArray(
      section
    )
  ) {

    return section;
  }


  if (
    Array.isArray(
      section?.rows
    )
  ) {

    return section.rows;
  }


  return [];
}


/**
 * Applies the state class to a Catalogue Integrity card.
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
    "is-loading",
    "is-error",
    "is-healthy",
    "is-warning",
    "is-problem",
    "is-selected"
  );


  card.classList.add(
    `is-${state}`
  );
}


/**
 * Displays a Catalogue Integrity failure.
 */
function renderCatalogueIntegrityError(
  error
) {

  currentIntegrityData =
    null;


  const values = [
    integrityDuplicateUrls,
    integrityDuplicateFingerprints,
    integrityNoActors,
    integrityOldUrls,
    integrityMissingFilesize,
    integrityMissingDuration,
    integrityMissingResolution,
    integrityMissingFingerprint
  ];


  values.forEach(
    element =>
      setText(
        element,
        "—"
      )
  );


  document
    .querySelectorAll(
      ".admin-integrity-card"
    )
    .forEach(
      card => {

        card.classList.remove(
          "is-loading",
          "is-healthy",
          "is-warning",
          "is-problem",
          "is-selected"
        );


        card.classList.add(
          "is-error"
        );
      }
    );


  if (
    integrityResultsBody
  ) {

    integrityResultsBody.innerHTML =
      `
        <div class="admin-integrity-empty">
          ${escapeHtml(
            error?.message ||
            "Catalogue Integrity is unavailable."
          )}
        </div>
      `;
  }


  closeIntegrityResults();
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
    !currentIntegrityData
  ) {

    return;
  }


  const rows =
    getIntegrityRows(
      currentIntegrityData,
      key
    );


  document
    .querySelectorAll(
      ".admin-integrity-card"
    )
    .forEach(
      card => {

        card.classList.toggle(
          "is-selected",
          card.dataset.integrityKey ===
            key
        );
      }
    );


  const titles = {
    duplicate_urls:
      "Duplicate URLs",

    duplicate_fingerprints:
      "Duplicate Fingerprints",

    videos_without_actors:
      "Videos Without Actors",

    old_media_urls:
      "Old Media URLs",

    missing_filesize:
      "Missing Filesize",

    missing_duration:
      "Missing Duration",

    missing_resolution:
      "Missing Resolution",

    missing_fingerprint:
      "Missing Fingerprint"
  };


  if (
    integrityResultsTitle
  ) {

    integrityResultsTitle.textContent =
      titles[key] ||
      "Catalogue Integrity";
  }


  if (
    integrityResultsBody
  ) {

    integrityResultsBody.innerHTML =
      renderIntegrityRows(
        key,
        rows
      );
  }


  if (
    integrityResults
  ) {

    integrityResults.hidden =
      false;
  }


  if (
    key ===
      "duplicate_fingerprints"
  ) {

    attachDuplicateVideoEvents();
  }


  window.lucide?.createIcons();
}

/**
 * Closes Catalogue Integrity diagnostics.
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
      card => {

        card.classList.remove(
          "is-selected"
        );
      }
    );
}


/**
 * Converts Catalogue Integrity rows to HTML.
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
 * Renders one Catalogue Integrity diagnostic record.
 *
 * The RPC can return ordinary video rows as well as duplicate groups,
 * so this renderer intentionally supports both structures.
 */

function renderIntegrityRow(
  key,
  row
) {

  /* -------------------------------------------------------------------
     DUPLICATE FINGERPRINT GROUPS
  ------------------------------------------------------------------- */

  if (
    key ===
      "duplicate_fingerprints"
  ) {

    return renderDuplicateFingerprintGroup(
      row
    );
  }


  /* -------------------------------------------------------------------
     DUPLICATE URL GROUPS
  ------------------------------------------------------------------- */

  if (
    key ===
      "duplicate_urls"
  ) {

    const videos =
      row.videos ||
      row.rows ||
      row.items ||
      [];


    const groupValue =
      row.url ||
      row.value ||
      row.duplicate_value ||
      "";


    return `
      <div class="admin-integrity-result">

        <div class="admin-integrity-result-title">

          <span class="admin-integrity-result-film">
            Duplicate URL group
          </span>

        </div>


        ${
          groupValue
            ? `
                <div class="admin-integrity-result-meta">

                  <div>

                    <strong>
                      URL:
                    </strong>

                    <span class="admin-integrity-file">
                      ${escapeHtml(
                        groupValue
                      )}
                    </span>

                  </div>

                </div>
              `
            : ""
        }


        ${
          Array.isArray(
            videos
          ) &&
          videos.length
            ? `
                <div class="admin-integrity-duplicates">

                  ${videos
                    .map(
                      video => `
                        <div class="admin-integrity-duplicate-item">

                          <strong>
                            UID ${escapeHtml(
                              video.uid ??
                              "—"
                            )}
                          </strong>

                          <span>
                            ${escapeHtml(
                              video.film ||
                              video.title ||
                              "Untitled"
                            )}
                          </span>

                        </div>
                      `
                    )
                    .join(
                      ""
                    )}

                </div>
              `
            : renderGenericIntegrityMeta(
                row
              )
        }

      </div>
    `;
  }


  /* -------------------------------------------------------------------
     ORDINARY VIDEO RECORD
  ------------------------------------------------------------------- */

  return `
    <div class="admin-integrity-result">

      <div class="admin-integrity-result-title">

        ${
          row.uid !==
            undefined &&
          row.uid !==
            null
            ? `
                <span class="admin-integrity-result-uid">
                  UID ${escapeHtml(
                    row.uid
                  )}
                </span>
              `
            : ""
        }

        <span class="admin-integrity-result-film">
          ${escapeHtml(
            row.film ||
            row.title ||
            "Untitled"
          )}
        </span>

      </div>

      ${renderGenericIntegrityMeta(
        row
      )}

    </div>
  `;
}


/**
 * Renders one duplicate-fingerprint group as a detailed comparison.
 *
 * The zulu-admin-dashboard Edge Function enriches each fingerprint
 * diagnostic with the complete zulu_videos rows belonging to that group.
 *
 * Stage 10.4A is deliberately READ ONLY.
 *
 * No catalogue row or Backblaze object can be changed from this renderer.
 * The purpose of this view is to establish whether the records really do
 * appear to represent the same physical video before repair controls are
 * introduced.
 */
function renderDuplicateFingerprintGroup(
  row
) {

  const fingerprint =
    String(
      row?.fingerprint ||
      row?.value ||
      row?.duplicate_value ||
      ""
    );


  const videos =
    Array.isArray(
      row?.videos
    )
      ? row.videos
      : [];


  /* -------------------------------------------------------------------
     FALLBACK

     If the updated zulu-admin-dashboard has not yet been deployed, or
     if it could not enrich this group, show the original diagnostic
     information rather than rendering a blank result.
  ------------------------------------------------------------------- */

  if (
    !videos.length
  ) {

    const uids =
      Array.isArray(
        row?.uids
      )
        ? row.uids
        : (
            row?.uid !==
              undefined &&
            row?.uid !==
              null
              ? [
                  row.uid
                ]
              : []
          );


    return `
      <div class="admin-duplicate-group">

        <div class="admin-duplicate-group-header">

          <div>

            <div class="admin-duplicate-label">
              DUPLICATE FINGERPRINT GROUP
            </div>

            <div class="admin-duplicate-fingerprint">
              ${escapeHtml(
                fingerprint ||
                "Unknown fingerprint"
              )}
            </div>

          </div>


          ${
            uids.length
              ? `
                  <div class="admin-duplicate-count">
                    ${escapeHtml(
                      uids.length
                    )}
                    ${
                      uids.length === 1
                        ? "record"
                        : "records"
                    }
                  </div>
                `
              : ""
          }

        </div>


        <div class="admin-duplicate-warning">

          Detailed catalogue records are unavailable.

          Refresh Admin after deploying the updated
          zulu-admin-dashboard Edge Function.

        </div>


        ${
          uids.length
            ? `
                <div class="admin-duplicate-fallback-uids">

                  ${
                    uids
                      .map(
                        uid => `
                          <span>
                            UID ${escapeHtml(
                              uid
                            )}
                          </span>
                        `
                      )
                      .join(
                        ""
                      )
                  }

                </div>
              `
            : ""
        }

      </div>
    `;
  }


  /* -------------------------------------------------------------------
     COMPARE THE CATALOGUE RECORDS
  ------------------------------------------------------------------- */

  const comparison =
    compareDuplicateVideos(
      videos
    );


  /* -------------------------------------------------------------------
     RENDER
  ------------------------------------------------------------------- */

  return `
    <div class="admin-duplicate-group">

      <div class="admin-duplicate-group-header">

        <div>

          <div class="admin-duplicate-label">
            DUPLICATE FINGERPRINT GROUP
          </div>

          <div class="admin-duplicate-fingerprint">
            ${escapeHtml(
              fingerprint ||
              "Unknown fingerprint"
            )}
          </div>

        </div>


        <div class="admin-duplicate-count">

          ${escapeHtml(
            videos.length
          )}

          ${
            videos.length === 1
              ? "record"
              : "records"
          }

        </div>

      </div>


      <div class="admin-duplicate-video-grid">

        ${
          videos
            .map(
              video =>
                renderDuplicateVideoCard(
                  video
                )
            )
            .join(
              ""
            )
        }

      </div>


      <div class="admin-duplicate-comparison">

        ${renderDuplicateComparisonRow(
          "Fingerprint",
          comparison.sameFingerprint,
          comparison.sameFingerprint
            ? "Identical"
            : "Different"
        )}


        ${renderDuplicateComparisonRow(
          "Filesize",
          comparison.sameFilesize,
          comparison.sameFilesize
            ? "Identical"
            : "Different"
        )}


        ${renderDuplicateComparisonRow(
          "Duration",
          comparison.sameDuration,
          comparison.sameDuration
            ? "Identical"
            : "Different"
        )}


        ${renderDuplicateComparisonRow(
          "Resolution",
          comparison.sameResolution,
          comparison.sameResolution
            ? "Identical"
            : "Different"
        )}


        ${renderDuplicateComparisonRow(
          "Film title",
          comparison.sameFilm,
          comparison.sameFilm
            ? "Identical"
            : "Different"
        )}


        ${renderDuplicateComparisonRow(
          "Media URL",
          comparison.sameUrl,
          comparison.sameUrl
            ? "Identical"
            : "Different"
        )}

      </div>


      <div
        class="
          admin-duplicate-review-note
          ${
            comparison.allTechnicalMetadataMatches
              ? "is-strong-match"
              : "is-investigation"
          }
        "
      >

        ${
          comparison.allTechnicalMetadataMatches
            ? `
                <strong>
                  Strong duplicate match.
                </strong>

                The fingerprint, filesize, duration and
                resolution agree. Review the catalogue
                titles and media URLs before deciding
                whether these records should be
                consolidated.
              `
            : `
                <strong>
                  Manual investigation required.
                </strong>

                These catalogue records share a
                fingerprint, but one or more technical
                properties differ. They should not be
                automatically consolidated.
              `
        }

      </div>


      <div class="admin-duplicate-actions">

        <button
          type="button"
          class="
            admin-button
            admin-button-secondary
            admin-duplicate-keep-button
          "
          disabled
          title="Persistent Keep Both decisions will be enabled in the next catalogue-repair stage."
        >

          <i data-lucide="copy-check"></i>

          <span>
            Keep Both
          </span>

        </button>


        <button
          type="button"
          class="
            admin-button
            admin-duplicate-consolidate-button
          "
          disabled
          title="Protected server-side consolidation will be enabled in Stage 10.4B."
        >

          <i data-lucide="combine"></i>

          <span>
            Consolidate Duplicate
          </span>

        </button>

      </div>

    </div>
  `;
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
 * Instead we reuse getAdminSignedVideoUrl(), which calls the protected
 * zulu-sign-media Edge Function and returns a temporary signed URL.
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
 * Compares the fields that help determine whether catalogue records
 * appear to represent the same physical video.
 *
 * Fingerprint equality alone is not treated as sufficient evidence for
 * deletion. Filesize, duration and resolution are also compared.
 */
function compareDuplicateVideos(
  videos
) {

  /**
   * Returns true when the normalised value returned by getter() is the
   * same for every video in the group.
   */
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
 *
 * Supabase may return bigint/numeric columns as strings depending on the
 * value and client serialisation, so comparing raw values could report a
 * false difference between e.g. "123" and 123.
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
 * Renders one technical comparison result.
 */
function renderDuplicateComparisonRow(
  label,
  matches,
  value
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

      <i
        data-lucide="${
          matches
            ? "circle-check"
            : "triangle-alert"
        }"
      ></i>


      <span class="admin-duplicate-comparison-label">
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


/**
 * Extracts a readable filename from a catalogue media URL.
 *
 * Example:
 *
 * https://media.../Actor%20One%20with%20Actor%20Two.mp4
 *
 * becomes:
 *
 * Actor One with Actor Two.mp4
 */
function getDuplicateMediaFilename(
  url
) {

  if (
    !url
  ) {

    return "";
  }


  try {

    const parsed =
      new URL(
        url
      );


    const pathname =
      decodeURIComponent(
        parsed.pathname
      );


    return pathname
      .split(
        "/"
      )
      .filter(
        Boolean
      )
      .pop() ||
      "";


  } catch {

    try {

      return decodeURIComponent(
        String(
          url
        )
          .split(
            "?"
          )[0]
          .split(
            "/"
          )
          .pop() ||
        ""
      );


    } catch {

      return String(
        url
      );
    }
  }
}


/**
 * Formats duration_seconds as:
 *
 *     MM:SS
 *
 * or:
 *
 *     H:MM:SS
 */
function formatDuplicateDuration(
  seconds
) {

  const value =
    Number(
      seconds
    );


  if (
    !Number.isFinite(
      value
    ) ||
    value < 0
  ) {

    return "—";
  }


  const rounded =
    Math.round(
      value
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
 * Formats width + height as a readable resolution.
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


  return `${
    parsedWidth
  } × ${
    parsedHeight
  }`;
}





/**
 * Produces useful metadata for a Catalogue Integrity row without
 * assuming one exact RPC row shape.
 */
function renderGenericIntegrityMeta(
  row
) {

  const fields = [];


  if (
    row.url
  ) {

    fields.push(
      [
        "URL",
        row.url
      ]
    );
  }


  if (
    row.fingerprint
  ) {

    fields.push(
      [
        "Fingerprint",
        row.fingerprint
      ]
    );
  }


  if (
    row.filesize !==
      undefined &&
    row.filesize !==
      null
  ) {

    fields.push(
      [
        "Filesize",
        row.filesize
      ]
    );
  }


  if (
    row.duration !==
      undefined &&
    row.duration !==
      null
  ) {

    fields.push(
      [
        "Duration",
        row.duration
      ]
    );
  }


  if (
    row.resolution
  ) {

    fields.push(
      [
        "Resolution",
        row.resolution
      ]
    );
  }


  if (
    row.reason
  ) {

    fields.push(
      [
        "Reason",
        row.reason
      ]
    );
  }


  if (
    !fields.length
  ) {

    return "";
  }


  return `
    <div class="admin-integrity-result-meta">

      ${fields
        .map(
          (
            [
              label,
              value
            ]
          ) => `
            <div>

              <strong>
                ${escapeHtml(
                  label
                )}:
              </strong>

              <span class="admin-integrity-file">
                ${escapeHtml(
                  value
                )}
              </span>

            </div>
          `
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
 * Renders the recent ingestion journal returned by
 * zulu-admin-dashboard.
 */
function renderRecentIngestions(
  ingestions
) {

  if (
    !adminIngestionsBody
  ) {

    return;
  }


  adminIngestionsBody.innerHTML =
    "";


  if (
    !Array.isArray(
      ingestions
    ) ||
    !ingestions.length
  ) {

    adminIngestionsBody.innerHTML =
      `
        <tr>

          <td
            colspan="7"
            class="admin-table-empty"
          >
            No ingestion records found.
          </td>

        </tr>
      `;


    return;
  }


  for (
    const ingestion of ingestions
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
          ${escapeHtml(
            displayFilm
          )}
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
 * Creates the hidden diagnostics row belonging to an ingestion summary
 * row.
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
            "Updated",
            formatDateTime(
              ingestion.updated_at
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
            "Thumbnail status",
            ingestion.thumbnail_status
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
   19. INGESTION EXPAND / COLLAPSE
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
   20. INGESTION COMPONENT STATES
===================================================================== */

/**
 * Determines the state of the Backblaze video upload for one ingestion.
 */
function getVideoState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  /*
   * A Backblaze file ID, recorded upload timestamp or public URL is
   * strong evidence that the MP4 upload completed.
   */
  if (
    ingestion.backblaze_file_id ||
    ingestion.video_uploaded_at ||
    ingestion.public_url
  ) {

    return {
      label:
        "Uploaded",

      symbol:
        "✓",

      className:
        "good"
    };
  }


  if (
    status ===
      "uploading"
  ) {

    return {
      label:
        "Uploading",

      symbol:
        "…",

      className:
        "active"
    };
  }


  if (
    status ===
      "failed" &&
    (
      ingestion.failed_stage ===
        "video-upload" ||
      ingestion.failed_stage ===
        "upload"
    )
  ) {

    return {
      label:
        "Failed",

      symbol:
        "✕",

      className:
        "bad"
    };
  }


  if (
    status ===
      "cancelled"
  ) {

    return {
      label:
        "Cancelled",

      symbol:
        "—",

      className:
        "muted"
    };
  }


  if (
    status ===
      "duplicate"
  ) {

    return {
      label:
        "Duplicate",

      symbol:
        "=",

      className:
        "muted"
    };
  }


  return {
    label:
      "Pending",

    symbol:
      "—",

    className:
      "muted"
  };
}


/**
 * Determines whether an ingestion reached the zulu_videos catalogue.
 */
function getCatalogueState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  if (
    ingestion.video_uid !==
      null &&
    ingestion.video_uid !==
      undefined
  ) {

    return {
      label:
        `UID ${ingestion.video_uid}`,

      symbol:
        "✓",

      className:
        "good"
    };
  }


  if (
    ingestion.catalogued_at
  ) {

    return {
      label:
        "Catalogued",

      symbol:
        "✓",

      className:
        "good"
    };
  }


  if (
    status ===
      "cataloguing"
  ) {

    return {
      label:
        "Cataloguing",

      symbol:
        "…",

      className:
        "active"
    };
  }


  if (
    status ===
      "catalogued"
  ) {

    return {
      label:
        "Catalogued",

      symbol:
        "✓",

      className:
        "good"
    };
  }


  if (
    status ===
      "failed" &&
    (
      ingestion.failed_stage ===
        "catalogue" ||
      ingestion.failed_stage ===
        "cataloguing"
    )
  ) {

    return {
      label:
        "Failed",

      symbol:
        "✕",

      className:
        "bad"
    };
  }


  if (
    status ===
      "cancelled"
  ) {

    return {
      label:
        "Cancelled",

      symbol:
        "—",

      className:
        "muted"
    };
  }


  if (
    status ===
      "duplicate"
  ) {

    return {
      label:
        "Duplicate",

      symbol:
        "=",

      className:
        "muted"
    };
  }


  return {
    label:
      "Pending",

    symbol:
      "—",

    className:
      "muted"
  };
}


/**
 * Determines the thumbnail outcome recorded by the ingestion journal.
 *
 * IMPORTANT:
 *
 * This describes what happened during a particular ingestion.
 *
 * It is deliberately separate from Thumbnail Health, which checks
 * whether images/{uid}.png ACTUALLY exists in Backblaze now.
 */
function getThumbnailState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  const thumbnailStatusValue =
    normaliseStatus(
      ingestion.thumbnail_status
    );


  if (
    ingestion.thumbnail_uploaded_at ||
    thumbnailStatusValue ===
      "uploaded" ||
    thumbnailStatusValue ===
      "complete"
  ) {

    return {
      label:
        "Uploaded",

      symbol:
        "✓",

      className:
        "good"
    };
  }


  if (
    status ===
      "complete_without_thumbnail"
  ) {

    return {
      label:
        "Missing",

      symbol:
        "⚠",

      className:
        "warning"
    };
  }


  if (
    status ===
      "thumbnail_uploading" ||
    thumbnailStatusValue ===
      "uploading"
  ) {

    return {
      label:
        "Uploading",

      symbol:
        "…",

      className:
        "active"
    };
  }


  if (
    status ===
      "failed" &&
    (
      ingestion.failed_stage ===
        "thumbnail-upload" ||
      ingestion.failed_stage ===
        "thumbnail-generation" ||
      ingestion.failed_stage ===
        "thumbnail"
    )
  ) {

    return {
      label:
        "Failed",

      symbol:
        "✕",

      className:
        "bad"
    };
  }


  if (
    status ===
      "cancelled"
  ) {

    return {
      label:
        "Cancelled",

      symbol:
        "—",

      className:
        "muted"
    };
  }


  if (
    status ===
      "duplicate"
  ) {

    return {
      label:
        "Duplicate",

      symbol:
        "=",

      className:
        "muted"
    };
  }


  return {
    label:
      "Pending",

    symbol:
      "—",

    className:
      "muted"
  };
}


/* =====================================================================
   21. STATUS BADGES
===================================================================== */

/**
 * Renders the primary ingestion status badge.
 */
function renderStatusBadge(
  status
) {

  const normalised =
    normaliseStatus(
      status
    );


  const config =
    getStatusConfig(
      normalised
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
 * Maps an ingestion state to its human-readable label and CSS state.
 *
 * These class names correspond to the corrected Stage 9 Admin CSS:
 *
 *     .admin-status-badge.complete
 *     .admin-status-badge.warning
 *     .admin-status-badge.failed
 *     .admin-status-badge.cancelled
 *     .admin-status-badge.duplicate
 *     .admin-status-badge.pending
 *     .admin-status-badge.active
 *     .admin-status-badge.ready
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
          "complete"
      };


    case "complete_without_thumbnail":

      return {
        label:
          "Without thumbnail",

        className:
          "warning"
      };


    case "failed":

      return {
        label:
          "Failed",

        className:
          "failed"
      };


    case "cancelled":

      return {
        label:
          "Cancelled",

        className:
          "cancelled"
      };


    case "duplicate":

      return {
        label:
          "Duplicate",

        className:
          "duplicate"
      };


    case "pending":

      return {
        label:
          "Pending",

        className:
          "pending"
      };


    case "ready":

      return {
        label:
          "Ready",

        className:
          "ready"
      };


    case "analysing":

      return {
        label:
          "Analysing",

        className:
          "active"
      };


    case "uploading":

      return {
        label:
          "Uploading",

        className:
          "active"
      };


    case "video_uploaded":

      return {
        label:
          "Video uploaded",

        className:
          "active"
      };


    case "cataloguing":

      return {
        label:
          "Cataloguing",

        className:
          "active"
      };


    case "catalogued":

      return {
        label:
          "Catalogued",

        className:
          "active"
      };


    case "thumbnail_uploading":

      return {
        label:
          "Thumbnail upload",

        className:
          "active"
      };


    default:

      return {
        label:
          humaniseStatus(
            status ||
            "unknown"
          ),

        className:
          "pending"
      };
  }
}


/* =====================================================================
   22. COMPONENT STATE RENDERING
===================================================================== */

/**
 * Renders one Video / Catalogue / Thumbnail component state.
 *
 * CSS uses:
 *
 *     .admin-component-state.good
 *     .admin-component-state.bad
 *     .admin-component-state.warning
 *     .admin-component-state.active
 *     .admin-component-state.muted
 */
function renderState(
  state
) {

  return `
    <span
      class="
        admin-component-state
        ${escapeHtml(
          state.className
        )}
      "
    >

      <span class="admin-component-symbol">
        ${escapeHtml(
          state.symbol
        )}
      </span>

      <span>
        ${escapeHtml(
          state.label
        )}
      </span>

    </span>
  `;
}


/* =====================================================================
   23. INGESTION DETAIL HELPERS
===================================================================== */

/**
 * Renders one field inside the expanded ingestion diagnostics grid.
 *
 * Empty values are displayed as an em dash so each ingestion has a
 * consistent diagnostic structure.
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
        ${escapeHtml(
          label
        )}
      </div>

      <div class="admin-detail-value">
        ${escapeHtml(
          displayValue
        )}
      </div>

    </div>
  `;
}


/* =====================================================================
   24. TABLE ERROR STATE
===================================================================== */

/**
 * Displays a dashboard failure inside Recent Ingestions.
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
   25. PAGE STATUS
===================================================================== */

/**
 * Updates the main Admin page status message.
 */
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

/**
 * Enables or disables the main Refresh button.
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
    Boolean(
      loading
    );


  adminRefresh.classList.toggle(
    "loading",
    Boolean(
      loading
    )
  );


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
}


/* =====================================================================
   27. BASIC DOM HELPERS
===================================================================== */

/**
 * Sets plain text on an element if that element exists.
 */
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


/**
 * Formats and displays a numeric dashboard counter.
 */
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
   28. STATUS / TEXT NORMALISATION
===================================================================== */

/**
 * Converts a status into the lowercase underscore form used internally.
 */
function normaliseStatus(
  value
) {

  return String(
    value ||
    ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /[\s-]+/g,
      "_"
    );
}


/**
 * Converts an internal state name to a readable label.
 *
 * Example:
 *
 *     complete_without_thumbnail
 *
 * becomes:
 *
 *     Complete without thumbnail
 */
function humaniseStatus(
  value
) {

  const text =
    String(
      value ||
      ""
    )
      .replace(
        /_/g,
        " "
      )
      .trim();


  if (
    !text
  ) {

    return "Unknown";
  }


  return (
    text.charAt(
      0
    ).toUpperCase() +
    text.slice(
      1
    )
  );
}


/**
 * Removes a trailing .mp4 extension from a filename.
 */
function stripMp4Extension(
  value
) {

  if (
    !value
  ) {

    return "";
  }


  return String(
    value
  ).replace(
    /\.mp4$/i,
    ""
  );
}


/* =====================================================================
   29. DATE / TIME FORMATTING
===================================================================== */

/**
 * Formats an ISO timestamp for the Admin interface.
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

/**
 * Converts a byte count to a compact human-readable filesize.
 *
 * Used by:
 *
 *     • ingestion diagnostics
 *     • Thumbnail Health
 *     • Video Storage Health
 */
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
      units.length - 1
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
  )} ${units[unitIndex]}`;
}

/* =====================================================================
   31. SAFE VALUE HELPERS
===================================================================== */

/**
 * Returns the first useful value from a list.
 *
 * This is primarily useful for diagnostic data where an Edge Function
 * or RPC may expose the same conceptual field under slightly different
 * names while the backend evolves.
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

/**
 * Produces a useful message from the different error shapes returned by
 * JavaScript, Supabase and Edge Functions.
 */
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
