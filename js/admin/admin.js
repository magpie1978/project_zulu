import {
  supabase
} from "../supabaseClient.js";

import {
  initialiseVideoHealth,
  loadVideoHealth,
  renderVideoHealth,
  setVideoHealthLoadingState,
  renderVideoHealthError
} from "./admin-video-health.js";

import {
  initialiseThumbnailHealth,
  loadThumbnailHealth,
  renderThumbnailHealth,
  setThumbnailLoadingState,
  renderThumbnailHealthError
} from "./admin-thumbnail-health.js";

import {
  initialiseIntegrity,
  renderCatalogueIntegrity
} from "./admin-integrity.js";

import {
  renderRecentIngestions,
  renderIngestionsError
} from "./admin-ingestions.js";

import {
  loadAdminDashboard
} from "./admin-api.js";

import {
  setNumber
} from "./admin-utils.js";


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


  /* -------------------------------------------------------------------
     CANDIDATES
  ------------------------------------------------------------------- */

  initialiseCandidates();


  await refreshAdmin();

  await loadCandidates();

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
   CANDIDATES
===================================================================== */

const candidatesGrid =
  document.getElementById("admin-candidates-grid");

const candidatesStatus =
  document.getElementById("admin-candidates-status");

const candidatesTotal =
  document.getElementById("admin-candidates-total");

const candidatesTabCount =
  document.getElementById("admin-candidates-tab-count");

const candidatesRefresh =
  document.getElementById("admin-candidates-refresh");

const candidatesPagination =
  document.getElementById("admin-candidates-pagination");

const candidatesPrev =
  document.getElementById("admin-candidates-prev");

const candidatesNext =
  document.getElementById("admin-candidates-next");

const candidatesPageLabel =
  document.getElementById("admin-candidates-page");

const candidateApprovalModal =
  document.getElementById(
    "admin-candidate-approval-modal"
  );

const candidateApprovalClose =
  document.getElementById(
    "admin-candidate-approval-close"
  );

const candidateApprovalCancel =
  document.getElementById(
    "admin-candidate-approval-cancel"
  );

const candidateApprovalForm =
  document.getElementById(
    "admin-candidate-approval-form"
  );

const candidateApprovalId =
  document.getElementById(
    "admin-candidate-approval-id"
  );

const candidateApprovalFilm =
  document.getElementById(
    "admin-candidate-approval-film"
  );

const candidateApprovalActors =
  document.getElementById(
    "admin-candidate-approval-actors"
  );

const candidateApprovalTags =
  document.getElementById(
    "admin-candidate-approval-tags"
  );

const candidateApprovalPreview =
  document.getElementById(
    "admin-candidate-approval-preview"
  );

const candidateApprovalError =
  document.getElementById(
    "admin-candidate-approval-error"
  );

const candidateApprovalSubmit =
  document.getElementById(
    "admin-candidate-approval-submit"
  );


let candidateApprovalRow =
  null;

const candidateFilters =
  Array.from(
    document.querySelectorAll("[data-candidate-status]")
  );

const CANDIDATES_PAGE_SIZE = 48;

let candidatesPage = 0;
let candidatesCurrentStatus = "pending";
let candidatesCount = 0;


