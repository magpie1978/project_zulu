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

   Actual Backblaze thumbnail storage health is retrieved separately
   through:

       zulu-thumbnail-health

   The separation is deliberate.

   If Backblaze is temporarily unavailable, the main Admin dashboard can
   continue to load normally and Thumbnail Health can report its own
   independent error state.

   The dashboard provides:

       • catalogue video count
       • actor count
       • total video views
       • ingestion count
       • ingestion health summary
       • Catalogue Integrity diagnostics
       • metadata coverage diagnostics
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

   Thumbnail Health checks:

       • expected thumbnails
       • present thumbnails
       • missing thumbnails
       • orphaned thumbnails
       • invalid thumbnail filenames

   Backblaze application credentials are NEVER exposed to this browser
   code. All B2 operations occur inside zulu-thumbnail-health.

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
   * Refresh both the Supabase dashboard and Backblaze thumbnail health.
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
 * This is NOT the security boundary for either Edge Function.
 *
 * zulu-admin-dashboard and zulu-thumbnail-health independently verify
 * the authenticated user's JWT and can independently enforce
 * ZULU_ADMIN_EMAIL before accessing protected resources.
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
 * Two independent server-side requests are made:
 *
 *     1. zulu-admin-dashboard
 *     2. zulu-thumbnail-health
 *
 * Promise.allSettled() is used intentionally.
 *
 * This means a Backblaze problem does not prevent catalogue,
 * ingestion and Supabase health information from loading.
 */
async function refreshAdmin() {

  setRefreshState(
    true
  );


  setStatus(
    "Loading library health…",
    "loading"
  );


  setThumbnailLoadingState();


  try {

    /*
     * First confirm that the browser still has an authenticated
     * Supabase user.
     */
    const user =
      await requireAuthenticatedUser();


    if (
      !user
    ) {

      return;
    }


    /*
     * Run the Supabase dashboard and Backblaze thumbnail reconciliation
     * concurrently.
     */
    const [
      dashboardResult,
      thumbnailResult
    ] =
      await Promise.allSettled([
        loadAdminDashboard(),
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
     * unexpected error outside the two independent health requests.
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
   06. THUMBNAIL HEALTH REQUEST
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
   07. LIBRARY SUMMARY
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
   08. INGESTION HEALTH
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
   09. THUMBNAIL HEALTH
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
   10. THUMBNAIL HEALTH INTERACTION
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
   11. THUMBNAIL RESULT RENDERING
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
   12. CATALOGUE INTEGRITY
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
   13. CATALOGUE INTEGRITY INTERACTION
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
   14. CATALOGUE INTEGRITY RESULT RENDERING
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
   15. RECENT INGESTIONS TABLE
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
   16. INGESTION EXPAND / COLLAPSE
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
   17. INGESTION COMPONENT STATES
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
    ingestion.video_uid != null ||
    ingestion.catalogued_at
  ) {

    return {
      label:
        ingestion.video_uid != null
          ? `UID ${ingestion.video_uid}`
          : "Catalogued",

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
    ingestion.failed_stage ===
      "catalogue"
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
 * This is different from the new Thumbnail Health reconciliation.
 *
 * This function describes what happened during this particular
 * ingestion. zulu-thumbnail-health separately checks whether the
 * thumbnail ACTUALLY exists in Backblaze right now.
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
        "thumbnail-generation"
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
   18. STATUS BADGES
===================================================================== */

/**
 * Renders the main ingestion status badge.
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
        admin-status-${escapeHtml(
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
 * Maps an ingestion status to its display label and visual category.
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
          "good"
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
          "bad"
      };


    case "cancelled":

      return {
        label:
          "Cancelled",

        className:
          "muted"
      };


    case "duplicate":

      return {
        label:
          "Duplicate",

        className:
          "muted"
      };


    case "pending":

      return {
        label:
          "Pending",

        className:
          "muted"
      };


    case "analysing":

      return {
        label:
          "Analysing",

        className:
          "active"
      };


    case "ready":

      return {
        label:
          "Ready",

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
          "muted"
      };
  }
}


/* =====================================================================
   19. COMPONENT STATE RENDERING
===================================================================== */

/**
 * Renders a Video / Catalogue / Thumbnail component state.
 */
function renderState(
  state
) {

  return `
    <span
      class="
        admin-component-state
        admin-component-${escapeHtml(
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
   20. INGESTION DETAIL HELPERS
===================================================================== */

/**
 * Renders one item inside the expanded ingestion diagnostics grid.
 *
 * Empty values are still displayed as an em dash so the structure of
 * each ingestion record remains consistent.
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
   21. TABLE ERROR STATE
===================================================================== */

/**
 * Displays a dashboard failure inside the Recent Ingestions table.
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
   22. PAGE STATUS
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
   23. REFRESH BUTTON STATE
===================================================================== */

/**
 * Enables or disables the Refresh button while dashboard requests are
 * running.
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
   24. BASIC DOM HELPERS
===================================================================== */

/**
 * Sets plain text on an element if the element exists.
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
   25. STATUS / TEXT NORMALISATION
===================================================================== */

/**
 * Converts a status value into the lowercase underscore format used by
 * the ingestion state machine.
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
 * Converts an internal status into a readable label.
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
 * Removes a trailing .mp4 extension from an ingestion filename.
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
   26. DATE / TIME FORMATTING
===================================================================== */

/**
 * Formats an ISO timestamp for display in the Admin interface.
 *
 * Invalid or missing timestamps are displayed as an em dash.
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
   27. FILESIZE FORMATTING
===================================================================== */

/**
 * Converts a byte count into a compact human-readable filesize.
 *
 * This is used by both ingestion diagnostics and Thumbnail Health
 * orphan/invalid object diagnostics.
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


  const units =
    [
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


  return `${
    size.toFixed(
      decimals
    )
  } ${
    units[
      unitIndex
    ]
  }`;
}


/* =====================================================================
   28. HTML ESCAPING
===================================================================== */

/**
 * Escapes untrusted values before inserting them into generated HTML.
 *
 * Catalogue titles, filenames, URLs, fingerprints, B2 IDs and error
 * messages can all contain characters that have meaning in HTML.
 *
 * Never interpolate those values directly without escaping them.
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
