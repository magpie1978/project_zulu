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
} from "../zulu/thumbnails.js";


/* =====================================================================
   ADMIN THUMBNAIL HEALTH
===================================================================== */

const adminStatus =
  document.getElementById(
    "admin-status"
  );


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


let currentThumbnailData =
  null;


let repairingThumbnailUid =
  null;


/**
 * Connects the persistent Thumbnail Health controls.
 */
export function initialiseThumbnailHealth() {

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


  initialiseThumbnailReevaluation();
}

/* =====================================================================
   THUMBNAIL HEALTH REQUEST
===================================================================== */

/**
 * Retrieves the actual thumbnail inventory from Backblaze through the
 * protected zulu-thumbnail-health Edge Function.
 *
 * The browser receives reconciliation results only.
 *
 * It never receives Backblaze credentials or direct B2 API tokens.
 */
export async function loadThumbnailHealth() {

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


/* -------------------------------------------------------------------
   THUMBNAIL HEALTH
------------------------------------------------------------------- */

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
export function renderThumbnailHealth(
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
export function setThumbnailLoadingState() {

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
export function renderThumbnailHealthError(
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
   THUMBNAIL HEALTH INTERACTION
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
 * Starts the inline confirmation flow for one orphaned thumbnail.
 *
 * This deliberately avoids window.confirm().
 */
function deleteOrphanedThumbnail(
  uid,
  button
) {

  if (
    deletingThumbnailUid !==
      null
  ) {

    return;
  }


  const orphanRows =
    currentThumbnailData
      ?.orphaned
      ?.rows ||
    [];


  const item =
    orphanRows.find(
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

    setStatus(
      `Could not find orphaned thumbnail UID ${uid}.`,
      "error"
    );


    return;
  }


  const fileName =
    item.file_name ||
    "";


  const fileId =
    item.file_id ||
    "";


  if (
    !fileName ||
    !fileId
  ) {

    setThumbnailDeleteStatus(
      uid,
      "The orphaned thumbnail is missing its exact Backblaze filename or file ID.",
      "error"
    );


    return;
  }


  const row =
    document.querySelector(
      `[data-thumbnail-orphan-row="${cssEscapeValue(
        uid
      )}"]`
    );


  if (
    !row
  ) {

    return;
  }


  /*
   * Do not create a second confirmation panel if one is already open.
   */
  if (
    row.querySelector(
      ".admin-thumbnail-delete-confirm"
    )
  ) {

    return;
  }


  const confirmation =
    document.createElement(
      "div"
    );


  confirmation.className =
    "admin-thumbnail-delete-confirm";


  confirmation.innerHTML =
    `
      <div class="admin-thumbnail-delete-confirm-message">

        <strong>
          Delete this orphaned thumbnail?
        </strong>

        <div>
          This will permanently delete the exact Backblaze file version:
        </div>

        <div class="admin-thumbnail-file">
          ${escapeHtml(
            fileName
          )}
        </div>

      </div>


      <div class="admin-thumbnail-delete-confirm-actions">

        <button
          type="button"
          class="admin-thumbnail-delete-confirm-button"
          data-thumbnail-delete-confirm="${escapeHtml(
            uid
          )}"
        >
          <i data-lucide="trash-2"></i>
          <span>Confirm Delete</span>
        </button>


        <button
          type="button"
          class="admin-thumbnail-delete-cancel-button"
          data-thumbnail-delete-cancel="${escapeHtml(
            uid
          )}"
        >
          Cancel
        </button>

      </div>
    `;


  row.appendChild(
    confirmation
  );


  const confirmButton =
    confirmation.querySelector(
      `[data-thumbnail-delete-confirm="${cssEscapeValue(
        uid
      )}"]`
    );


  const cancelButton =
    confirmation.querySelector(
      `[data-thumbnail-delete-cancel="${cssEscapeValue(
        uid
      )}"]`
    );


  confirmButton?.addEventListener(
    "click",
    () => {

      performOrphanedThumbnailDeletion(
        item,
        button,
        confirmation
      );
    },
    {
      once: true
    }
  );


  cancelButton?.addEventListener(
    "click",
    () => {

      confirmation.remove();


      setThumbnailDeleteStatus(
        uid,
        "Deletion cancelled.",
        ""
      );
    },
    {
      once: true
    }
  );


  window.lucide?.createIcons();
}


/**
 * Performs the protected orphan-thumbnail deletion.
 *
 * The browser supplies the candidate UID, filename and exact B2 file ID.
 *
 * zulu-thumbnail-health is responsible for:
 *
 *   • authenticating the Admin
 *   • rechecking that the UID is absent from zulu_videos
 *   • looking up the exact B2 object
 *   • verifying the exact B2 file ID
 *   • deleting only that exact file version
 */
async function performOrphanedThumbnailDeletion(
  item,
  button,
  confirmation
) {

  const uid =
    Number(
      item.uid
    );


  if (
    deletingThumbnailUid !==
      null
  ) {

    return;
  }


  deletingThumbnailUid =
    uid;


  setAllThumbnailDeleteButtonsDisabled(
    true
  );


  confirmation
    ?.querySelectorAll(
      "button"
    )
    .forEach(
      element => {

        element.disabled =
          true;
      }
    );


  if (
    button
  ) {

    button.disabled =
      true;


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
        <span>Deleting…</span>
      `;
  }


  setThumbnailDeleteStatus(
    uid,
    "Revalidating orphan and deleting exact Backblaze file version…",
    "working"
  );


  window.lucide?.createIcons();


  try {

    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        "zulu-thumbnail-health",
        {
          body: {
            action:
              "delete_orphan",

            uid,

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
        `Could not delete orphaned thumbnail: ${
          error.message ||
          "Edge Function request failed"
        }`
      );
    }


    if (
      !data
    ) {

      throw new Error(
        "Thumbnail deletion returned no data."
      );
    }


    if (
      data.success !== true
    ) {

      throw new Error(
        data.error ||
        "Thumbnail deletion was unsuccessful."
      );
    }


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
          <span>Deleted</span>
        `;
    }


    setThumbnailDeleteStatus(
      uid,
      "Orphaned thumbnail deleted. Refreshing Thumbnail Health…",
      "success"
    );


    window.lucide?.createIcons();


    /*
     * Do not trust the deletion response alone.
     *
     * Re-run the complete reconciliation and ensure the deleted object
     * disappears from the orphan list.
     */
    const refreshed =
      await loadThumbnailHealth();


    const stillOrphaned =
      refreshed
        ?.orphaned
        ?.rows
        ?.some(
          row =>
            String(
              row.file_id
            ) ===
              String(
                item.file_id
              ) ||
            String(
              row.file_name
            ) ===
              String(
                item.file_name
              )
        );


    if (
      stillOrphaned
    ) {

      throw new Error(
        "Backblaze reported the deletion as successful, but Thumbnail Health still reports the object as orphaned."
      );
    }


    renderThumbnailHealth(
      refreshed
    );


    openThumbnailResult(
      "orphaned"
    );


    setStatus(
      `Deleted orphaned thumbnail UID ${uid}.`,
      "success"
    );


  } catch (
    error
  ) {

    console.error(
      "ORPHANED THUMBNAIL DELETE FAILED:",
      error
    );


    confirmation
      ?.remove();


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
          <span>Retry Delete</span>
        `;


      button.disabled =
        false;
    }


    setThumbnailDeleteStatus(
      uid,
      error?.message ||
      "Could not delete orphaned thumbnail.",
      "error"
    );


    setStatus(
      `Could not delete orphaned thumbnail UID ${uid}: ${
        error?.message ||
        "Unknown error"
      }`,
      "error"
    );


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
 * Enables or disables all currently-rendered orphan deletion buttons.
 *
 * A button whose row does not contain an exact filename and B2 file ID
 * remains disabled.
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

        const uid =
          Number(
            button.dataset
              .thumbnailDeleteUid
          );


        const item =
          currentThumbnailData
            ?.orphaned
            ?.rows
            ?.find(
              row =>
                Number(
                  row.uid
                ) ===
                uid
            );


        const canDelete =
          Number.isInteger(
            uid
          ) &&
          uid > 0 &&
          Boolean(
            item?.file_name
          ) &&
          Boolean(
            item?.file_id
          );


        button.disabled =
          disabled ||
          !canDelete;
      }
    );
}


/**
 * Displays progress or error information for one orphan deletion.
 */
function setThumbnailDeleteStatus(
  uid,
  message,
  state =
    "working"
) {

  const element =
    document.querySelector(
      `[data-thumbnail-delete-status="${cssEscapeValue(
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


  if (
    state
  ) {

    element.classList.add(
      `is-${state}`
    );
  }
}


/* =====================================================================
   MODULE-LOCAL HELPERS
===================================================================== */

/**
 * Updates the main Admin page status message.
 *
 * Kept local during the first structural refactor so Thumbnail Health
 * does not depend on a shared utility module yet.
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


/**
 * Converts a byte count to a compact human-readable filesize.
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
   THUMBNAIL RE-EVALUATION
===================================================================== */

/*
 * Allows existing thumbnails to be run through the current
 * face-aware thumbnail generator without automatically replacing them.
 *
 * The reviewer explicitly chooses either:
 *
 *     Keep Current
 *     Use New
 *
 * Only one video's candidates are held at a time because thumbnails.js
 * maintains shared candidate state.
 */


const thumbnailReevaluateStart =
  document.getElementById(
    "admin-thumbnail-reevaluate-start"
  );


const thumbnailReevaluatePanel =
  document.getElementById(
    "admin-thumbnail-reevaluate-panel"
  );


const thumbnailReevaluateFilm =
  document.getElementById(
    "admin-thumbnail-reevaluate-film"
  );


const thumbnailReevaluateCurrent =
  document.getElementById(
    "admin-thumbnail-reevaluate-current"
  );


const thumbnailReevaluateSuggested =
  document.getElementById(
    "admin-thumbnail-reevaluate-suggested"
  );


const thumbnailReevaluateDetail =
  document.getElementById(
    "admin-thumbnail-reevaluate-detail"
  );


const thumbnailReevaluatePrevious =
  document.getElementById(
    "admin-thumbnail-reevaluate-prev"
  );


const thumbnailReevaluateNext =
  document.getElementById(
    "admin-thumbnail-reevaluate-next"
  );


const thumbnailReevaluateKeep =
  document.getElementById(
    "admin-thumbnail-reevaluate-keep"
  );


const thumbnailReevaluateUse =
  document.getElementById(
    "admin-thumbnail-reevaluate-use"
  );


const thumbnailReevaluateStop =
  document.getElementById(
    "admin-thumbnail-reevaluate-stop"
  );


const thumbnailReevaluateStatus =
  document.getElementById(
    "admin-thumbnail-reevaluate-status"
  );


let thumbnailReevaluationQueue =
  [];


let thumbnailReevaluationIndex =
  -1;


let thumbnailReevaluationRunning =
  false;


let thumbnailReevaluationBusy =
  false;


let thumbnailReevaluationPreviewUrl =
  null;


/**
 * Connects the persistent re-evaluation controls.
 *
 * Called once by initialiseThumbnailHealth().
 */
function initialiseThumbnailReevaluation() {

  thumbnailReevaluateStart?.addEventListener(
    "click",
    startThumbnailReevaluation
  );


  thumbnailReevaluatePrevious?.addEventListener(
    "click",
    async () => {

      if (
        !thumbnailReevaluationRunning ||
        thumbnailReevaluationBusy
      ) {

        return;
      }


      try {

        selectPreviousThumbnailCandidate();

        refreshThumbnailReevaluationCandidate();


      } catch (
        error
      ) {

        setThumbnailReevaluationStatus(
          error?.message ||
            "Could not select the previous candidate.",
          "error"
        );
      }
    }
  );


  thumbnailReevaluateNext?.addEventListener(
    "click",
    async () => {

      if (
        !thumbnailReevaluationRunning ||
        thumbnailReevaluationBusy
      ) {

        return;
      }


      try {

        selectNextThumbnailCandidate();

        refreshThumbnailReevaluationCandidate();


      } catch (
        error
      ) {

        setThumbnailReevaluationStatus(
          error?.message ||
            "Could not select the next candidate.",
          "error"
        );
      }
    }
  );


  thumbnailReevaluateKeep?.addEventListener(
    "click",
    keepCurrentThumbnail
  );


  thumbnailReevaluateUse?.addEventListener(
    "click",
    useReevaluatedThumbnail
  );


  thumbnailReevaluateStop?.addEventListener(
    "click",
    stopThumbnailReevaluation
  );
}


/**
 * Begins a new review session.
 */
async function startThumbnailReevaluation() {

  if (
    thumbnailReevaluationRunning ||
    thumbnailReevaluationBusy
  ) {

    return;
  }


  setThumbnailReevaluationBusy(
    true
  );


  if (
    thumbnailReevaluatePanel
  ) {

    thumbnailReevaluatePanel.hidden =
      false;
  }


  setThumbnailReevaluationStatus(
    "Loading catalogue videos…"
  );


  try {

    /*
     * We deliberately request the catalogue here rather than deriving
     * the queue from Thumbnail Health.
     *
     * Thumbnail Health is primarily a reconciliation report and its
     * Missing collection does not represent videos which already have
     * thumbnails.
     */

    const {
      data,
      error
    } =
      await supabase
        .from(
          "zulu_videos"
        )
        .select(
          "uid, film, url"
        )
        .not(
          "url",
          "is",
          null
        )
        .order(
          "uid",
          {
            ascending: true
          }
        );


    if (
      error
    ) {

      throw new Error(
        `Could not load the video catalogue: ${
          error.message ||
          "Supabase request failed"
        }`
      );
    }


    thumbnailReevaluationQueue =
      (
        Array.isArray(
          data
        )
          ? data
          : []
      )
        .filter(
          item =>
            item &&
            item.uid != null &&
            item.url
        );


    if (
      !thumbnailReevaluationQueue.length
    ) {

      throw new Error(
        "No catalogue videos with video URLs were found."
      );
    }


    thumbnailReevaluationIndex =
      0;


    thumbnailReevaluationRunning =
      true;


    if (
      thumbnailReevaluateStart
    ) {

      thumbnailReevaluateStart.disabled =
        true;
    }


    if (
      thumbnailReevaluateStop
    ) {

      thumbnailReevaluateStop.disabled =
        false;
    }


    setThumbnailReevaluationBusy(
      false
    );


    await loadCurrentThumbnailReevaluationVideo();


  } catch (
    error
  ) {

    thumbnailReevaluationRunning =
      false;


    thumbnailReevaluationQueue =
      [];


    thumbnailReevaluationIndex =
      -1;


    setThumbnailReevaluationBusy(
      false
    );


    if (
      thumbnailReevaluateStart
    ) {

      thumbnailReevaluateStart.disabled =
        false;
    }


    if (
      thumbnailReevaluateStop
    ) {

      thumbnailReevaluateStop.disabled =
        true;
    }


    setThumbnailReevaluationStatus(
      error?.message ||
        "Could not start thumbnail review.",
      "error"
    );
  }
}


/**
 * Generates candidates for the video at the current queue position.
 */
async function loadCurrentThumbnailReevaluationVideo() {

  if (
    !thumbnailReevaluationRunning
  ) {

    return;
  }


  const item =
    thumbnailReevaluationQueue[
      thumbnailReevaluationIndex
    ];


  if (
    !item
  ) {

    finishThumbnailReevaluation();

    return;
  }


  setThumbnailReevaluationBusy(
    true
  );


  resetThumbnailState();


  clearThumbnailReevaluationPreview();


  const queueNumber =
    thumbnailReevaluationIndex +
    1;


  const queueTotal =
    thumbnailReevaluationQueue.length;


  if (
    thumbnailReevaluateFilm
  ) {

    thumbnailReevaluateFilm.textContent =
      `${item.film || `UID ${item.uid}`} · UID ${item.uid}`;
  }


  setThumbnailReevaluationStatus(
    `Analysing video ${queueNumber} of ${queueTotal}…`
  );


  /*
   * Existing thumbnail.
   *
   * The cache-busting parameter is important because an earlier review
   * may have replaced images/{uid}.png while the browser or Cloudflare
   * still has the previous image cached.
   */
  if (
    thumbnailReevaluateCurrent
  ) {

    thumbnailReevaluateCurrent.src =
      `https://media.zulu-orchid-falcon.co.uk/images/${
        encodeURIComponent(
          item.uid
        )
      }.png?review=${
        Date.now()
      }`;
  }


  try {

    /*
     * Reuse the same signing route already used by Missing Thumbnail
     * repair. This means the browser does not need direct B2 access.
     */

const signedVideoUrl =
  await getAdminSignedVideoUrl(
    item.url
  );

    await generateThumbnailCandidatesFromUrl(
      signedVideoUrl,
      {
        onStatus:
          message => {

            if (
              thumbnailReevaluationRunning
            ) {

              setThumbnailReevaluationStatus(
                `${queueNumber} of ${queueTotal} · ${message}`
              );
            }
          }
      }
    );


    if (
      !thumbnailReevaluationRunning
    ) {

      return;
    }


    refreshThumbnailReevaluationCandidate();


    setThumbnailReevaluationStatus(
      `Reviewing ${queueNumber} of ${queueTotal}.`
    );


  } catch (
    error
  ) {

    setThumbnailReevaluationStatus(
      `Could not analyse ${
        item.film ||
        `UID ${item.uid}`
      }: ${
        error?.message ||
        "Unknown error"
      }`,
      "error"
    );


  } finally {

    setThumbnailReevaluationBusy(
      false
    );
  }
}


/**
 * Refreshes the Suggested side from thumbnails.js's currently selected
 * candidate.
 */
function refreshThumbnailReevaluationCandidate() {

  const candidate =
    getSelectedThumbnailCandidate();


  const blob =
    getSelectedThumbnailBlob();


  if (
    !candidate ||
    !blob
  ) {

    throw new Error(
      "No thumbnail candidate is currently selected."
    );
  }


  if (
    thumbnailReevaluationPreviewUrl
  ) {

    URL.revokeObjectURL(
      thumbnailReevaluationPreviewUrl
    );
  }


  thumbnailReevaluationPreviewUrl =
    URL.createObjectURL(
      blob
    );


  if (
    thumbnailReevaluateSuggested
  ) {

    thumbnailReevaluateSuggested.src =
      thumbnailReevaluationPreviewUrl;
  }


const candidateNumber =
  Number(
    candidate.number ??
    1
  );


const candidateCount =
  Number(
    candidate.count ??
    15
  );

  const faceCount =
    Number(
      candidate.faceCount ??
      0
    );


  const time =
    Number(
      candidate.time ??
      0
    );


  if (
    thumbnailReevaluateDetail
  ) {

    thumbnailReevaluateDetail.textContent =
      `Candidate ${
        candidateNumber
      } of ${
        candidateCount
      } · ${
        faceCount
      } ${
        faceCount === 1
          ? "face"
          : "faces"
      } · ${
        Math.round(
          time
        )
      }s`;
  }
}
/**
 * Keeps the existing thumbnail and advances to the next video.
 *
 * No upload or database change is made.
 */
async function keepCurrentThumbnail() {

  if (
    !thumbnailReevaluationRunning ||
    thumbnailReevaluationBusy
  ) {

    return;
  }


  await advanceThumbnailReevaluation();
}


/**
 * Replaces images/{uid}.png with the currently selected candidate,
 * then advances to the next video.
 */
async function useReevaluatedThumbnail() {

  if (
    !thumbnailReevaluationRunning ||
    thumbnailReevaluationBusy
  ) {

    return;
  }


  const item =
    thumbnailReevaluationQueue[
      thumbnailReevaluationIndex
    ];


  if (
    !item
  ) {

    return;
  }


  const blob =
    getSelectedThumbnailBlob();


  if (
    !blob
  ) {

    setThumbnailReevaluationStatus(
      "No thumbnail candidate is selected.",
      "error"
    );

    return;
  }


  setThumbnailReevaluationBusy(
    true
  );


  setThumbnailReevaluationStatus(
    `Uploading replacement thumbnail for ${
      item.film ||
      `UID ${item.uid}`
    }…`
  );


  try {

    /*
     * Reuse the same upload path used by Missing Thumbnail repair.
     *
     * This replaces:
     *
     *     images/{uid}.png
     *
     * It does not modify the video or catalogue row.
     */
await uploadThumbnailToBackblaze(
  item.uid,
  blob,
  {
    onStatus:
      message => {

        setThumbnailReevaluationStatus(
          message
        );
      }
  }
);


    /*
     * Briefly refresh the Current image so the reviewer can see that
     * the replacement succeeded before we move on.
     */
    if (
      thumbnailReevaluateCurrent
    ) {

      thumbnailReevaluateCurrent.src =
        `https://media.zulu-orchid-falcon.co.uk/images/${
          encodeURIComponent(
            item.uid
          )
        }.png?review=${
          Date.now()
        }`;
    }


    setThumbnailReevaluationBusy(
      false
    );


    await advanceThumbnailReevaluation();


  } catch (
    error
  ) {

    setThumbnailReevaluationBusy(
      false
    );


    setThumbnailReevaluationStatus(
      `Could not replace thumbnail: ${
        error?.message ||
        "Unknown error"
      }`,
      "error"
    );
  }
}


/**
 * Moves to the next video in the review queue.
 */
async function advanceThumbnailReevaluation() {

  if (
    !thumbnailReevaluationRunning
  ) {

    return;
  }


  clearThumbnailReevaluationPreview();


  resetThumbnailState();


  thumbnailReevaluationIndex +=
    1;


  if (
    thumbnailReevaluationIndex >=
    thumbnailReevaluationQueue.length
  ) {

    finishThumbnailReevaluation();

    return;
  }


  await loadCurrentThumbnailReevaluationVideo();
}


/**
 * Stops the current review session without changing the currently
 * displayed thumbnail.
 */
function stopThumbnailReevaluation() {

  if (
    !thumbnailReevaluationRunning
  ) {

    return;
  }


  thumbnailReevaluationRunning =
    false;


  thumbnailReevaluationBusy =
    false;


  resetThumbnailState();


  clearThumbnailReevaluationPreview();


  setThumbnailReevaluationControlsDisabled(
    true
  );


  if (
    thumbnailReevaluateStart
  ) {

    thumbnailReevaluateStart.disabled =
      false;
  }


  if (
    thumbnailReevaluateStop
  ) {

    thumbnailReevaluateStop.disabled =
      true;
  }


  setThumbnailReevaluationStatus(
    "Thumbnail review stopped."
  );
}


/**
 * Finishes naturally after the final catalogue video.
 */
function finishThumbnailReevaluation() {

  const reviewedCount =
    thumbnailReevaluationQueue.length;


  thumbnailReevaluationRunning =
    false;


  thumbnailReevaluationBusy =
    false;


  resetThumbnailState();


  clearThumbnailReevaluationPreview();


  setThumbnailReevaluationControlsDisabled(
    true
  );


  if (
    thumbnailReevaluateStart
  ) {

    thumbnailReevaluateStart.disabled =
      false;
  }


  if (
    thumbnailReevaluateStop
  ) {

    thumbnailReevaluateStop.disabled =
      true;
  }


  if (
    thumbnailReevaluateFilm
  ) {

    thumbnailReevaluateFilm.textContent =
      "Review complete";
  }


  if (
    thumbnailReevaluateDetail
  ) {

    thumbnailReevaluateDetail.textContent =
      "";
  }


  setThumbnailReevaluationStatus(
    `Finished reviewing ${reviewedCount} ${
      reviewedCount === 1
        ? "video"
        : "videos"
    }.`
  );
}


/**
 * Updates the controls while a video is being analysed or uploaded.
 */
function setThumbnailReevaluationBusy(
  busy
) {

  thumbnailReevaluationBusy =
    Boolean(
      busy
    );


  const disableReviewControls =
    thumbnailReevaluationBusy ||
    !thumbnailReevaluationRunning;


  if (
    thumbnailReevaluatePrevious
  ) {

    thumbnailReevaluatePrevious.disabled =
      disableReviewControls;
  }


  if (
    thumbnailReevaluateNext
  ) {

    thumbnailReevaluateNext.disabled =
      disableReviewControls;
  }


  if (
    thumbnailReevaluateKeep
  ) {

    thumbnailReevaluateKeep.disabled =
      disableReviewControls;
  }


  if (
    thumbnailReevaluateUse
  ) {

    thumbnailReevaluateUse.disabled =
      disableReviewControls;
  }


  if (
    thumbnailReevaluateStop
  ) {

    /*
     * Stop remains available while candidate generation is running.
     */
    thumbnailReevaluateStop.disabled =
      !thumbnailReevaluationRunning;
  }


  if (
    thumbnailReevaluateStart
  ) {

    thumbnailReevaluateStart.disabled =
      thumbnailReevaluationRunning ||
      thumbnailReevaluationBusy;
  }
}


/**
 * Explicitly enables/disables the candidate decision controls.
 */
function setThumbnailReevaluationControlsDisabled(
  disabled
) {

  if (
    thumbnailReevaluatePrevious
  ) {

    thumbnailReevaluatePrevious.disabled =
      disabled;
  }


  if (
    thumbnailReevaluateNext
  ) {

    thumbnailReevaluateNext.disabled =
      disabled;
  }


  if (
    thumbnailReevaluateKeep
  ) {

    thumbnailReevaluateKeep.disabled =
      disabled;
  }


  if (
    thumbnailReevaluateUse
  ) {

    thumbnailReevaluateUse.disabled =
      disabled;
  }
}


/**
 * Displays a review status message.
 */
function setThumbnailReevaluationStatus(
  message,
  state =
    "normal"
) {

  if (
    !thumbnailReevaluateStatus
  ) {

    return;
  }


  thumbnailReevaluateStatus.textContent =
    message || "";


  thumbnailReevaluateStatus.classList.toggle(
    "is-error",
    state === "error"
  );
}


/**
 * Releases the temporary object URL used for the Suggested image.
 */
function clearThumbnailReevaluationPreview() {

  if (
    thumbnailReevaluationPreviewUrl
  ) {

    URL.revokeObjectURL(
      thumbnailReevaluationPreviewUrl
    );


    thumbnailReevaluationPreviewUrl =
      null;
  }


  if (
    thumbnailReevaluateSuggested
  ) {

    thumbnailReevaluateSuggested.removeAttribute(
      "src"
    );
  }
}


/*
 * Start with the review controls inactive.
 *
 * Start Review itself remains available.
 */
setThumbnailReevaluationControlsDisabled(
  true
);


if (
  thumbnailReevaluateStop
) {

  thumbnailReevaluateStop.disabled =
    true;
}

/* =====================================================================
   END OF ADMIN THUMBNAIL HEALTH
===================================================================== */