function initialiseCandidates() {

  candidatesRefresh?.addEventListener(
    "click",
    () => loadCandidates()
  );

  candidatesPrev?.addEventListener(
    "click",
    () => {
      if (candidatesPage > 0) {
        candidatesPage--;
        loadCandidates();
      }
    }
  );

  candidatesNext?.addEventListener(
    "click",
    () => {

      const maxPage =
        Math.max(
          0,
          Math.ceil(
            candidatesCount /
            CANDIDATES_PAGE_SIZE
          ) - 1
        );

      if (
        candidatesPage <
        maxPage
      ) {

        candidatesPage++;

        loadCandidates();
      }
    }
  );


  candidateFilters.forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          candidatesCurrentStatus =
            button.dataset.candidateStatus;

          candidatesPage = 0;

          candidateFilters.forEach(
            item =>
              item.classList.toggle(
                "is-active",
                item === button
              )
          );

          loadCandidates();
        }
      );
    }
  );


  candidatesGrid?.addEventListener(
    "click",
    handleCandidateAction
  );

    candidateApprovalClose?.addEventListener(
    "click",
    closeCandidateApprovalModal
  );


  candidateApprovalCancel?.addEventListener(
    "click",
    closeCandidateApprovalModal
  );


  candidateApprovalModal?.addEventListener(
    "click",
    event => {

      if (
        event.target.closest(
          "[data-candidate-approval-close]"
        )
      ) {

        closeCandidateApprovalModal();
      }
    }
  );


  candidateApprovalForm?.addEventListener(
    "submit",
    submitCandidateApproval
  );


  document.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Escape" &&
        candidateApprovalModal &&
        !candidateApprovalModal.hidden
      ) {

        closeCandidateApprovalModal();
      }
    }
  );
}

async function loadCandidates() {

  if (
    !candidatesGrid ||
    !candidatesStatus
  ) {
    return;
  }


  setCandidatesLoading(
    true
  );


  const from =
    candidatesPage *
    CANDIDATES_PAGE_SIZE;


  const to =
    from +
    CANDIDATES_PAGE_SIZE -
    1;


  try {

    const {
      data,
      error,
      count
    } =
      await supabase
        .from(
          "zulu_candidates"
        )
        .select(
          `
            id,
            title,
            source_url,
            source_age,
            source_uploaded_at,
            thumbnail_url,
            status,
            first_seen_at,
            reviewed_at,
            import_film,
            import_actors,
            import_tags,
            import_status,
            imported_uid,
            ingestion_id,
            import_started_at,
            imported_at,
            import_error
          `,
          {
            count: "exact"
          }
        )
        .eq(
          "status",
          candidatesCurrentStatus
        )
        .order(
          "source_uploaded_at",
          {
            ascending: false,
            nullsFirst: false
          }
        )
        .range(
          from,
          to
        );


    if (error) {
      throw error;
    }


    candidatesCount =
      Number(count) || 0;


    renderCandidates(
      data || []
    );


    if (
      candidatesCurrentStatus ===
      "pending"
    ) {

      if (
        candidatesTotal
      ) {

        candidatesTotal.textContent =
          candidatesCount.toLocaleString();
      }


      if (
        candidatesTabCount
      ) {

        candidatesTabCount.textContent =
          candidatesCount.toLocaleString();
      }
    }


    updateCandidatesPagination();


    candidatesStatus.textContent =
      candidatesCount
        ? `${candidatesCount.toLocaleString()} ${candidatesCurrentStatus} candidate${candidatesCount === 1 ? "" : "s"}.`
        : `No ${candidatesCurrentStatus} candidates.`;


  } catch (
    error
  ) {

    console.error(
      "CANDIDATES ERROR:",
      error
    );


    candidatesGrid.innerHTML =
      "";


    candidatesStatus.textContent =
      `Could not load candidates: ${
        error?.message ||
        "Unknown error"
      }`;


    candidatesStatus.classList.add(
      "is-error"
    );


  } finally {

    setCandidatesLoading(
      false
    );


    window.lucide?.createIcons();
  }
}

function renderCandidates(
  rows
) {

  if (
    !candidatesGrid
  ) {
    return;
  }


  if (
    !rows.length
  ) {

    candidatesGrid.innerHTML = `
      <div class="admin-candidates-empty">
        No ${escapeCandidateHtml(
          candidatesCurrentStatus
        )} candidates to show.
      </div>
    `;

    return;
  }


  candidatesGrid.innerHTML =
    rows
      .map(
        row =>
          renderCandidateCard(
            row
          )
      )
      .join("");
}


