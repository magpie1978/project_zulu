import {
  supabase
} from "../supabaseClient.js";


/* =====================================================================
   ADMIN VIDEO STORAGE HEALTH
   =====================================================================

   Extracted from admin.js without changing the Video Storage Health
   behaviour. This module owns:

       • zulu-video-health requests
       • storage-health rendering
       • diagnostic panels
       • orphaned MP4 confirmation/deletion

   ===================================================================== */


/* =====================================================================
   DOM REFERENCES
===================================================================== */

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


/* =====================================================================
   MODULE STATE
===================================================================== */

/**
 * Latest Video Storage Health reconciliation returned by
 * zulu-video-health.
 */
let currentVideoHealthData =
  null;


/* =====================================================================
   INITIALISATION
===================================================================== */

/**
 * Attaches the persistent Video Storage Health event handlers.
 *
 * This replaces the Video Storage Health-specific event setup that
 * previously lived inside initialiseAdmin().
 */
export function initialiseVideoHealth() {

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
}


/* =====================================================================
   VIDEO STORAGE HEALTH REQUEST
===================================================================== */

/**
 * Retrieves the catalogue ↔ Backblaze MP4 reconciliation from the
 * protected zulu-video-health Edge Function.
 */
export async function loadVideoHealth() {

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
   VIDEO STORAGE HEALTH RENDERING
===================================================================== */

/**
 * Stores and renders the latest catalogue ↔ Backblaze MP4
 * reconciliation.
 */
export function renderVideoHealth(
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
export function setVideoHealthLoadingState() {

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
export function renderVideoHealthError(
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
   VIDEO STORAGE HEALTH INTERACTION
===================================================================== */

/**
 * Opens one detailed Video Storage Health diagnostic collection.
 */
export function openVideoHealthResult(
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


  attachVideoOrphanDeleteEvents();


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

  const orphanDeleteAction =
    key === "orphaned" &&
    b2Filename &&
    row.file_id
      ? `
          <div class="admin-video-health-result-actions">

            <button
              type="button"
              class="admin-video-orphan-delete-button"
              data-video-orphan-file="${escapeHtml(
                b2Filename
              )}"
              data-video-orphan-file-id="${escapeHtml(
                row.file_id
              )}"
            >

              <i data-lucide="trash-2"></i>

              <span>
                Delete Orphan
              </span>

            </button>

          </div>


          <div
            class="admin-video-orphan-delete-status"
            hidden
          ></div>
        `
      : "";


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

      ${orphanDeleteAction}

    </div>
  `;
}


/**
 * Attaches protected deletion to orphaned MP4 rows.
 */
function attachVideoOrphanDeleteEvents() {

  document
    .querySelectorAll(
      ".admin-video-orphan-delete-button"
    )
    .forEach(
      button => {

        if (
          button.dataset.bound ===
            "true"
        ) {

          return;
        }


        button.dataset.bound =
          "true";


        button.addEventListener(
          "click",
          async () => {

            await deleteOrphanedVideo(
              button
            );
          }
        );
      }
    );
}


/**
 * Starts inline confirmation for deletion of one orphaned Backblaze MP4.
 *
 * Nothing is deleted at this stage.
 */
async function deleteOrphanedVideo(
  button
) {

  const fileName =
    button.dataset.videoOrphanFile ||
    "";


  const fileId =
    button.dataset.videoOrphanFileId ||
    "";


  const row =
    button.closest(
      ".admin-video-health-result"
    );


  const status =
    row?.querySelector(
      ".admin-video-orphan-delete-status"
    );


  if (
    !fileName ||
    !fileId ||
    !row
  ) {

    return;
  }


  /*
   * If this row already has a confirmation panel open,
   * do not create another one.
   */
  if (
    row.querySelector(
      ".admin-video-orphan-confirm"
    )
  ) {

    return;
  }


  /*
   * Hide the original Delete Orphan button while the
   * confirmation panel is displayed.
   */
  button.hidden =
    true;


  if (
    status
  ) {

    status.hidden =
      true;
  }


  const confirmation =
    document.createElement(
      "div"
    );


  confirmation.className =
    "admin-video-orphan-confirm";


  confirmation.innerHTML = `

    <div class="admin-video-orphan-confirm-heading">

      <i data-lucide="triangle-alert"></i>

      <span>
        Permanently delete this MP4?
      </span>

    </div>


    <div class="admin-video-orphan-confirm-text">

      This Backblaze object is not referenced by the catalogue.

      The server will check that again immediately before deletion.

    </div>


    <div class="admin-video-orphan-confirm-file">

      ${escapeHtml(
        fileName
      )}

    </div>


    <div class="admin-video-orphan-confirm-warning">

      This permanently deletes the exact B2 file version and cannot be undone.

    </div>


    <div class="admin-video-orphan-confirm-actions">

      <button
        type="button"
        class="admin-video-orphan-cancel-button"
      >

        Cancel

      </button>


      <button
        type="button"
        class="admin-video-orphan-confirm-button"
      >

        <i data-lucide="trash-2"></i>

        <span>
          Permanently Delete MP4
        </span>

      </button>

    </div>
  `;


  const actions =
    row.querySelector(
      ".admin-video-health-result-actions"
    );


  actions?.insertAdjacentElement(
    "afterend",
    confirmation
  );


  const cancelButton =
    confirmation.querySelector(
      ".admin-video-orphan-cancel-button"
    );


  const confirmButton =
    confirmation.querySelector(
      ".admin-video-orphan-confirm-button"
    );


  cancelButton?.addEventListener(
    "click",
    () => {

      confirmation.remove();


      button.hidden =
        false;


      window.lucide?.createIcons();
    }
  );


  confirmButton?.addEventListener(
    "click",
    async () => {

      await performOrphanedVideoDeletion(
        confirmButton,
        fileName,
        fileId,
        row,
        status
      );
    }
  );


  window.lucide?.createIcons();
}


/**
 * Performs the actual protected orphan deletion.
 *
 * zulu-video-health independently:
 *
 *   • rechecks the current catalogue
 *   • confirms the MP4 is still unreferenced
 *   • looks up the exact Backblaze object
 *   • confirms the exact B2 file ID
 *   • deletes only that exact file version
 */
async function performOrphanedVideoDeletion(
  confirmButton,
  fileName,
  fileId,
  row,
  status
) {

  const cancelButton =
    row.querySelector(
      ".admin-video-orphan-cancel-button"
    );


  confirmButton.disabled =
    true;


  if (
    cancelButton
  ) {

    cancelButton.disabled =
      true;
  }


  confirmButton.innerHTML = `
    <i data-lucide="loader-circle"></i>

    <span>
      Deleting…
    </span>
  `;


  if (
    status
  ) {

    status.hidden =
      false;


    status.className =
      "admin-video-orphan-delete-status is-working";


    status.textContent =
      "Rechecking catalogue and exact Backblaze file version…";
  }


  window.lucide?.createIcons();


  try {

    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        "zulu-video-health",
        {
          body: {

            action:
              "delete_orphan",

            file_name:
              fileName,

            file_id:
              fileId
          }
        }
      );


    if (
      error
    ) {

      throw new Error(
        error.message ||
        "Orphan deletion request failed."
      );
    }


    if (
      !data ||
      data.success !== true
    ) {

      throw new Error(
        data?.error ||
        "The orphaned MP4 could not be deleted."
      );
    }


    if (
      status
    ) {

      status.className =
        "admin-video-orphan-delete-status is-success";


      status.textContent =
        "MP4 deleted. Refreshing Video Storage Health…";
    }


    /*
     * Obtain a completely fresh reconciliation from the backend.
     */
    const refreshed =
      await loadVideoHealth();


    renderVideoHealth(
      refreshed
    );


    /*
     * renderVideoHealth() deliberately closes stale diagnostic
     * results. Reopen Orphaned Videos from the new snapshot.
     */
    openVideoHealthResult(
      "orphaned"
    );


  } catch (
    error
  ) {

    console.error(
      "ORPHANED VIDEO DELETE ERROR:",
      error
    );


    confirmButton.disabled =
      false;


    if (
      cancelButton
    ) {

      cancelButton.disabled =
        false;
    }


    confirmButton.innerHTML = `
      <i data-lucide="trash-2"></i>

      <span>
        Try Delete Again
      </span>
    `;


    if (
      status
    ) {

      status.hidden =
        false;


      status.className =
        "admin-video-orphan-delete-status is-error";


      status.textContent =
        error?.message ||
        "Could not delete orphaned MP4.";
    }


    window.lucide?.createIcons();
  }
}


/* =====================================================================
   LOCAL DISPLAY HELPERS
===================================================================== */

/**
 * Writes a value to an element without throwing if the element does
 * not exist.
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
    value ??
    "";
}


/**
 * Writes a locale-formatted number to an element.
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
 * Formats a byte count for diagnostic display.
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
    value < 0
  ) {

    return "—";
  }


  if (
    value === 0
  ) {

    return "0 B";
  }


  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB"
  ];


  const unitIndex =
    Math.min(
      Math.floor(
        Math.log(
          value
        ) /
        Math.log(
          1024
        )
      ),
      units.length - 1
    );


  const size =
    value /
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


/**
 * Formats a timestamp for diagnostic display.
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


  return date.toLocaleString();
}


/**
 * Escapes arbitrary values before inserting them into innerHTML.
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
   END OF ADMIN-VIDEO-HEALTH.JS
===================================================================== */
