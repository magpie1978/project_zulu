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

import {
  renderRecentIngestions,
  renderIngestionsError
} from "../admin/admin-ingestions.js";

import {
  loadAdminDashboard
} from "../admin/admin-api.js";

import {
  setNumber
} from "../admin/admin-utils.js";


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


      renderIngestionsError(
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


    renderIngestionsError(
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
   END OF ADMIN.JS
===================================================================== */