function renderCandidateCard(
  row
) {

  const title =
    escapeCandidateHtml(
      row.title ||
      "Untitled"
    );


  const sourceUrl =
    escapeCandidateAttribute(
      row.source_url ||
      ""
    );


  const thumbnailUrl =
    escapeCandidateAttribute(
      row.thumbnail_url ||
      ""
    );


  const sourceAge =
    escapeCandidateHtml(
      row.source_age ||
      ""
    );


  const uploaded =
    formatCandidateDate(
      row.source_uploaded_at
    );


  const thumbnail =
    thumbnailUrl
      ? `
          <img
            src="${thumbnailUrl}"
            alt=""
            loading="lazy"
            referrerpolicy="no-referrer"
          >
        `
      : `
          <div class="admin-candidate-no-thumbnail">
            <i data-lucide="image-off"></i>
          </div>
        `;


  let actions =
    "";


  if (
    candidatesCurrentStatus ===
    "pending"
  ) {

    actions = `
      <button
        type="button"
        class="admin-candidate-action admin-candidate-accept"
        data-candidate-action="approve"
        data-candidate-id="${Number(
          row.id
        )}"
      >
        <i data-lucide="check"></i>
        <span>Accept</span>
      </button>

      <button
        type="button"
        class="admin-candidate-action admin-candidate-reject"
        data-candidate-action="rejected"
        data-candidate-id="${Number(
          row.id
        )}"
      >
        <i data-lucide="x"></i>
        <span>Reject</span>
      </button>
    `;

  } else {

    actions = `
      <button
        type="button"
        class="admin-candidate-action admin-candidate-restore"
        data-candidate-action="pending"
        data-candidate-id="${Number(
          row.id
        )}"
      >
        <i data-lucide="undo-2"></i>
        <span>Return to Pending</span>
      </button>
    `;
  }


  return `
    <article
      class="admin-candidate-card"
      data-candidate-card="${Number(
        row.id
      )}"
      data-candidate-title="${escapeCandidateAttribute(
        row.title || ""
      )}"
      data-candidate-thumbnail="${escapeCandidateAttribute(
        row.thumbnail_url || ""
      )}"
    >
      <a
        class="admin-candidate-thumbnail"
        href="${sourceUrl}"
        target="_blank"
        rel="noopener noreferrer"
        title="Open source page"
      >
        ${thumbnail}
      </a>

      <div class="admin-candidate-body">

        <h3 class="admin-candidate-title">
          ${title}
        </h3>

        <div class="admin-candidate-meta">

          ${
            uploaded
              ? `
                  <span>
                    <i data-lucide="calendar-clock"></i>
                    ${escapeCandidateHtml(
                      uploaded
                    )}
                  </span>
                `
              : ""
          }

          ${
            sourceAge
              ? `
                  <span>
                    <i data-lucide="clock-3"></i>
                    ${sourceAge}
                  </span>
                `
              : ""
          }

        </div>

        <div class="admin-candidate-actions">

          <a
            class="admin-candidate-source"
            href="${sourceUrl}"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i data-lucide="external-link"></i>
            <span>View Source</span>
          </a>

          ${actions}

        </div>

      </div>

    </article>
  `;
}

