import {
  supabase
} from "../supabaseClient.js";


/* =====================================================================
   ADMIN.JS
   =====================================================================

   PURPOSE
   -------

   Powers the PornFlix Library Health / Admin dashboard.

   Protected catalogue and ingestion data is retrieved through:

       zulu-admin-dashboard

   Actual Backblaze MP4 storage health is retrieved separately through:

       zulu-video-health

   Actual Backblaze thumbnail storage health is retrieved separately
   through:

       zulu-thumbnail-health

   The separation is deliberate.

   If either Backblaze health service is temporarily unavailable, the
   main Admin dashboard can continue to load normally and the affected
   storage section can report its own independent error state.

   The dashboard provides:

       • catalogue video count
       • actor count
       • total video views
       • ingestion count
       • ingestion health summary
       • Catalogue Integrity diagnostics
       • metadata coverage diagnostics
       • Video Storage Health reconciliation
       • Thumbnail Health reconciliation
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

       • catalogue video count
       • Backblaze MP4 count
       • exact matched MP4s
       • missing MP4s
       • orphaned MP4s
       • case mismatches
       • URL / filename errors
       • invalid B2 objects

   Thumbnail Health checks:

       • expected thumbnails
       • present thumbnails
       • missing thumbnails
       • orphaned thumbnails
       • invalid thumbnail filenames

   Backblaze application credentials are NEVER exposed to this browser
   code. All B2 operations occur inside the protected Edge Functions.

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
 * Video Storage Health counters.
 */
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


/*
 * Video Storage Health status and coverage.
 */
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


/*
 * Video Storage Health diagnostic panel.
 */
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


/*
 * Thumbnail Health counters.
 */
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


/*
 * Thumbnail Health status.
 */
const thumbnailStatus =
  document.getElementById(
    "admin-thumbnail-status"
  );


/*
 * Thumbnail Health diagnostic panel.
 */
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


/*
 * Stores the latest Catalogue Integrity snapshot returned by
 * zulu-admin-dashboard.
 *
 * This allows diagnostic cards to display detailed results without
 * another database request.
 */
let currentIntegrityData =
  null;


/*
 * Stores the latest Backblaze MP4 reconciliation returned by
 * zulu-video-health.
 */
let currentVideoHealthData =
  null;


/*
 * Stores the latest actual Backblaze thumbnail reconciliation returned
 * by zulu-thumbnail-health.
 *
 * This allows Missing, Orphaned and Invalid cards to display the
 * corresponding object/video records without another B2 request.
 */
