import {
  supabase
} from "../supabaseClient.js";


/* =====================================================================
   ADMIN-INTEGRITY.JS
   =====================================================================

   PURPOSE
   -------

   Owns the Catalogue Integrity section of the PornFlix Admin dashboard.

   This module handles:

       • Catalogue Integrity counters
       • diagnostic result drawer
       • duplicate URLs
       • duplicate fingerprints
       • videos without actors
       • non-current media URLs
       • missing technical metadata
       • duplicate video comparison
       • signed duplicate-video preview
       • duplicate Keep Both review
       • duplicate consolidation preview
       • duplicate consolidation confirmation
       • duplicate consolidation

   Catalogue repair remains protected by:

       zulu-catalogue-repair

   Signed video previews remain protected by:

       zulu-sign-media

   The parent Admin controller supplies refreshAdmin() during
   initialisation so successful catalogue consolidation can refresh the
   complete Admin dashboard without creating a circular module import.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
===================================================================== */

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
   02. MODULE STATE
===================================================================== */

/**
 * Latest Catalogue Integrity snapshot.
 */
let currentIntegrityData =
  null;


/**
 * Callback supplied by the parent Admin controller.
 *
 * Duplicate consolidation needs to refresh:
 *
 *     • Catalogue Integrity
 *     • Video Storage Health
 *     • Thumbnail Health
 *
 * Keeping the callback here avoids importing admin.js back into this
 * module.
 */
let refreshAdminCallback =
  null;


/* =====================================================================
   03. INITIALISATION
===================================================================== */

/**
 * Attaches persistent Catalogue Integrity event handlers.
 *
 * The parent Admin controller supplies refreshAdmin so destructive
 * catalogue repairs can refresh the complete Admin dashboard after a
 * successful server-side operation.
 */
export function initialiseIntegrity({
  refreshAdmin
} = {}) {

  refreshAdminCallback =
    typeof refreshAdmin ===
      "function"
      ? refreshAdmin
      : null;


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
}


/* =====================================================================
   04. CATALOGUE INTEGRITY
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
export function renderCatalogueIntegrity(
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
export function renderCatalogueIntegrityError(
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
   05. CATALOGUE INTEGRITY INTERACTION
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
    await refreshAdminCallback?.();


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


              await refreshAdminCallback?.();


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
   06. MODULE-LOCAL HELPERS
===================================================================== */

/**
 * Returns the first non-empty value.
 */
function firstValue(
  ...values
) {

  for (
    const value of values
  ) {

    if (
      value !==
        undefined &&
      value !==
        null &&
      value !==
        ""
    ) {

      return value;
    }
  }


  return null;
}


/**
 * Converts a value to a safe finite number.
 */
function safeNumber(
  value
) {

  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : 0;
}


/**
 * Normalises status-like values for comparisons.
 */
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
 * Converts status/database keys into readable text.
 */
function humaniseStatus(
  value
) {

  return String(
    value ||
    ""
  )
    .replace(
      /_/g,
      " "
    )
    .replace(
      /\b\w/g,
      character =>
        character.toUpperCase()
    );
}


/**
 * Extracts a readable filename from a URL.
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


    const parts =
      parsed.pathname.split(
        "/"
      );


    return safeDecodeURIComponent(
      parts[
        parts.length - 1
      ] ||
      ""
    );


  } catch {

    const parts =
      String(
        value
      ).split(
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
 * Safely decodes a URI component.
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


/**
 * Formats a date/time value using the same presentation as the main
 * Admin dashboard.
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
 * Formats a byte count for display.
 */
function formatBytes(
  value
) {

  if (
    value ===
      null ||
    value ===
      undefined ||
    value ===
      ""
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


  const index =
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
      index
    );


  const decimals =
    index === 0
      ? 0
      : size >= 100
        ? 0
        : size >= 10
          ? 1
          : 2;


  return `${size.toFixed(
    decimals
  )} ${units[index]}`;
}


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


/**
 * Escapes untrusted values before inserting them into HTML templates.
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
   END OF ADMIN-INTEGRITY.JS
===================================================================== */