async function handleCandidateAction(
  event
) {

  const button =
    event.target.closest(
      "[data-candidate-action]"
    );


  if (
    !button
  ) {
    return;
  }


  const id =
    Number(
      button.dataset.candidateId
    );


  const action =
    button.dataset.candidateAction;


  if (
    !Number.isFinite(
      id
    )
  ) {
    return;
  }


  const card =
    button.closest(
      "[data-candidate-card]"
    );


  /* -------------------------------------------------------------------
     APPROVE
     -------------------------------------------------------------------

     Accept no longer writes directly to the database.

     It opens the approval form so film / actors / tags can be reviewed
     before the candidate enters the automated import queue.
  ------------------------------------------------------------------- */

  if (
    action === "approve"
  ) {

    await openCandidateApprovalModal(
      id
    );

    return;
  }


  /* -------------------------------------------------------------------
     SIMPLE STATUS CHANGES
  ------------------------------------------------------------------- */

  if (
    ![
      "pending",
      "rejected"
    ].includes(
      action
    )
  ) {
    return;
  }


  button.disabled =
    true;


  card?.classList.add(
    "is-updating"
  );


  try {

    const update = {

      status:
        action,

      reviewed_at:
        action === "pending"
          ? null
          : new Date().toISOString()

    };


    /*
     * Returning a candidate to Pending also removes it from the
     * not-yet-started import queue.
     *
     * Already imported/importing candidates are deliberately protected.
     */

    if (
      action === "pending"
    ) {

      const {
        data: currentCandidate,
        error: currentError
      } =
        await supabase
          .from(
            "zulu_candidates"
          )
          .select(
            `
              import_status
            `
          )
          .eq(
            "id",
            id
          )
          .single();


      if (
        currentError
      ) {
        throw currentError;
      }


      if (
        [
          "importing",
          "imported"
        ].includes(
          currentCandidate?.import_status
        )
      ) {

        throw new Error(
          `This candidate cannot be returned to Pending because its import status is "${currentCandidate.import_status}".`
        );
      }


      update.import_status =
        "not_started";

      update.import_film =
        null;

      update.import_actors =
        [];

      update.import_tags =
        [];

      update.import_error =
        null;
    }


    const {
      error
    } =
      await supabase
        .from(
          "zulu_candidates"
        )
        .update(
          update
        )
        .eq(
          "id",
          id
        );


    if (
      error
    ) {
      throw error;
    }


    await loadCandidates();


  } catch (
    error
  ) {

    console.error(
      "CANDIDATE UPDATE ERROR:",
      error
    );


    window.alert(
      `Could not update candidate: ${
        error?.message ||
        "Unknown error"
      }`
    );


    button.disabled =
      false;


    card?.classList.remove(
      "is-updating"
    );
  }
}

async function openCandidateApprovalModal(
  id
) {

  if (
    !candidateApprovalModal ||
    !candidateApprovalForm
  ) {
    return;
  }


  setCandidateApprovalError(
    ""
  );


  setCandidateApprovalLoading(
    true
  );


  candidateApprovalModal.hidden =
    false;


  document.body.classList.add(
    "admin-modal-open"
  );


  try {

    const {
      data,
      error
    } =
      await supabase
        .from(
          "zulu_candidates"
        )
        .select(
          `
            id,
            title,
            thumbnail_url,
            status,
            import_film,
            import_actors,
            import_tags,
            import_status,
            imported_uid,
            ingestion_id
          `
        )
        .eq(
          "id",
          id
        )
        .single();


    if (
      error
    ) {
      throw error;
    }


    if (
      !data
    ) {

      throw new Error(
        "Candidate could not be found."
      );
    }


    if (
      data.status !== "pending"
    ) {

      throw new Error(
        `Candidate is already "${data.status}".`
      );
    }


    if (
      [
        "importing",
        "imported"
      ].includes(
        data.import_status
      )
    ) {

      throw new Error(
        `Candidate import is already "${data.import_status}".`
      );
    }


    candidateApprovalRow =
      data;


    candidateApprovalId.value =
      String(
        data.id
      );


    candidateApprovalFilm.value =
      data.import_film ||
      data.title ||
      "";


    const suggestedActors =
      Array.isArray(
        data.import_actors
      ) &&
      data.import_actors.length
        ? data.import_actors
        : inferCandidateActors(
            data.title
          );


    candidateApprovalActors.value =
      suggestedActors.join(
        ", "
      );


    candidateApprovalTags.value =
      Array.isArray(
        data.import_tags
      )
        ? data.import_tags.join(
            ", "
          )
        : "";


    renderCandidateApprovalPreview(
      data
    );


    window.lucide?.createIcons();


    requestAnimationFrame(
      () => {

        candidateApprovalFilm?.focus();

        candidateApprovalFilm?.select();
      }
    );


  } catch (
    error
  ) {

    console.error(
      "CANDIDATE APPROVAL LOAD ERROR:",
      error
    );


    setCandidateApprovalError(
      error?.message ||
      "Could not load candidate."
    );


  } finally {

    setCandidateApprovalLoading(
      false
    );
  }
}