let currentThumbnailData =
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
   * Refresh all three independent dashboard data sources.
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


  /*
   * Video Storage Health diagnostic cards are interactive.
   *
   * Catalogue, B2 Videos and Matched are informational.
   */
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


  /*
   * Close Video Storage Health diagnostics.
   */
  videoHealthResultsClose?.addEventListener(
    "click",
    closeVideoHealthResults
  );


  /*
   * Missing, Orphaned and Invalid Thumbnail Health cards are
   * interactive.
   *
   * Expected and Present are deliberately informational only.
   */
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


  /*
   * Close the Thumbnail Health diagnostic panel.
   */
  thumbnailResultsClose?.addEventListener(
    "click",
    closeThumbnailResults
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
 * This is NOT the security boundary for the Edge Functions.
 *
 * zulu-admin-dashboard, zulu-video-health and zulu-thumbnail-health
 * independently verify the authenticated user's JWT and can
 * independently enforce ZULU_ADMIN_EMAIL before accessing protected
 * resources.
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
 * Reloads the complete Admin dashboard.
 *
 * Three independent server-side requests are made:
 *
 *     1. zulu-admin-dashboard
 *     2. zulu-video-health
 *     3. zulu-thumbnail-health
 *
 * Promise.allSettled() is used intentionally.
 *
 * This means a Backblaze problem does not prevent catalogue,
 * ingestion or the other independent storage-health service from
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

    /*
     * Confirm that the browser still has an authenticated Supabase user
     * before making any protected Edge Function requests.
     */
    const user =
      await requireAuthenticatedUser();


    if (
      !user
    ) {

      return;
    }


    /*
     * Three completely independent health requests:
     *
     *   1. Supabase catalogue / ingestion health
     *   2. Backblaze MP4 reconciliation
     *   3. Backblaze thumbnail reconciliation
     *
     * Promise.allSettled() means a problem in one service does not stop
     * either of the other two from rendering.
     */
    const [
      dashboardResult,
      videoHealthResult,
      thumbnailResult
    ] =
      await Promise.allSettled([
        loadAdminDashboard(),
        loadVideoHealth(),
        loadThumbnailHealth()
      ]);


    /* ===============================================================
       MAIN ADMIN DASHBOARD
    =============================================================== */

    if (
      dashboardResult.status ===
        "fulfilled"
    ) {

      const dashboard =
        dashboardResult.value;


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
       */
      renderRecentIngestions(
        dashboard.recent_ingestions ||
        []
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


  } catch (error) {

    /*
     * This outer catch is primarily for authentication or another
     * unexpected error outside the three independent health requests.
     */
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


  /*
   * Catalogue Integrity is a required part of the dashboard response.
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
   06. VIDEO STORAGE HEALTH REQUEST
===================================================================== */

/**
 * Retrieves the live MP4 inventory reconciliation from Backblaze through
 * the protected zulu-video-health Edge Function.
 *
 * The browser receives reconciliation results only.
 *
 * It never receives Backblaze credentials or direct B2 API tokens.
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
   07. THUMBNAIL HEALTH REQUEST
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
   08. LIBRARY SUMMARY
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
   09. INGESTION HEALTH
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
   10. VIDEO STORAGE HEALTH
===================================================================== */

/**
 * Stores and renders the latest catalogue ↔ Backblaze MP4 reconciliation.
 */
function renderVideoHealth(
  data
) {

  currentVideoHealthData =
    data;


  const summary =
    data.summary ||
    {};


  setNumber(
    videoHealthCatalogue,
    summary.catalogue_videos
  );


  setNumber(
    videoHealthB2,
    summary.b2_videos
  );


  setNumber(
    videoHealthMatched,
    summary.matched
  );


  setNumber(
    videoHealthMissing,
    summary.missing
  );


  setNumber(
    videoHealthOrphaned,
    summary.orphaned
  );


  setNumber(
    videoHealthCaseMismatch,
    summary.case_mismatch
  );


  setNumber(
    videoHealthUrlError,
    summary.url_filename_error
  );


  setNumber(
    videoHealthInvalid,
    summary.invalid
  );


  /*
   * Catalogue is informational.
   */
  setVideoHealthStaticCardState(
    videoHealthCatalogue,
    "healthy"
  );


  /*
   * B2 count is informational. It is healthy when the inventory request
   * itself completed successfully.
   */
  setVideoHealthStaticCardState(
    videoHealthB2,
    "healthy"
  );


  /*
   * Exact matched count should normally equal the catalogue count.
   *
   * A case mismatch can still be physically present, but it is not
   * treated as an exact match.
   */
  setVideoHealthStaticCardState(
    videoHealthMatched,
    Number(
      summary.matched ||
      0
    ) ===
      Number(
        summary.catalogue_videos ||
        0
      )
      ? "healthy"
      : "warning"
  );


  /*
   * Missing catalogue videos are the most serious storage discrepancy.
   */
  setVideoHealthCardState(
    "missing",
    Number(
      summary.missing ||
      0
    ) === 0
      ? "healthy"
      : "problem"
  );


  /*
   * Orphaned objects exist physically but are not referenced by the
   * catalogue.
   */
  setVideoHealthCardState(
    "orphaned",
    Number(
      summary.orphaned ||
      0
    ) === 0
      ? "healthy"
      : "warning"
  );


  /*
   * Case mismatches indicate that an object exists, but not under the
   * exact case-sensitive filename referenced by the catalogue.
   */
  setVideoHealthCardState(
    "case_mismatch",
    Number(
      summary.case_mismatch ||
      0
    ) === 0
      ? "healthy"
      : "warning"
  );


  /*
   * URL / filename errors mean the catalogue URL could not be mapped
   * cleanly to an MP4 object.
   */
  setVideoHealthCardState(
    "url_filename_error",
    Number(
      summary.url_filename_error ||
      0
    ) === 0
      ? "healthy"
      : "problem"
  );


  /*
   * Invalid objects are unexpected non-video objects outside images/.
   */
  setVideoHealthCardState(
    "invalid",
    Number(
      summary.invalid ||
      0
    ) === 0
      ? "healthy"
      : "warning"
  );


  const catalogueCount =
    Number(
      summary.catalogue_videos ||
      0
    );


  const physicallyPresent =
    Number(
      summary.physically_present ??
      summary.matched ??
      0
    );


  const coverage =
    Number(
      summary.coverage_percent ||
      0
    );


  /*
   * Overall green state is deliberately stricter than physical
   * presence alone.
   *
   * We want:
   *
   *   - every catalogue video physically present
   *   - no missing videos
   *   - no orphaned videos
   *   - no case mismatches
   *   - no URL / filename errors
   *   - no invalid objects
   */
  const completelyHealthy =
    catalogueCount > 0 &&
    physicallyPresent ===
      catalogueCount &&
    Number(
      summary.missing ||
      0
    ) === 0 &&
    Number(
      summary.orphaned ||
      0
    ) === 0 &&
    Number(
      summary.case_mismatch ||
      0
    ) === 0 &&
    Number(
      summary.url_filename_error ||
      0
    ) === 0 &&
    Number(
      summary.invalid ||
      0
    ) === 0;


  if (
    videoHealthCoverage
  ) {

    videoHealthCoverage.classList.remove(
      "is-loading",
      "is-healthy",
      "is-warning",
      "is-error"
    );


    videoHealthCoverage.classList.add(
      completelyHealthy
        ? "is-healthy"
        : "is-warning"
    );
  }


  if (
    videoHealthCoverageTitle
  ) {

    videoHealthCoverageTitle.textContent =
      `${coverage}% storage coverage`;
  }


  if (
    videoHealthCoverageDetail
  ) {

    videoHealthCoverageDetail.textContent =
      `${physicallyPresent.toLocaleString()} of ${catalogueCount.toLocaleString()} catalogue videos are physically present in Backblaze.`;
  }


  /*
   * Video Storage Health has its own refresh timestamp because it is an
   * independent request from the primary dashboard.
   */
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
   * If a diagnostic panel is already open during a refresh, redraw it
   * from the newly returned health snapshot.
   */
  const selectedCard =
    document.querySelector(
      ".admin-video-health-card-action.is-selected"
    );


  if (
    selectedCard &&
    !videoHealthResults?.hidden
  ) {

    openVideoHealthResult(
      selectedCard.dataset.videoHealthKey
    );
  }


  window.lucide?.createIcons();
}


/**
 * Sets the Video Storage Health section to its loading appearance.
 */
function setVideoHealthLoadingState() {

  currentVideoHealthData =
    null;


  [
    videoHealthCatalogue,
    videoHealthB2,
    videoHealthMatched,
    videoHealthMissing,
    videoHealthOrphaned,
    videoHealthCaseMismatch,
    videoHealthUrlError,
    videoHealthInvalid
  ]
    .forEach(
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
      ".admin-video-health-card"
    )
    .forEach(
      card => {

        card.classList.remove(
          "is-healthy",
          "is-warning",
          "is-problem",
          "is-error",
          "is-selected"
        );


        card.classList.add(
          "is-loading"
        );
      }
    );


  if (
    videoHealthStatus
  ) {

    videoHealthStatus.textContent =
      "Checking Backblaze…";
  }


  if (
    videoHealthCoverage
  ) {

    videoHealthCoverage.classList.remove(
      "is-healthy",
      "is-warning",
      "is-error"
    );


    videoHealthCoverage.classList.add(
      "is-loading"
    );
  }


  if (
    videoHealthCoverageTitle
  ) {

    videoHealthCoverageTitle.textContent =
      "Checking video storage…";
  }


  if (
    videoHealthCoverageDetail
  ) {

    videoHealthCoverageDetail.textContent =
      "Reconciling the catalogue against Backblaze B2.";
  }


  closeVideoHealthResults();
}


/**
 * Renders the independent error state for Video Storage Health.
 */
function renderVideoHealthError(
  error
) {

  currentVideoHealthData =
    null;


  document
    .querySelectorAll(
      ".admin-video-health-card"
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
    videoHealthStatus
  ) {

    videoHealthStatus.textContent =
      "Backblaze check failed";
  }


  if (
    videoHealthCoverage
  ) {

    videoHealthCoverage.classList.remove(
      "is-loading",
      "is-healthy",
      "is-warning"
    );


    videoHealthCoverage.classList.add(
      "is-error"
    );
  }


  if (
    videoHealthCoverageTitle
  ) {

    videoHealthCoverageTitle.textContent =
      "Video storage health unavailable";
  }


  if (
    videoHealthCoverageDetail
  ) {

    videoHealthCoverageDetail.textContent =
      error?.message ||
      "The Backblaze video inventory could not be loaded.";
  }


  closeVideoHealthResults();
}


/**
 * Applies a state to one interactive Video Storage Health diagnostic
 * card.
 */
function setVideoHealthCardState(
  key,
  state
) {

  const card =
    document.querySelector(
      `.admin-video-health-card-action[data-video-health-key="${key}"]`
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


  if (
    state
  ) {

    card.classList.add(
      `is-${state}`
    );
  }
}


/**
 * Applies a state to an informational Video Storage Health card.
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


  if (
    state
  ) {

    card.classList.add(
      `is-${state}`
    );
  }
}


/**
 * Opens one Video Storage Health diagnostic category.
 */
function openVideoHealthResult(
  key
) {

  if (
    !currentVideoHealthData ||
    !key
  ) {

    return;
  }


  const section =
    currentVideoHealthData[
      key
    ];


  if (
    !section
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
      "Orphaned B2 Videos",

    case_mismatch:
      "Case Mismatches",

    url_filename_error:
      "URL / Filename Errors",

    invalid:
      "Invalid B2 Objects"
  };


  if (
    videoHealthResultsTitle
  ) {

    videoHealthResultsTitle.textContent =
      titles[
        key
      ] ||
      "Video Storage Results";
  }


  if (
    videoHealthResultsBody
  ) {

    videoHealthResultsBody.innerHTML =
      renderVideoHealthRows(
        key,
        section.rows ||
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
 * Closes Video Storage Health diagnostics.
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
 * Renders the rows belonging to a Video Storage Health diagnostic
 * category.
 */
function renderVideoHealthRows(
  key,
  rows
) {

  if (
    !Array.isArray(
      rows
    ) ||
    rows.length === 0
  ) {

    return `
      <div class="admin-video-health-empty">
        No problems found.
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
 * Renders one Video Storage Health diagnostic record.
 */
function renderVideoHealthRow(
  key,
  row
) {

  const uid =
    row.uid !==
      null &&
    row.uid !==
      undefined
      ? escapeHtml(
          row.uid
        )
      : null;


  const film =
    row.film
      ? escapeHtml(
          row.film
        )
      : null;


  const title =
    film ||
    (
      row.file_name
        ? escapeHtml(
            row.file_name
          )
        : "Storage object"
    );


  const meta =
    [];


  if (
    uid
  ) {

    meta.push(
      `<strong>UID:</strong> ${uid}`
    );
  }


  if (
    row.file_name
  ) {

    meta.push(
      `<strong>B2 file:</strong> ${escapeHtml(
        row.file_name
      )}`
    );
  }


  if (
    row.expected_file
  ) {

    meta.push(
      `<strong>Expected:</strong> ${escapeHtml(
        row.expected_file
      )}`
    );
  }


  if (
    row.catalogue_file
  ) {

    meta.push(
      `<strong>Catalogue filename:</strong> ${escapeHtml(
        row.catalogue_file
      )}`
    );
  }


  if (
    row.b2_file
  ) {

    meta.push(
      `<strong>B2 filename:</strong> ${escapeHtml(
        row.b2_file
      )}`
    );
  }


  if (
    row.size_bytes !==
      null &&
    row.size_bytes !==
      undefined
  ) {

    meta.push(
      `<strong>Size:</strong> ${escapeHtml(
        formatBytes(
          row.size_bytes
        )
      )}`
    );
  }


  if (
    row.uploaded_at
  ) {

    meta.push(
      `<strong>Uploaded:</strong> ${escapeHtml(
        formatDateTime(
          row.uploaded_at
        )
      )}`
    );
  }


  if (
    row.reason
  ) {

    meta.push(
      `<strong>Reason:</strong> ${escapeHtml(
        row.reason
      )}`
    );
  }


  let extra =
    "";


  if (
    row.url
  ) {

    extra += `
      <div class="admin-video-health-path">
        ${escapeHtml(
          row.url
        )}
      </div>
    `;
  }


  if (
    row.file_id
  ) {

    extra += `
      <div class="admin-video-health-file-id">
        B2 file ID: ${escapeHtml(
          row.file_id
        )}
      </div>
    `;
  }


  return `
    <div
      class="admin-video-health-result"
      data-video-health-result="${escapeHtml(
        key
      )}"
    >

      <div class="admin-video-health-result-title">
        ${title}
      </div>

      ${
        meta.length
          ? `
            <div class="admin-video-health-result-meta">
              ${meta.join(
                " · "
              )}
            </div>
          `
          : ""
      }

      ${extra}

    </div>
  `;
}

/* =====================================================================
   11. THUMBNAIL HEALTH
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


  /*
   * Apply health colours.
   */
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


  /*
   * Expected is informational.
   */
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


  /*
   * Present is considered healthy when every expected thumbnail exists.
   */
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


  /*
   * Display the timestamp generated by zulu-thumbnail-health.
   */
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
   * A refresh invalidates an open diagnostic panel because its records
   * may have changed.
   */
  closeThumbnailResults();


  window.lucide?.createIcons();
}


/**
 * Places the Thumbnail Health section into its loading state.
 */
function setThumbnailLoadingState() {

  currentThumbnailData =
    null;


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


  if (
    thumbnailStatus
  ) {

    thumbnailStatus.textContent =
      "Checking Backblaze…";
  }


  closeThumbnailResults();
}


/**
 * Displays a Thumbnail Health failure without affecting the remainder
 * of the Admin dashboard.
 */
function renderThumbnailHealthError(
  error
) {

  currentThumbnailData =
    null;


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


  if (
    thumbnailStatus
  ) {

    thumbnailStatus.textContent =
      `Backblaze check failed: ${
        error?.message ||
        "Unknown error"
      }`;
  }


  closeThumbnailResults();
}


/**
 * Applies a health state to one interactive Thumbnail Health card.
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
   12. THUMBNAIL HEALTH INTERACTION
===================================================================== */

/**
 * Opens the detailed result belonging to a Thumbnail Health card.
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


  /*
   * Highlight only the currently selected Thumbnail Health card.
   */
  document
    .querySelectorAll(
      ".admin-thumbnail-card-action"
    )
    .forEach(
      card =>
        card.classList.toggle(
          "is-selected",
          card.dataset.thumbnailKey ===
            key
        )
    );


  if (
    thumbnailResultsTitle
  ) {

    thumbnailResultsTitle.textContent =
      getThumbnailResultTitle(
        key
      );
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


  window.lucide?.createIcons();
}


/**
 * Closes the Thumbnail Health diagnostic panel and clears card
 * selection.
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
      card =>
        card.classList.remove(
          "is-selected"
        )
    );
}


/**
 * Returns the human-readable title for a Thumbnail Health result.
 */
function getThumbnailResultTitle(
  key
) {

  const titles =
  {
    missing:
      "Missing Thumbnails",

    orphaned:
      "Orphaned Thumbnails",

    invalid:
      "Invalid Thumbnail Files"
  };


  return titles[
    key
  ] || "Thumbnail Health";
}


/* =====================================================================
   13. THUMBNAIL RESULT RENDERING
===================================================================== */

/**
 * Converts Thumbnail Health rows into diagnostic HTML.
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


  if (
    key ===
      "missing"
  ) {

    return rows
      .map(
        renderMissingThumbnail
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "orphaned"
  ) {

    return rows
      .map(
        renderOrphanedThumbnail
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "invalid"
  ) {

    return rows
      .map(
        renderInvalidThumbnail
      )
      .join(
        ""
      );
  }


  return "";
}


/**
 * Renders one catalogue video whose expected thumbnail does not exist
 * in Backblaze.
 */
function renderMissingThumbnail(
  item
) {

  return `
    <div class="admin-thumbnail-result">

      <div class="admin-thumbnail-result-title">

        <span class="admin-thumbnail-result-uid">
          UID ${escapeHtml(
            item.uid
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

        <strong>Expected:</strong>
        <span class="admin-thumbnail-file">
          ${escapeHtml(
            item.expected_file ||
            `images/${item.uid}.png`
          )}
        </span>

      </div>

    </div>
  `;
}


/**
 * Renders one valid-looking thumbnail whose UID is not present in
 * zulu_videos.
 */
function renderOrphanedThumbnail(
  item
) {

  return `
    <div class="admin-thumbnail-result">

      <div class="admin-thumbnail-result-title">

        <span class="admin-thumbnail-result-uid">
          UID ${escapeHtml(
            item.uid
          )}
        </span>

        <span class="admin-thumbnail-result-film">
          Orphaned thumbnail
        </span>

      </div>

      <div class="admin-thumbnail-result-meta">

        <div>
          <strong>File:</strong>
          <span class="admin-thumbnail-file">
            ${escapeHtml(
              item.file_name ||
              ""
            )}
          </span>
        </div>

        <div>
          <strong>Size:</strong>
          ${escapeHtml(
            formatBytes(
              item.size_bytes
            )
          )}
        </div>

        <div>
          <strong>Uploaded:</strong>
          ${escapeHtml(
            formatDateTime(
              item.uploaded_at
            )
          )}
        </div>

      </div>

    </div>
  `;
}


/**
 * Renders one object under images/ that does not follow the expected
 * images/{uid}.png naming convention.
 */
function renderInvalidThumbnail(
  item
) {

  return `
    <div class="admin-thumbnail-result">

      <div class="admin-thumbnail-result-title">

        <span class="admin-thumbnail-result-film">
          ${escapeHtml(
            item.file_name ||
            "Unknown file"
          )}
        </span>

      </div>

      <div class="admin-thumbnail-result-meta">

        <div>
          <strong>Size:</strong>
          ${escapeHtml(
            formatBytes(
              item.size_bytes
            )
          )}
        </div>

        <div>
          <strong>Uploaded:</strong>
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
                  <strong>B2 File ID:</strong>
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
   14. CATALOGUE INTEGRITY
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
        result.count ||
        0
      ) === 0
    ) {

      card.classList.add(
        "is-healthy"
      );


    } else {

      card.classList.add(
        `is-${mapping.severity}`
      );
    }
  }


  /*
   * Refreshing the dashboard invalidates any currently displayed
   * integrity details.
   */
  closeIntegrityResults();


  window.lucide?.createIcons();
}


/* =====================================================================
   15. CATALOGUE INTEGRITY INTERACTION
===================================================================== */

/**
 * Opens the detailed result belonging to a Catalogue Integrity card.
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
      getIntegrityResultTitle(
        key
      );
  }


  if (
    integrityResultsBody
  ) {

    integrityResultsBody.innerHTML =
      renderIntegrityRows(
        key,
        result.rows ||
        []
      );
  }


  if (
    integrityResults
  ) {

    integrityResults.hidden =
      false;
  }


  /*
   * Re-render Lucide in case any result renderer later adds icons.
   */
  window.lucide?.createIcons();
}


/**
 * Closes the Catalogue Integrity diagnostic panel and clears selection.
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
 * Returns the human-readable title for an integrity result.
 */
function getIntegrityResultTitle(
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


  return titles[
    key
  ] || "Diagnostic Results";
}


/* =====================================================================
   16. CATALOGUE INTEGRITY RESULT RENDERING
===================================================================== */

/**
 * Converts the rows belonging to an integrity check into HTML.
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
      "duplicate_urls"
  ) {

    return rows
      .map(
        renderDuplicateUrlGroup
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "duplicate_fingerprints"
  ) {

    return rows
      .map(
        renderDuplicateFingerprintGroup
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "videos_without_actors"
  ) {

    return rows
      .map(
        item =>
          renderSimpleIntegrityVideo(
            item,
            "No actor records"
          )
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "old_media_urls"
  ) {

    return rows
      .map(
        item =>
          renderSimpleIntegrityVideo(
            item,
            item.url ||
            "Non-current media URL"
          )
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "missing_filesize"
  ) {

    return rows
      .map(
        item =>
          renderSimpleIntegrityVideo(
            item,
            "Filesize is missing"
          )
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "missing_duration"
  ) {

    return rows
      .map(
        item =>
          renderSimpleIntegrityVideo(
            item,
            "Duration is missing"
          )
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "missing_resolution"
  ) {

    return rows
      .map(
        item =>
          renderSimpleIntegrityVideo(
            item,
            "Resolution is missing"
          )
      )
      .join(
        ""
      );
  }


  if (
    key ===
      "missing_fingerprint"
  ) {

    return rows
      .map(
        item =>
          renderSimpleIntegrityVideo(
            item,
            "Fingerprint is missing"
          )
      )
      .join(
        ""
      );
  }


  return "";
}


/**
 * Renders a duplicate URL group.
 */
function renderDuplicateUrlGroup(
  group
) {

  const videos =
    Array.isArray(
      group.videos
    )
      ? group.videos
      : [];


  return `
    <div class="admin-integrity-result">

      <div class="admin-integrity-result-title">
        ${escapeHtml(
          group.url ||
          "Unknown URL"
        )}
      </div>

      <div class="admin-integrity-result-meta">
        <strong>${escapeHtml(
          group.count ||
          videos.length
        )}</strong>
        catalogue records use this URL.
      </div>

      <div class="admin-integrity-video-list">

        ${
          videos
            .map(
              video =>
                renderIntegrityVideoChip(
                  video
                )
            )
            .join(
              ""
            )
        }

      </div>

    </div>
  `;
}


/**
 * Renders a duplicate fingerprint group.
 */
function renderDuplicateFingerprintGroup(
  group
) {

  const videos =
    Array.isArray(
      group.videos
    )
      ? group.videos
      : [];


  return `
    <div class="admin-integrity-result">

      <div class="admin-integrity-result-title">
        ${escapeHtml(
          group.count ||
          videos.length
        )}
        records share one file fingerprint
      </div>

      <div class="admin-integrity-fingerprint">
        ${escapeHtml(
          group.fingerprint ||
          "No fingerprint returned"
        )}
      </div>

      <div class="admin-integrity-video-list">

        ${
          videos
            .map(
              video =>
                renderIntegrityVideoChip(
                  video
                )
            )
            .join(
              ""
            )
        }

      </div>

    </div>
  `;
}


/**
 * Renders one simple integrity issue.
 */
function renderSimpleIntegrityVideo(
  item,
  detail
) {

  return `
    <div class="admin-integrity-result">

      <div class="admin-integrity-result-title">

        UID ${escapeHtml(
          item.uid
        )}
        ·
        ${escapeHtml(
          item.film ||
          "Untitled"
        )}

      </div>

      <div class="admin-integrity-result-meta">
        ${escapeHtml(
          detail
        )}
      </div>

    </div>
  `;
}


/**
 * Renders a compact video record inside a grouped integrity issue.
 */
function renderIntegrityVideoChip(
  video
) {

  return `
    <div class="admin-integrity-video">

      <span class="admin-integrity-video-uid">
        UID ${escapeHtml(
          video.uid
        )}
      </span>

      <span class="admin-integrity-video-film">
        ${escapeHtml(
          video.film ||
          "Untitled"
        )}
      </span>

    </div>
  `;
}

/* =====================================================================
   17. RECENT INGESTIONS TABLE
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
   18. INGESTION EXPAND / COLLAPSE
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
   19. INGESTION COMPONENT STATES
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
   * A Backblaze file ID or recorded upload timestamp is the strongest
   * evidence that the video upload completed.
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
    ingestion.failed_stage ===
      "video-upload"
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
      "○",

    className:
      "muted"
  };
}


/**
 * Determines whether the video was successfully catalogued in
 * zulu_videos.
 */
function getCatalogueState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  /*
   * A video UID or catalogued timestamp is definitive evidence that the
   * catalogue insert completed.
   */
  if (
    ingestion.video_uid !==
      null &&
    ingestion.video_uid !==
      undefined
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
      "○",

    className:
      "muted"
  };
}


/**
 * Determines the state of the thumbnail for one ingestion.
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


  /*
   * A thumbnail upload timestamp or completed thumbnail status is
   * definitive.
   */
  if (
    ingestion.thumbnail_uploaded_at ||
    thumbnailStatus ===
      "complete" ||
    thumbnailStatus ===
      "uploaded"
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


  /*
   * The ingestion can deliberately complete without a thumbnail.
   */
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
    thumbnailStatus ===
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
        "thumbnail_upload"
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
      "○",

    className:
      "muted"
  };
}


/* =====================================================================
   20. INGESTION STATUS BADGES
===================================================================== */

/**
 * Converts the ingestion journal status into a styled badge.
 */
function renderStatusBadge(
  status
) {

  const normalised =
    normaliseStatus(
      status
    );


  const configuration =
    getStatusConfiguration(
      normalised
    );


  return `
    <span
      class="admin-status-badge ${escapeHtml(
        configuration.className
      )}"
    >
      ${escapeHtml(
        configuration.label
      )}
    </span>
  `;
}


/**
 * Returns display configuration for one ingestion status.
 */
function getStatusConfiguration(
  status
) {

  const statuses =
  {
    pending:
      {
        label:
          "Pending",

        className:
          "pending"
      },

    analysing:
      {
        label:
          "Analysing",

        className:
          "active"
      },

    ready:
      {
        label:
          "Ready",

        className:
          "ready"
      },

    uploading:
      {
        label:
          "Uploading",

        className:
          "active"
      },

    video_uploaded:
      {
        label:
          "Video Uploaded",

        className:
          "active"
      },

    cataloguing:
      {
        label:
          "Cataloguing",

        className:
          "active"
      },

    catalogued:
      {
        label:
          "Catalogued",

        className:
          "active"
      },

    thumbnail_uploading:
      {
        label:
          "Thumbnail Uploading",

        className:
          "active"
      },

    complete:
      {
        label:
          "Complete",

        className:
          "complete"
      },

    complete_without_thumbnail:
      {
        label:
          "No Thumbnail",

        className:
          "warning"
      },

    failed:
      {
        label:
          "Failed",

        className:
          "failed"
      },

    cancelled:
      {
        label:
          "Cancelled",

        className:
          "cancelled"
      },

    duplicate:
      {
        label:
          "Duplicate",

        className:
          "duplicate"
      }
  };


  return statuses[
    status
  ] || {
    label:
      humaniseStatus(
        status
      ),

    className:
      "pending"
  };
}


/* =====================================================================
   21. COMPONENT STATE RENDERING
===================================================================== */

/**
 * Renders the compact Video / Catalogue / Thumbnail state used by the
 * Recent Ingestions table.
 */
function renderState(
  state
) {

  return `
    <span
      class="admin-component-state ${escapeHtml(
        state.className
      )}"
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
   22. INGESTION DETAIL HELPERS
===================================================================== */

/**
 * Renders one item inside an expanded ingestion diagnostics row.
 *
 * Empty values are still displayed as "—" so the Admin page makes it
 * obvious which ingestion metadata has not been populated.
 */
function detailItem(
  label,
  value
) {

  const displayValue =
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
      ? "—"
      : value;


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
   23. DASHBOARD STATUS
===================================================================== */

/**
 * Updates the main dashboard status banner.
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
    "loading",
    "success",
    "error"
  );


  adminStatus.classList.add(
    state
  );
}


/**
 * Sets the refresh button's busy state.
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


  const icon =
    adminRefresh.querySelector(
      "svg"
    );


  if (
    icon
  ) {

    icon.classList.toggle(
      "admin-spin",
      loading
    );
  }
}


/* =====================================================================
   24. TABLE ERROR STATE
===================================================================== */

/**
 * Displays an error in the Recent Ingestions table if the main Admin
 * dashboard request fails.
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
          class="admin-table-empty admin-table-error"
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
   25. BASIC DOM HELPERS
===================================================================== */

/**
 * Writes a formatted number into a dashboard element.
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


  element.textContent =
    Number.isFinite(
      number
    )
      ? number.toLocaleString()
      : "0";
}


/**
 * Writes text into an element.
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
    value ===
      null ||
    value ===
      undefined
      ? ""
      : String(
          value
        );
}


/* =====================================================================
   26. STATUS NORMALISATION
===================================================================== */

/**
 * Converts a status value into the lowercase underscore format used by
 * the ingestion journal.
 */
function normaliseStatus(
  status
) {

  return String(
    status ||
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
 * Converts an internal status string into a human-readable fallback.
 */
function humaniseStatus(
  status
) {

  const text =
    String(
      status ||
      "Unknown"
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


  return text
    .split(
      " "
    )
    .map(
      word =>
        word
          ? word[0].toUpperCase() +
            word.slice(
              1
            )
          : ""
    )
    .join(
      " "
    );
}


/* =====================================================================
   27. FILENAME HELPERS
===================================================================== */

/**
 * Removes a final .mp4 extension from a filename for display purposes.
 */
function stripMp4Extension(
  filename
) {

  if (
    !filename
  ) {

    return "";
  }


  return String(
    filename
  ).replace(
    /\.mp4$/i,
    ""
  );
}


/* =====================================================================
   28. DATE / TIME FORMATTING
===================================================================== */

/**
 * Converts an ISO timestamp into a compact local date/time.
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


/* =====================================================================
   29. FILESIZE FORMATTING
===================================================================== */

/**
 * Converts bytes into a readable storage value.
 */
function formatBytes(
  bytes
) {

  const number =
    Number(
      bytes
    );


  if (
    !Number.isFinite(
      number
    ) ||
    number < 0
  ) {

    return "—";
  }


  if (
    number === 0
  ) {

    return "0 B";
  }


  const units =
    [
      "B",
      "KB",
      "MB",
      "GB",
      "TB"
    ];


  const base =
    1024;


  const index =
    Math.min(
      Math.floor(
        Math.log(
          number
        ) /
        Math.log(
          base
        )
      ),
      units.length -
        1
    );


  const value =
    number /
    Math.pow(
      base,
      index
    );


  return `${
    value >= 100 ||
    index === 0
      ? value.toFixed(
          0
        )
      : value.toFixed(
          2
        )
  } ${units[index]}`;
}


/* =====================================================================
   30. HTML ESCAPING
===================================================================== */

/**
 * Escapes arbitrary values before inserting them into generated HTML.
 *
 * This is important because film titles, filenames, URLs, error messages
 * and other ingestion metadata can contain HTML-significant characters.
 */
function escapeHtml(
  value
) {

  return String(
    value ??
    ""
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