function closeCandidateApprovalModal() {

  if (
    !candidateApprovalModal
  ) {
    return;
  }


  candidateApprovalModal.hidden =
    true;


  document.body.classList.remove(
    "admin-modal-open"
  );


  candidateApprovalRow =
    null;


  candidateApprovalForm?.reset();


  setCandidateApprovalError(
    ""
  );


  setCandidateApprovalLoading(
    false
  );
}


async function submitCandidateApproval(
  event
) {

  event.preventDefault();


  if (
    !candidateApprovalRow
  ) {
    return;
  }


  const id =
    Number(
      candidateApprovalId?.value
    );


  const film =
    String(
      candidateApprovalFilm?.value ||
      ""
    ).trim();


  const actors =
    parseCandidateList(
      candidateApprovalActors?.value
    );


  const tags =
    parseCandidateList(
      candidateApprovalTags?.value
    );


  if (
    !Number.isFinite(
      id
    )
  ) {

    setCandidateApprovalError(
      "Invalid candidate ID."
    );

    return;
  }


  if (
    !film
  ) {

    setCandidateApprovalError(
      "Film title is required."
    );

    candidateApprovalFilm?.focus();

    return;
  }


  if (
    !actors.length
  ) {

    setCandidateApprovalError(
      "At least one actor is required."
    );

    candidateApprovalActors?.focus();

    return;
  }


  setCandidateApprovalError(
    ""
  );


  setCandidateApprovalLoading(
    true
  );


  try {

    const now =
      new Date().toISOString();


    const {
      error
    } =
      await supabase
        .from(
          "zulu_candidates"
        )
        .update(
          {
            status:
              "accepted",

            reviewed_at:
              now,

            import_film:
              film,

            import_actors:
              actors,

            import_tags:
              tags,

            import_status:
              "ready",

            import_started_at:
              null,

            imported_at:
              null,

            imported_uid:
              null,

            ingestion_id:
              null,

            import_error:
              null
          }
        )
        .eq(
          "id",
          id
        )
        .eq(
          "status",
          "pending"
        );


    if (
      error
    ) {
      throw error;
    }


    closeCandidateApprovalModal();


    await loadCandidates();


  } catch (
    error
  ) {

    console.error(
      "CANDIDATE APPROVAL ERROR:",
      error
    );


    setCandidateApprovalError(
      `Could not approve candidate: ${
        error?.message ||
        "Unknown error"
      }`
    );


    setCandidateApprovalLoading(
      false
    );
  }
}


function renderCandidateApprovalPreview(
  row
) {

  if (
    !candidateApprovalPreview
  ) {
    return;
  }


  const thumbnail =
    row.thumbnail_url
      ? `
          <img
            src="${escapeCandidateAttribute(
              row.thumbnail_url
            )}"
            alt=""
            referrerpolicy="no-referrer"
          >
        `
      : `
          <div class="admin-candidate-approval-no-thumbnail">
            <i data-lucide="image-off"></i>
          </div>
        `;


  candidateApprovalPreview.innerHTML = `
    <div class="admin-candidate-approval-preview-image">
      ${thumbnail}
    </div>

    <div class="admin-candidate-approval-preview-copy">

      <div class="admin-section-kicker">
        SOURCE TITLE
      </div>

      <div class="admin-candidate-approval-source-title">
        ${escapeCandidateHtml(
          row.title ||
          "Untitled"
        )}
      </div>

    </div>
  `;
}


function parseCandidateList(
  value
) {

  const seen =
    new Set();


  return String(
    value ||
    ""
  )
    .split(",")
    .map(
      item =>
        item.trim()
    )
    .filter(
      Boolean
    )
    .filter(
      item => {

        const key =
          item.toLocaleLowerCase();


        if (
          seen.has(
            key
          )
        ) {
          return false;
        }


        seen.add(
          key
        );


        return true;
      }
    );
}


function inferCandidateActors(
  title
) {

  const value =
    String(
      title ||
      ""
    ).trim();


  if (
    !value
  ) {
    return [];
  }


  /*
   * Actor A with Actor B
   * Actor A with Actor B & Actor C
   * Actor A with Actor B and Actor C
   */

  const withMatch =
    value.match(
      /^(.+?)\s+with\s+(.+)$/i
    );


  if (
    withMatch
  ) {

    const firstActor =
      withMatch[1].trim();


    const remainingActors =
      withMatch[2]
        .split(
          /\s*(?:&|\band\b)\s*/i
        )
        .map(
          actor =>
            actor.trim()
        )
        .filter(
          Boolean
        );


    return [
      firstActor,
      ...remainingActors
    ].filter(
      Boolean
    );
  }


  /*
   * Actor – description
   * Actor — description
   * Actor - description
   */

  const dashMatch =
    value.match(
      /^(.+?)\s+[–—-]\s+.+$/
    );


  if (
    dashMatch
  ) {

    const actor =
      dashMatch[1].trim();


    return actor
      ? [
          actor
        ]
      : [];
  }


  /*
   * Unknown title format.
   *
   * Do not guess. The reviewer must enter the actor manually.
   */

  return [];
}


function setCandidateApprovalError(
  message
) {

  if (
    !candidateApprovalError
  ) {
    return;
  }


  candidateApprovalError.textContent =
    message ||
    "";


  candidateApprovalError.hidden =
    !message;
}


function setCandidateApprovalLoading(
  loading
) {

  if (
    candidateApprovalSubmit
  ) {

    candidateApprovalSubmit.disabled =
      Boolean(
        loading
      );
  }


  if (
    candidateApprovalClose
  ) {

    candidateApprovalClose.disabled =
      Boolean(
        loading
      );
  }


  if (
    candidateApprovalCancel
  ) {

    candidateApprovalCancel.disabled =
      Boolean(
        loading
      );
  }


  if (
    candidateApprovalFilm
  ) {

    candidateApprovalFilm.disabled =
      Boolean(
        loading
      );
  }


  if (
    candidateApprovalActors
  ) {

    candidateApprovalActors.disabled =
      Boolean(
        loading
      );
  }


  if (
    candidateApprovalTags
  ) {

    candidateApprovalTags.disabled =
      Boolean(
        loading
      );
  }


  candidateApprovalModal?.classList.toggle(
    "is-loading",
    Boolean(
      loading
    )
  );
}


  function updateCandidatesPagination() {

  if (
    !candidatesPagination ||
    !candidatesPrev ||
    !candidatesNext ||
    !candidatesPageLabel
  ) {
    return;
  }


  const totalPages =
    Math.max(
      1,
      Math.ceil(
        candidatesCount /
        CANDIDATES_PAGE_SIZE
      )
    );


  if (
    candidatesPage >=
    totalPages
  ) {

    candidatesPage =
      totalPages - 1;
  }


  candidatesPagination.hidden =
    candidatesCount <=
    CANDIDATES_PAGE_SIZE;


  candidatesPrev.disabled =
    candidatesPage <= 0;


  candidatesNext.disabled =
    candidatesPage >=
    totalPages - 1;


  candidatesPageLabel.textContent =
    `Page ${candidatesPage + 1} of ${totalPages}`;
}


function setCandidatesLoading(
  loading
) {

  candidatesRefresh?.classList.toggle(
    "loading",
    loading
  );


  if (
    candidatesRefresh
  ) {

    candidatesRefresh.disabled =
      loading;
  }


  candidatesStatus?.classList.remove(
    "is-error"
  );


  if (
    loading &&
    candidatesStatus
  ) {

    candidatesStatus.textContent =
      "Loading candidates…";
  }
}


function formatCandidateDate(
  value
) {

  if (
    !value
  ) {
    return "";
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
    return "";
  }


  return date.toLocaleString(
    [],
    {
      dateStyle:
        "medium",

      timeStyle:
        "short"
    }
  );
}


function escapeCandidateHtml(
  value
) {

  return String(
    value ?? ""
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


function escapeCandidateAttribute(
  value
) {

  return escapeCandidateHtml(
    value
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
