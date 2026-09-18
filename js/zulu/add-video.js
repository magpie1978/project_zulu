import { supabase } from "../supabaseClient.js";

import {
  formatBytes
} from "./utils.js";

import {
  isLargeFile,
  encodeB2Filename,
  calculateFileSha1,
  uploadFileToBackblaze,
  uploadLargeFileToBackblaze
} from "./upload.js";

import {
  generateThumbnailCandidates,
  getSelectedThumbnailBlob,
  resetThumbnailState,
  uploadThumbnailToBackblaze
} from "./thumbnails.js";


/* =====================================================================
   ADD-VIDEO.JS
   =====================================================================

   PURPOSE
   -------

   Controls the complete Add Video ingestion workflow.

   The workflow is persistent. A zulu_ingestions record is created as
   soon as a local MP4 is selected and is updated as the video moves
   through:

       pending
       analysing
       ready
       uploading
       video_uploaded
       cataloguing
       catalogued
       thumbnail_uploading
       complete

   Non-fatal thumbnail problems may instead finish as:

       complete_without_thumbnail

   Fatal failures are recorded with:

       status = failed
       failed_stage
       error_message

   The browser controls the pre/post catalogue stages through the
   zulu-ingestion-status Edge Function.

   zulu-finalize-video controls:

       cataloguing
       catalogued

   ENHANCED INGESTION UI
   ---------------------

   The Add Video modal now also contains a visual ingestion manager.

   This shows:

       Video analysed
       Duplicate check
       Thumbnail generated
       Video uploaded
       Catalogue entry created
       Thumbnail published
       Complete

   Each stage can visually be:

       ○ pending
       ● active
       ✓ complete
       ⚠ warning
       ✕ failed

   The existing Backblaze byte-progress bar remains in use. The
   ingestion manager's overall percentage additionally incorporates
   the real Backblaze upload percentage while the MP4 is uploading.

   IMPORTANT
   ---------

   The ingestion-manager DOM elements are optional.

   This means this JavaScript can safely load even if the updated HTML
   has not yet been deployed. The underlying upload workflow therefore
   remains functional independently of the enhanced display.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
===================================================================== */

const addVideoBtn =
  document.getElementById(
    "add-video-btn"
  );

const addVideoModal =
  document.getElementById(
    "add-video-modal"
  );

const addVideoClose =
  document.getElementById(
    "add-video-close"
  );

const addVideoCancel =
  document.getElementById(
    "add-video-cancel"
  );

const addVideoFile =
  document.getElementById(
    "add-video-file"
  );

const addVideoTitle =
  document.getElementById(
    "add-video-title"
  );

const addVideoActors =
  document.getElementById(
    "add-video-actors"
  );

const addVideoAddActor =
  document.getElementById(
    "add-video-add-actor"
  );

const addVideoTags =
  document.getElementById(
    "add-video-tags"
  );

const addVideoStatus =
  document.getElementById(
    "add-video-status"
  );

const addVideoSubmit =
  document.getElementById(
    "add-video-submit"
  );

const addVideoFileInfo =
  document.getElementById(
    "add-video-file-info"
  );

const addVideoProgressWrap =
  document.getElementById(
    "add-video-upload-progress-wrap"
  );

const addVideoProgress =
  document.getElementById(
    "add-video-upload-progress"
  );

const addVideoProgressText =
  document.getElementById(
    "add-video-upload-progress-text"
  );

const addVideoThumbnailStatus =
  document.getElementById(
    "add-video-thumbnail-status"
  );


/*
 * Enhanced ingestion-manager UI.
 *
 * All of these references are deliberately null-safe. The upload
 * workflow must never depend on the decorative ingestion panel being
 * present.
 */

const addVideoIngestion =
  document.getElementById(
    "add-video-ingestion"
  );

const addVideoIngestionName =
  document.getElementById(
    "add-video-ingestion-name"
  );

const addVideoIngestionSize =
  document.getElementById(
    "add-video-ingestion-size"
  );

const addVideoIngestionPercent =
  document.getElementById(
    "add-video-ingestion-percent"
  );

const addVideoIngestionResult =
  document.getElementById(
    "add-video-ingestion-result"
  );


/* =====================================================================
   02. MODULE STATE
===================================================================== */

let addVideoUploadInProgress =
  false;

let addVideoCompleted =
  false;

let addVideoMetadata =
  null;


/*
 * UUID of the persistent zulu_ingestions record associated with the
 * currently selected MP4.
 */
let addVideoIngestionId =
  null;


/*
 * Incremented whenever file selection changes.
 *
 * This prevents asynchronous analysis belonging to an older file from
 * overwriting the state of a newer selection.
 */
let addVideoAnalysisToken =
  0;


let zuluActorNames =
  [];

let onVideoAdded =
  null;


/*
 * Real Backblaze upload percentage.
 *
 * This is kept separately from the native progress element because it
 * is also used to calculate the overall ingestion-manager percentage.
 */
let addVideoByteUploadPercent =
  0;


/* =====================================================================
   03. INITIALISATION / EVENT BINDING
===================================================================== */

/**
 * Attaches all Add Video event listeners.
 *
 * @param {Object} options
 * @param {Function} [options.onAdded]
 */
export function attachAddVideoEvents({
  onAdded
} = {}) {

  onVideoAdded =
    typeof onAdded === "function"
      ? onAdded
      : null;


  addVideoBtn?.addEventListener(
    "click",
    openAddVideoModal
  );


  addVideoClose?.addEventListener(
    "click",
    closeAddVideoModal
  );


  addVideoCancel?.addEventListener(
    "click",
    closeAddVideoModal
  );


  addVideoModal
    ?.querySelector(
      ".add-video-backdrop"
    )
    ?.addEventListener(
      "click",
      () => {

        if (
          !addVideoUploadInProgress
        ) {

          closeAddVideoModal();
        }
      }
    );


  addVideoFile?.addEventListener(
    "change",
    handleFileSelection
  );


  addVideoAddActor?.addEventListener(
    "click",
    handleAddActor
  );


  addVideoSubmit?.addEventListener(
    "click",
    handleSubmit
  );
}


/* =====================================================================
   04. MODAL MANAGEMENT
===================================================================== */

/**
 * Opens the Add Video modal.
 */
function openAddVideoModal() {

  addVideoCompleted =
    false;


  addVideoModal?.classList.add(
    "open"
  );


  addVideoModal?.setAttribute(
    "aria-hidden",
    "false"
  );


  if (
    addVideoActors &&
    !addVideoActors.children.length
  ) {

    addActorRow();
  }


  loadZuluActorNames();
}


/**
 * Closes the Add Video modal.
 *
 * Closing is blocked while an actual upload is in progress.
 */

/**
 * Closes the Add Video modal.
 *
 * Closing is blocked while an actual upload is in progress.
 *
 * If the user closes the modal after selecting/analyzing a file but
 * BEFORE upload begins, the persistent ingestion is marked cancelled.
 *
 * This prevents abandoned selections remaining indefinitely as:
 *
 *     pending
 *     analysing
 *     ready
 *
 * in zulu_ingestions.
 *
 * A successfully completed ingestion is never cancelled.
 */
async function closeAddVideoModal() {

  /*
   * Never allow the modal to close while an MP4 is actively being
   * uploaded/catalogued.
   *
   * Apart from avoiding accidental interruption, this also prevents
   * us from incorrectly marking a genuine in-progress ingestion as
   * cancelled.
   */
  if (
    addVideoUploadInProgress
  ) {

    if (
      addVideoStatus
    ) {

      addVideoStatus.textContent =
        "Upload in progress — please wait for it to finish.";
    }


    return;
  }


  /*
   * Capture the current ingestion before resetting any local state.
   */
  const ingestionId =
    addVideoIngestionId;


  const shouldCancelIngestion =
    Boolean(
      ingestionId &&
      !addVideoCompleted
    );


  /*
   * Close the modal immediately.
   *
   * The server-side cancellation can happen afterwards; the user
   * should not have to wait for a network round-trip merely to close
   * the dialog.
   */
  addVideoModal?.classList.remove(
    "open"
  );


  addVideoModal?.setAttribute(
    "aria-hidden",
    "true"
  );


  /*
   * Invalidate any outstanding metadata/thumbnail analysis.
   *
   * This is particularly important if the user closes the modal while
   * generateThumbnailCandidates() is still running.
   */
  addVideoAnalysisToken +=
    1;


  /*
   * If this was an unfinished pre-upload ingestion, preserve the
   * history but explicitly mark it cancelled.
   *
   * cancelIngestion() is already best-effort and handles its own
   * journal errors.
   */
  if (
    shouldCancelIngestion
  ) {

    await cancelIngestion(
      ingestionId
    );
  }


  /*
   * Always reset the local form after the modal closes.
   *
   * Previously this only happened after a completed upload. That meant
   * cancelling a selected file could leave its title, actors, metadata
   * and ingestion UUID sitting in the form when the modal was reopened.
   */
  resetAddVideoForm();
}

/**
 * Restores the Add Video form to its initial state.
 */
function resetAddVideoForm() {

  if (
    addVideoFile
  ) {

    addVideoFile.value =
      "";
  }


  addVideoMetadata =
    null;

  addVideoIngestionId =
    null;

  addVideoAnalysisToken +=
    1;

  addVideoByteUploadPercent =
    0;


  if (
    addVideoTitle
  ) {

    addVideoTitle.value =
      "";
  }


  if (
    addVideoActors
  ) {

    addVideoActors.innerHTML =
      "";
  }


  if (
    addVideoTags
  ) {

    addVideoTags.value =
      "";
  }


  if (
    addVideoFileInfo
  ) {

    addVideoFileInfo.textContent =
      "";
  }


  if (
    addVideoStatus
  ) {

    addVideoStatus.textContent =
      "";
  }


  if (
    addVideoProgress
  ) {

    addVideoProgress.value =
      0;
  }


  if (
    addVideoProgressText
  ) {

    addVideoProgressText.textContent =
      "";
  }


  if (
    addVideoProgressWrap
  ) {

    addVideoProgressWrap.style.display =
      "none";
  }


  if (
    addVideoSubmit
  ) {

    addVideoSubmit.disabled =
      false;

    addVideoSubmit.textContent =
      "Upload Video";
  }


  if (
    addVideoCancel
  ) {

    addVideoCancel.textContent =
      "Cancel";
  }


  addVideoCompleted =
    false;


  /*
   * Hide and reset the enhanced ingestion display ready for the next
   * file selection.
   */
  if (
    addVideoIngestion
  ) {

    addVideoIngestion.hidden =
      true;
  }


  resetIngestionStages();


  addActorRow();

  resetThumbnailState();
}


/* =====================================================================
   05. ACTOR CATALOGUE
===================================================================== */

/**
 * Loads existing actor names for autocomplete.
 */
async function loadZuluActorNames() {

  if (
    zuluActorNames.length
  ) {

    return;
  }


  try {

    const {
      data,
      error
    } =
      await supabase
        .from(
          "zulu_distinct_actors"
        )
        .select(
          "actor"
        )
        .order(
          "actor"
        );


    if (
      error
    ) {

      throw error;
    }


    zuluActorNames =
      [
        ...new Set(
          (data || [])
            .map(
              row =>
                row.actor
                  ?.trim()
            )
            .filter(Boolean)
        )
      ];


    console.log(
      `Loaded ${zuluActorNames.length} existing actor names`
    );

  } catch (error) {

    console.error(
      "Could not load actor catalogue:",
      error
    );
  }
}


/* =====================================================================
   06. ACTOR INPUT ROWS
===================================================================== */

/**
 * Adds an actor input row.
 *
 * @param {string} value
 */
function addActorRow(
  value = ""
) {

  if (
    !addVideoActors
  ) {

    return;
  }


  const row =
    document.createElement(
      "div"
    );


  row.className =
    "add-video-actor-row";


  const wrapper =
    document.createElement(
      "div"
    );


  wrapper.className =
    "add-video-actor-wrapper";


  const input =
    document.createElement(
      "input"
    );


  input.type =
    "text";

  input.className =
    "add-video-actor-input";

  input.placeholder =
    "Actor name";

  input.autocomplete =
    "off";

  input.value =
    value;


  const suggestions =
    document.createElement(
      "div"
    );


  suggestions.className =
    "add-video-actor-suggestions";


  input.addEventListener(
    "input",
    () => {

      showActorSuggestions(
        input,
        suggestions
      );
    }
  );


  input.addEventListener(
    "focus",
    () => {

      showActorSuggestions(
        input,
        suggestions
      );
    }
  );


  wrapper.appendChild(
    input
  );


  wrapper.appendChild(
    suggestions
  );


  const remove =
    document.createElement(
      "button"
    );


  remove.type =
    "button";

  remove.className =
    "add-video-remove-actor";

  remove.textContent =
    "×";


  remove.addEventListener(
    "click",
    () => {

      row.remove();
    }
  );


  row.appendChild(
    wrapper
  );


  row.appendChild(
    remove
  );


  addVideoActors.appendChild(
    row
  );
}


/**
 * Adds another blank actor row and focuses it.
 */
function handleAddActor() {

  addActorRow();


  const inputs =
    addVideoActors
      ?.querySelectorAll(
        ".add-video-actor-input"
      );


  inputs?.[
    inputs.length - 1
  ]?.focus();
}


/* =====================================================================
   07. ACTOR AUTOCOMPLETE
===================================================================== */

/**
 * Displays matching existing actors beneath an actor input.
 */
function showActorSuggestions(
  input,
  container
) {

  const value =
    input.value
      .trim()
      .toLowerCase();


  container.innerHTML =
    "";


  if (
    value.length < 1
  ) {

    container.classList.remove(
      "open"
    );

    return;
  }


  const matches =
    zuluActorNames
      .filter(
        actor =>
          actor
            .toLowerCase()
            .includes(
              value
            )
      )
      .slice(
        0,
        10
      );


  if (
    !matches.length
  ) {

    container.classList.remove(
      "open"
    );

    return;
  }


  for (
    const actor of matches
  ) {

    const item =
      document.createElement(
        "div"
      );


    item.className =
      "add-video-actor-suggestion";

    item.textContent =
      actor;


    item.addEventListener(
      "mousedown",
      event => {

        event.preventDefault();


        input.value =
          actor;


        container.innerHTML =
          "";


        container.classList.remove(
          "open"
        );
      }
    );


    container.appendChild(
      item
    );
  }


  container.classList.add(
    "open"
  );
}


/* =====================================================================
   08. ACTOR DETECTION FROM FILENAME
===================================================================== */

/**
 * Attempts to infer actor names from:
 *
 *     Actor A with Actor B
 *
 * and similar filename conventions.
 */
function suggestActorsFromTitle(
  title
) {

  if (
    !addVideoActors
  ) {

    return;
  }


  addVideoActors.innerHTML =
    "";


  let workingTitle =
    title
      .replace(
        /^PREVIEW\s*-\s*/i,
        ""
      )
      .trim();


  const actors =
    [];


  const withMatch =
    workingTitle.match(
      /^(.+?)\s+with\s+(.+)$/i
    );


  if (
    withMatch
  ) {

    actors.push(
      withMatch[1].trim()
    );


    let rest =
      withMatch[2]
        .replace(
          /\s+-\s+.*$/,
          ""
        )
        .replace(
          /\s+#\d+$/,
          ""
        );


    const others =
      rest
        .replace(
          /\s+and\s+/gi,
          " & "
        )
        .split(
          /\s*,\s*|\s*&\s*/
        )
        .map(
          value =>
            value.trim()
        )
        .filter(Boolean);


    actors.push(
      ...others
    );
  }


  if (
    !actors.length
  ) {

    addActorRow();

    return;
  }


  const uniqueActors =
    [
      ...new Set(
        actors
      )
    ];


  for (
    const actor of uniqueActors
  ) {

    addActorRow(
      actor
    );
  }
}


/* =====================================================================
   09. INGESTION JOURNAL HELPERS
===================================================================== */

/**
 * Calls zulu-ingestion-status.
 *
 * The browser never writes directly to zulu_ingestions.
 */
async function invokeIngestionStatus(
  body
) {

  const {
    data,
    error
  } =
    await supabase
      .functions
      .invoke(
        "zulu-ingestion-status",
        {
          body
        }
      );


  if (
    error
  ) {

    throw error;
  }


  if (
    !data?.success
  ) {

    throw new Error(
      data?.error ||
      "Could not update ingestion status."
    );
  }


  return data.ingestion;
}


/**
 * Creates a persistent ingestion record immediately after a file is
 * selected.
 */
async function createIngestionForFile(
  file
) {

  const ingestion =
    await invokeIngestionStatus({
      action:
        "create",

      original_filename:
        file.name,

      filesize_bytes:
        file.size
    });


  return ingestion.id;
}


/**
 * Updates a browser-controlled ingestion stage.
 */
async function updateIngestionStatus(
  ingestionId,
  status,
  extra = {}
) {

  if (
    !ingestionId
  ) {

    return null;
  }


  return invokeIngestionStatus({
    action:
      "update",

    ingestion_id:
      ingestionId,

    status,

    ...extra
  });
}


/**
 * Records a fatal ingestion failure.
 *
 * This is deliberately best-effort so failure to update the journal
 * never hides the original problem.
 */
async function markIngestionFailed(
  ingestionId,
  failedStage,
  error
) {

  if (
    !ingestionId
  ) {

    return;
  }


  try {

    await invokeIngestionStatus({
      action:
        "fail",

      ingestion_id:
        ingestionId,

      failed_stage:
        failedStage,

      error_message:
        error?.message ||
        String(
          error ||
          "Unknown ingestion error"
        )
    });

  } catch (journalError) {

    console.error(
      "Could not record ingestion failure:",
      journalError
    );
  }
}


/**
 * Marks an abandoned pre-upload ingestion as cancelled.
 */
async function cancelIngestion(
  ingestionId
) {

  if (
    !ingestionId
  ) {

    return;
  }


  try {

    await updateIngestionStatus(
      ingestionId,
      "cancelled"
    );

  } catch (error) {

    console.error(
      "Could not cancel previous ingestion:",
      error
    );
  }
}


/**
 * Marks an ingestion complete after catalogue creation and thumbnail
 * handling have finished.
 */
async function completeIngestion(
  ingestionId,
  thumbnailStatus
) {

  if (
    !ingestionId
  ) {

    return null;
  }


  return invokeIngestionStatus({
    action:
      "complete",

    ingestion_id:
      ingestionId,

    thumbnail_status:
      thumbnailStatus
  });
}


/* =====================================================================
   10. ENHANCED INGESTION UI
   =====================================================================

   The visual stage manager is deliberately kept separate from the
   persistent zulu_ingestions state machine.

   Database status is authoritative.

   These helpers merely reflect progress in the Add Video modal.
===================================================================== */


/*
 * Ordered visual stages.
 *
 * This order is also used to calculate the overall percentage.
 */
const INGESTION_STAGE_ORDER =
  [
    "analysis",
    "duplicate",
    "thumbnail-generation",
    "video-upload",
    "catalogue",
    "thumbnail-upload",
    "complete"
  ];


/**
 * Returns the DOM element for a visual ingestion stage.
 *
 * @param {string} stage
 * @returns {HTMLElement|null}
 */
function getIngestionStageElement(
  stage
) {

  return addVideoIngestion
    ?.querySelector(
      `[data-stage="${stage}"]`
    ) ||
    null;
}


/**
 * Returns the icon belonging to a visual ingestion stage.
 *
 * @param {string} stage
 * @returns {HTMLElement|null}
 */
function getIngestionStageIcon(
  stage
) {

  return getIngestionStageElement(
    stage
  )
    ?.querySelector(
      ".add-video-stage-icon"
    ) ||
    null;
}


/**
 * Resets every visual stage to pending.
 *
 * This does not change anything in Supabase.
 */
function resetIngestionStages() {

  addVideoByteUploadPercent =
    0;


  for (
    const stage of
    INGESTION_STAGE_ORDER
  ) {

    const element =
      getIngestionStageElement(
        stage
      );


    if (
      !element
    ) {

      continue;
    }


    element.classList.remove(
      "is-active",
      "is-complete",
      "is-warning",
      "is-failed"
    );


    element.classList.add(
      "is-pending"
    );


    const icon =
      getIngestionStageIcon(
        stage
      );


    if (
      icon
    ) {

      icon.textContent =
        "○";
    }
  }


  if (
    addVideoIngestionPercent
  ) {

    addVideoIngestionPercent.textContent =
      "0%";
  }


  if (
    addVideoIngestionResult
  ) {

    addVideoIngestionResult.hidden =
      true;

    addVideoIngestionResult.innerHTML =
      "";
  }
}


/**
 * Changes one visual stage.
 *
 * Supported states:
 *
 *     pending
 *     active
 *     complete
 *     warning
 *     failed
 *
 * @param {string} stage
 * @param {string} state
 */
function setIngestionStage(
  stage,
  state
) {

  const element =
    getIngestionStageElement(
      stage
    );


  if (
    !element
  ) {

    return;
  }


  element.classList.remove(
    "is-pending",
    "is-active",
    "is-complete",
    "is-warning",
    "is-failed"
  );


  element.classList.add(
    `is-${state}`
  );


  const icon =
    getIngestionStageIcon(
      stage
    );


  if (
    !icon
  ) {

    return;
  }


  switch (
    state
  ) {

    case "active":

      icon.textContent =
        "●";

      break;


    case "complete":

      icon.textContent =
        "✓";

      break;


    case "warning":

      icon.textContent =
        "⚠";

      break;


    case "failed":

      icon.textContent =
        "✕";

      break;


    default:

      icon.textContent =
        "○";
  }
}


/**
 * Calculates and displays overall ingestion progress.
 *
 * Normally each of the seven visual stages contributes equally.
 *
 * During the video-upload stage, however, the stage receives partial
 * credit based on the real Backblaze byte upload percentage. This
 * prevents the headline percentage from appearing frozen during a
 * long MP4 upload.
 */
function updateIngestionPercent() {

  if (
    !addVideoIngestionPercent
  ) {

    return;
  }


  let progressUnits =
    0;


  for (
    const stage of
    INGESTION_STAGE_ORDER
  ) {

    const element =
      getIngestionStageElement(
        stage
      );


    if (
      !element
    ) {

      continue;
    }


    if (
      element.classList.contains(
        "is-complete"
      ) ||
      element.classList.contains(
        "is-warning"
      )
    ) {

      progressUnits +=
        1;

      continue;
    }


    /*
     * Give the active MP4-upload stage proportional credit.
     */
    if (
      stage ===
        "video-upload" &&
      element.classList.contains(
        "is-active"
      )
    ) {

      progressUnits +=
        Math.max(
          0,
          Math.min(
            100,
            Number(
              addVideoByteUploadPercent
            ) ||
            0
          )
        ) /
        100;
    }
  }


  const percent =
    Math.round(
      (
        progressUnits /
        INGESTION_STAGE_ORDER.length
      ) *
      100
    );


  addVideoIngestionPercent.textContent =
    `${Math.max(
      0,
      Math.min(
        100,
        percent
      )
    )}%`;
}


/**
 * Opens and initialises the visual ingestion manager for a newly
 * selected local file.
 *
 * @param {File} file
 */
function initialiseIngestionUI(
  file
) {

  if (
    !addVideoIngestion
  ) {

    return;
  }


  addVideoIngestion.hidden =
    false;


  if (
    addVideoIngestionName
  ) {

    addVideoIngestionName.textContent =
      file.name;
  }


  if (
    addVideoIngestionSize
  ) {

    addVideoIngestionSize.textContent =
      formatBytes(
        file.size
      );
  }


  resetIngestionStages();


  setIngestionStage(
    "analysis",
    "active"
  );


  updateIngestionPercent();
}


/**
 * Displays the final successful ingestion summary.
 *
 * A failed/skipped thumbnail is represented as a warning rather than
 * a fatal failure because the MP4 and catalogue record are already
 * valid.
 *
 * @param {number|string} uid
 * @param {string} thumbnailStatus
 */
function showIngestionComplete(
  uid,
  thumbnailStatus
) {

  setIngestionStage(
    "complete",
    "complete"
  );


  updateIngestionPercent();


  if (
    !addVideoIngestionResult
  ) {

    return;
  }


  const thumbnailText =
    thumbnailStatus ===
      "uploaded"
      ? "✓ Published"
      : "⚠ Default thumbnail";


  addVideoIngestionResult.innerHTML =
    `
      <strong>INGESTION COMPLETE</strong><br>
      Video UID: ${uid}<br>
      Video: ✓ Uploaded<br>
      Catalogue: ✓ Created<br>
      Thumbnail: ${thumbnailText}
    `;


  addVideoIngestionResult.hidden =
    false;
}


/**
 * Marks a visual stage as failed.
 *
 * This function affects the UI only. Persistent failures continue to
 * be written using markIngestionFailed() or by zulu-finalize-video.
 *
 * @param {string} stage
 */
function showIngestionFailure(
  stage
) {

  setIngestionStage(
    stage,
    "failed"
  );


  updateIngestionPercent();
}


/* =====================================================================
   11. FILE SELECTION
===================================================================== */

/**
 * Handles selection of a local MP4.
 *
 * The persistent ingestion record is created BEFORE local video
 * analysis begins.
 *
 * Visual workflow:
 *
 *     file selected
 *          ↓
 *     ● Video analysed
 *          ↓
 *     ✓ Video analysed
 *     ● Thumbnail generated
 *
 * If a different file had previously been selected but never uploaded,
 * its ingestion record is preserved and marked cancelled.
 */
async function handleFileSelection() {

  const file =
    addVideoFile
      ?.files?.[0];


  /*
   * Invalidate any older asynchronous analysis immediately.
   *
   * If the user selects another file while metadata or thumbnail work
   * is still running, the older result must not overwrite the new
   * selection.
   */
  const analysisToken =
    ++addVideoAnalysisToken;


  addVideoMetadata =
    null;


  resetThumbnailState();


  /*
   * Preserve the previous ingestion ID before clearing the active
   * selection.
   */
  const previousIngestionId =
    addVideoIngestionId;


  addVideoIngestionId =
    null;


  /*
   * A previously selected file that never entered the actual upload
   * stage is an abandoned ingestion rather than a failure.
   */
  if (
    previousIngestionId &&
    !addVideoUploadInProgress
  ) {

    await cancelIngestion(
      previousIngestionId
    );
  }


  /*
   * File chooser may have been cleared rather than populated.
   */
  if (
    !file
  ) {

    if (
      addVideoFileInfo
    ) {

      addVideoFileInfo.textContent =
        "";
    }


    if (
      addVideoIngestion
    ) {

      addVideoIngestion.hidden =
        true;
    }


    resetIngestionStages();


    return;
  }


  /*
   * Immediately initialise the visual ingestion manager.
   *
   * This happens before the Edge Function call so the user gets instant
   * feedback after choosing the file.
   */
  initialiseIngestionUI(
    file
  );


  const filename =
    file.name;


  const title =
    filename.replace(
      /\.mp4$/i,
      ""
    );


  /*
   * Default the editable film title from the local filename.
   */
  if (
    addVideoTitle
  ) {

    addVideoTitle.value =
      title;
  }


  const sizeMB =
    file.size /
    (1024 * 1024);


  /*
   * Preserve the existing compact file-information display as well as
   * the richer Current Ingestion panel.
   */
  if (
    addVideoFileInfo
  ) {

    addVideoFileInfo.textContent =
      `${filename} — ${sizeMB.toFixed(1)} MB`;
  }


  /*
   * Attempt to pre-populate actor fields from the filename.
   */
  suggestActorsFromTitle(
    title
  );


  /*
   * Create the persistent ingestion journal BEFORE analysis starts.
   *
   * At this point Supabase only needs to know:
   *
   *     original_filename
   *     filesize_bytes
   *
   * Metadata and fingerprint information are produced locally later.
   */
  try {

    handleUploadStatus(
      "Creating ingestion record…"
    );


    const ingestionId =
      await createIngestionForFile(
        file
      );


    /*
     * The Edge Function call above is asynchronous.
     *
     * The user could have selected another MP4 while we were waiting.
     * If that happened, this newly-created record belongs to the stale
     * selection and should be marked cancelled.
     */
    if (
      analysisToken !==
        addVideoAnalysisToken ||
      addVideoFile?.files?.[0] !==
        file
    ) {

      await cancelIngestion(
        ingestionId
      );

      return;
    }


    addVideoIngestionId =
      ingestionId;


    /*
     * Analysis has officially begun.
     *
     * Thumbnail generation is also considered to have started because
     * it forms part of the local pre-upload preparation process.
     */
    await updateIngestionStatus(
      ingestionId,
      "analysing",
      {
        thumbnail_status:
          "generating"
      }
    );


    await analyseSelectedFile(
      file,
      ingestionId,
      analysisToken
    );

  } catch (error) {

    console.error(
      "Could not start video ingestion:",
      error
    );


    /*
     * Only update the visible UI if this is still the active file.
     */
    if (
      analysisToken ===
        addVideoAnalysisToken
    ) {

      showIngestionFailure(
        "analysis"
      );


      handleUploadStatus(
        `Could not start ingestion: ${
          error?.message ||
          "Unknown error"
        }`
      );
    }
  }
}


/* =====================================================================
   12. VIDEO ANALYSIS / FINGERPRINTING
===================================================================== */

/**
 * Calculates a SHA-256 hash for a Blob.
 *
 * Used by the lightweight video fingerprinting system.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function sha256Blob(
  blob
) {

  const buffer =
    await blob.arrayBuffer();


  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      buffer
    );


  return [
    ...new Uint8Array(
      hashBuffer
    )
  ]
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(
            2,
            "0"
          )
    )
    .join("");
}


/**
 * Reads local video metadata and generates a lightweight content
 * fingerprint.
 *
 * Metadata collected:
 *
 *     filesize
 *     duration
 *     width
 *     height
 *
 * Fingerprinting:
 *
 * Rather than hashing the complete MP4, which could be several GB,
 * three 4 MB samples are SHA-256 hashed:
 *
 *     first 4 MB
 *     middle 4 MB
 *     final 4 MB
 *
 * Those hashes plus the exact filesize are then hashed again to create
 * the final 64-character fingerprint.
 *
 * This is intended for fast duplicate detection rather than as a
 * cryptographic proof that every byte of two files is identical.
 *
 * @param {File} file
 * @returns {Promise<Object>}
 */
async function extractVideoMetadata(
  file
) {

  const objectUrl =
    URL.createObjectURL(
      file
    );


  const video =
    document.createElement(
      "video"
    );


  video.preload =
    "metadata";

  video.muted =
    true;

  video.playsInline =
    true;

  video.src =
    objectUrl;


  try {

    /*
     * Wait for the browser to parse the MP4 metadata.
     */
    await new Promise(
      (
        resolve,
        reject
      ) => {

        video.addEventListener(
          "loadedmetadata",
          resolve,
          {
            once:
              true
          }
        );


        video.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                "Could not read video metadata."
              )
            ),
          {
            once:
              true
          }
        );
      }
    );


    const durationSeconds =
      Number(
        video.duration
      );


    const width =
      Number(
        video.videoWidth
      );


    const height =
      Number(
        video.videoHeight
      );


    /*
     * Fingerprint first, middle and final 4 MB.
     */
    const sampleSize =
      4 * 1024 * 1024;


    /*
     * FIRST SAMPLE
     */
    const firstChunk =
      file.slice(
        0,
        Math.min(
          sampleSize,
          file.size
        )
      );


    /*
     * MIDDLE SAMPLE
     */
    const middleStart =
      Math.max(
        0,
        Math.floor(
          file.size / 2 -
          sampleSize / 2
        )
      );


    const middleChunk =
      file.slice(
        middleStart,
        Math.min(
          middleStart +
            sampleSize,
          file.size
        )
      );


    /*
     * FINAL SAMPLE
     */
    const lastStart =
      Math.max(
        0,
        file.size -
          sampleSize
      );


    const lastChunk =
      file.slice(
        lastStart,
        file.size
      );


    /*
     * Hash the three samples concurrently.
     */
    const [
      firstSha256,
      middleSha256,
      lastSha256
    ] =
      await Promise.all([
        sha256Blob(
          firstChunk
        ),

        sha256Blob(
          middleChunk
        ),

        sha256Blob(
          lastChunk
        )
      ]);


    /*
     * Include exact filesize in the fingerprint source.
     *
     * This reduces the chance that two files with identical sampled
     * regions but different overall lengths are treated as duplicates.
     */
    const fingerprintSource =
      [
        file.size,
        firstSha256,
        middleSha256,
        lastSha256
      ]
        .join(
          "|"
        );


    const fingerprintBuffer =
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder()
          .encode(
            fingerprintSource
          )
      );


    const fingerprint =
      [
        ...new Uint8Array(
          fingerprintBuffer
        )
      ]
        .map(
          byte =>
            byte
              .toString(16)
              .padStart(
                2,
                "0"
              )
        )
        .join("");


    return {
      filesizeBytes:
        file.size,

      durationSeconds,

      width,

      height,

      fingerprint
    };

  } finally {

    /*
     * Release the temporary browser video resource regardless of
     * whether metadata extraction succeeded.
     */
    video.pause();


    video.removeAttribute(
      "src"
    );


    URL.revokeObjectURL(
      objectUrl
    );
  }
}


/**
 * Coordinates local metadata analysis and thumbnail generation.
 *
 * Metadata failure is fatal because the upload pipeline requires the
 * fingerprint and other metadata.
 *
 * Thumbnail generation failure is deliberately NON-FATAL.
 *
 * @param {File} file
 * @param {string} ingestionId
 * @param {number} analysisToken
 */
async function analyseSelectedFile(
  file,
  ingestionId,
  analysisToken
) {

  try {

    if (
      addVideoThumbnailStatus
    ) {

      addVideoThumbnailStatus.textContent =
        "Reading video metadata…";
    }


    /*
     * The visual manager already marks analysis active when the file
     * is selected. Keep it explicitly active here in case this
     * function is ever called from another route in future.
     */
    setIngestionStage(
      "analysis",
      "active"
    );


    updateIngestionPercent();


    addVideoMetadata =
      await extractVideoMetadata(
        file
      );


    console.log(
      "VIDEO METADATA:",
      addVideoMetadata
    );


    /*
     * Ignore stale analysis results.
     *
     * All three checks matter:
     *
     *     same File object
     *     same analysis generation
     *     same persistent ingestion UUID
     */
    if (
      addVideoFile
        ?.files?.[0] !==
          file ||
      analysisToken !==
        addVideoAnalysisToken ||
      ingestionId !==
        addVideoIngestionId
    ) {

      console.log(
        "Ignoring analysis result for previous file."
      );

      return;
    }


    /*
     * Core MP4 analysis is now complete.
     */
    setIngestionStage(
      "analysis",
      "complete"
    );


    /*
     * Thumbnail generation is the next visible stage.
     */
    setIngestionStage(
      "thumbnail-generation",
      "active"
    );


    updateIngestionPercent();


    /*
     * Thumbnail generation remains OPTIONAL.
     *
     * If it fails, the video can still continue through Backblaze and
     * catalogue creation and will ultimately use the default thumbnail.
     */
    try {

      await generateThumbnailCandidates(
        file
      );


      /*
       * Re-check for a stale file because thumbnail generation itself
       * can take time.
       */
      if (
        addVideoFile
          ?.files?.[0] !==
            file ||
        analysisToken !==
          addVideoAnalysisToken ||
        ingestionId !==
          addVideoIngestionId
      ) {

        console.log(
          "Ignoring thumbnail result for previous file."
        );

        return;
      }


      await updateIngestionStatus(
        ingestionId,
        "analysing",
        {
          thumbnail_status:
            "ready"
        }
      );


      setIngestionStage(
        "thumbnail-generation",
        "complete"
      );


      updateIngestionPercent();


      /*
       * At this stage analysis is finished but upload has not started.
       * Duplicate checking happens when the user presses Upload Video,
       * so leave that stage pending.
       */
      handleUploadStatus(
        "Video ready to upload."
      );

    } catch (thumbnailError) {

      console.error(
        "Thumbnail generation failed:",
        thumbnailError
      );


      resetThumbnailState();


      if (
        addVideoThumbnailStatus
      ) {

        addVideoThumbnailStatus.textContent =
          "Thumbnail generation failed — video can still be uploaded.";
      }


      /*
       * Show this as a warning, not a failure.
       */
      setIngestionStage(
        "thumbnail-generation",
        "warning"
      );


      updateIngestionPercent();


      /*
       * Thumbnail failure is non-fatal, but preserve it in the
       * persistent ingestion journal.
       */
      try {

        await updateIngestionStatus(
          ingestionId,
          "analysing",
          {
            thumbnail_status:
              "failed"
          }
        );

      } catch (journalError) {

        console.error(
          "Could not record thumbnail-generation failure:",
          journalError
        );
      }


      handleUploadStatus(
        "Video ready to upload — default thumbnail will be used."
      );
    }

  } catch (error) {

    console.error(
      "VIDEO ANALYSIS ERROR:",
      error
    );


    addVideoMetadata =
      null;


    /*
     * Analysis is a fatal stage because the fingerprint and video
     * metadata are prerequisites for the remainder of the ingestion.
     */
    showIngestionFailure(
      "analysis"
    );


    await markIngestionFailed(
      ingestionId,
      "analysing",
      error
    );


    if (
      addVideoThumbnailStatus
    ) {

      addVideoThumbnailStatus.textContent =
        "Could not analyse this video.";
    }


    handleUploadStatus(
      `Video analysis failed: ${
        error?.message ||
        "Unknown error"
      }`
    );
  }
}


/* =====================================================================
   13. DUPLICATE DETECTION
===================================================================== */

/**
 * Looks for an existing catalogue record with the same fingerprint.
 *
 * The fingerprint was calculated locally before any MP4 is uploaded,
 * allowing duplicate detection to happen without wasting Backblaze
 * storage or bandwidth.
 *
 * @param {string} fingerprint
 * @returns {Promise<Object|null>}
 */
async function findDuplicateVideoByFingerprint(
  fingerprint
) {

  if (
    !fingerprint
  ) {

    return null;
  }


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
      .eq(
        "fingerprint",
        fingerprint
      )
      .maybeSingle();


  if (
    error
  ) {

    throw error;
  }


  return data ||
    null;
}


/* =====================================================================
   14. BUILD SUBMISSION PAYLOAD
===================================================================== */

/**
 * Collects and normalises the current Add Video form values.
 *
 * Actor duplicates are removed before submission.
 *
 * Tags are entered as a comma-separated list and converted into an
 * array.
 *
 * @returns {Object}
 */
function getAddVideoPayload() {

  const file =
    addVideoFile
      ?.files?.[0];


  const actors =
    [
      ...(
        addVideoActors
          ?.querySelectorAll(
            ".add-video-actor-input"
          ) ||
        []
      )
    ]
      .map(
        input =>
          input.value.trim()
      )
      .filter(Boolean);


  const tags =
    (
      addVideoTags?.value ||
      ""
    )
      .split(
        ","
      )
      .map(
        tag =>
          tag.trim()
      )
      .filter(Boolean);


  return {
    file,

    filename:
      file?.name ||
      null,

    film:
      addVideoTitle
        ?.value
        .trim() ||
      "",

    actors:
      [
        ...new Set(
          actors
        )
      ],

    tags
  };
}


/* =====================================================================
   15. STATUS / PROGRESS HELPERS
===================================================================== */

/**
 * Displays the current workflow message beneath the Add Video form.
 *
 * This existing text status remains useful alongside the richer visual
 * ingestion manager because it can describe fine-grained operations
 * such as checksum generation and Backblaze authorisation.
 *
 * @param {string} message
 */
function handleUploadStatus(
  message
) {

  if (
    addVideoStatus
  ) {

    addVideoStatus.textContent =
      message;
  }
}


/**
 * Updates the real Backblaze upload progress bar.
 *
 * The same percentage is also passed into the enhanced ingestion
 * manager. This allows the overall percentage to move smoothly while
 * the potentially long MP4 upload is taking place.
 *
 * @param {Object} progress
 * @param {number} progress.percent
 * @param {string} progress.text
 */
function handleUploadProgress({
  percent,
  text
}) {

  /*
   * Protect against undefined, NaN or out-of-range values coming from
   * an uploader.
   */
  const safePercent =
    Math.max(
      0,
      Math.min(
        100,
        Number(
          percent
        ) ||
        0
      )
    );


  addVideoByteUploadPercent =
    safePercent;


  if (
    addVideoProgress
  ) {

    addVideoProgress.value =
      safePercent;
  }


  if (
    addVideoProgressText
  ) {

    addVideoProgressText.textContent =
      text;
  }


  /*
   * Recalculate the headline percentage only if the visual MP4 upload
   * stage is currently active.
   */
  const videoUploadStage =
    getIngestionStageElement(
      "video-upload"
    );


  if (
    videoUploadStage
      ?.classList.contains(
        "is-active"
      )
  ) {

    updateIngestionPercent();
  }
}


/* =====================================================================
   16. SUBMISSION / INGESTION PIPELINE
   =====================================================================

   Workflow:

       Validate
          ↓
       Duplicate check
          ↓
       ready
          ↓
       uploading
          ↓
       video_uploaded
          ↓
       zulu-finalize-video
          ↓
       catalogued
          ↓
       thumbnail_uploading
          ↓
       complete / complete_without_thumbnail

   The persistent ingestion state and visual ingestion state are
   intentionally separate:

       Supabase state = authoritative recovery/audit information
       Visual state   = live user feedback

===================================================================== */

/**
 * Processes the complete Add Video submission.
 *
 * Chunk 3 continues with the body of this function.
 */
async function handleSubmit() {

  const payload =
    getAddVideoPayload();


  /* -----------------------------------------------------------------
     STEP 1: VALIDATE FORM
  ----------------------------------------------------------------- */

  if (
    !payload.file
  ) {

    handleUploadStatus(
      "Please choose an MP4 file."
    );

    return;
  }


  if (
    !payload.film
  ) {

    handleUploadStatus(
      "Please enter a film title."
    );

    return;
  }


  if (
    !payload.actors.length
  ) {

    handleUploadStatus(
      "Please add at least one actor."
    );

    return;
  }


  if (
    !payload.filename
      .toLowerCase()
      .endsWith(
        ".mp4"
      )
  ) {

    handleUploadStatus(
      "Only MP4 files are currently supported."
    );

    return;
  }


  /*
   * Analysis must have completed successfully.
   *
   * If metadata is still null the user may simply have clicked Upload
   * before browser analysis finished, or analysis may have failed.
   */
  if (
    !addVideoMetadata
  ) {

    handleUploadStatus(
      "Please wait for video analysis to finish."
    );

    return;
  }


  /*
   * Every upload requires its persistent ingestion record.
   */
  const ingestionId =
    addVideoIngestionId;


  if (
    !ingestionId
  ) {

    handleUploadStatus(
      "This video has no ingestion record. Please reselect the MP4."
    );

    return;
  }


  /* -----------------------------------------------------------------
     STEP 2: DUPLICATE CHECK
  ----------------------------------------------------------------- */

  /*
   * Duplicate checking begins only when Upload Video is pressed.
   */
  setIngestionStage(
    "duplicate",
    "active"
  );


  updateIngestionPercent();


  handleUploadStatus(
    "Checking for duplicate…"
  );


  let duplicateVideo;


  try {

    duplicateVideo =
      await findDuplicateVideoByFingerprint(
        addVideoMetadata
          .fingerprint
      );

  } catch (error) {

    console.error(
      "DUPLICATE CHECK FAILED:",
      error
    );


    /*
     * An infrastructure/database failure during duplicate checking is a
     * genuine ingestion failure.
     */
    showIngestionFailure(
      "duplicate"
    );


    await markIngestionFailed(
      ingestionId,
      "duplicate_check",
      error
    );


    handleUploadStatus(
      `Duplicate check failed: ${
        error?.message ||
        "Unknown error"
      }`
    );

    return;
  }


  if (
    duplicateVideo
  ) {

    /*
     * The duplicate detector itself worked successfully, but the
     * ingestion cannot continue because the selected video already
     * exists.
     *
     * Visually use a failure/cross rather than a green tick so it is
     * immediately obvious why no upload followed.
     */
    setIngestionStage(
      "duplicate",
      "failed"
    );


    updateIngestionPercent();


    handleUploadStatus(
      `Possible duplicate: "${duplicateVideo.film}" ` +
      `(UID ${duplicateVideo.uid}). ` +
      `Nothing has been uploaded.`
    );


    console.warn(
      "DUPLICATE VIDEO DETECTED:",
      duplicateVideo
    );


    /*
     * Record this as a deliberate duplicate rather than a generic
     * failure.
     */
    try {

      await updateIngestionStatus(
        ingestionId,
        "duplicate",
        {
          film:
            payload.film,

          canonical_filename:
            `${payload.film}.mp4`,

          fingerprint:
            addVideoMetadata.fingerprint
        }
      );

    } catch (journalError) {

      console.error(
        "Could not record duplicate ingestion:",
        journalError
      );
    }


    return;
  }


  /*
   * Duplicate check passed.
   */
  setIngestionStage(
    "duplicate",
    "complete"
  );


  updateIngestionPercent();


  /* -----------------------------------------------------------------
     STEP 3: BUILD CANONICAL FILENAME
  ----------------------------------------------------------------- */

  const canonicalFilename =
    `${payload.film}.mp4`;


  /*
   * currentStage is used by the catch handler later to decide whether
   * this JavaScript owns persistence of a fatal error.
   *
   * Catalogue failures are owned by zulu-finalize-video.
   */
  let currentStage =
    "ready";


  try {

    /*
     * Persist the final title, canonical filename and analysis-derived
     * fingerprint before any upload begins.
     *
     * The ingestion has now completed all local preparation and is
     * ready to move into storage.
     */
    await updateIngestionStatus(
      ingestionId,
      "ready",
      {
        film:
          payload.film,

        canonical_filename:
          canonicalFilename,

        fingerprint:
          addVideoMetadata
            .fingerprint
      }
    );


    /* ---------------------------------------------------------------
       STEP 4: LOCK UPLOAD UI
    --------------------------------------------------------------- */

    addVideoUploadInProgress =
      true;


    addVideoCompleted =
      false;


    if (
      addVideoSubmit
    ) {

      addVideoSubmit.disabled =
        true;

      addVideoSubmit.textContent =
        "Uploading…";
    }


    if (
      addVideoFile
    ) {

      addVideoFile.disabled =
        true;
    }


    if (
      addVideoProgressWrap
    ) {

      addVideoProgressWrap.style.display =
        "block";
    }


    if (
      addVideoProgress
    ) {

      addVideoProgress.value =
        0;
    }


    if (
      addVideoProgressText
    ) {

      addVideoProgressText.textContent =
        "0%";
    }


    /*
     * Reset the byte-level percentage used by the enhanced ingestion
     * manager.
     */
    addVideoByteUploadPercent =
      0;


    /* ---------------------------------------------------------------
       STEP 5: UPLOAD VIDEO TO BACKBLAZE
    --------------------------------------------------------------- */

    currentStage =
      "uploading";


    /*
     * The visual upload stage begins before the persistent status
     * update so the user gets immediate feedback.
     */
    setIngestionStage(
      "video-upload",
      "active"
    );


    updateIngestionPercent();


    await updateIngestionStatus(
      ingestionId,
      "uploading"
    );


    let uploadResult;


    /*
     * Large files use the multipart Backblaze uploader.
     *
     * The existing uploader reports real byte-level progress through
     * handleUploadProgress(), which now also feeds the headline
     * ingestion percentage.
     */
    if (
      isLargeFile(
        payload.file
      )
    ) {

      console.log(
        "Using Backblaze multipart upload:",
        canonicalFilename,
        formatBytes(
          payload.file.size
        )
      );


      uploadResult =
        await uploadLargeFileToBackblaze(
          payload.file,
          canonicalFilename,
          {
            onProgress:
              handleUploadProgress,

            onStatus:
              handleUploadStatus
          }
        );

    } else {

      /*
       * Normal Backblaze uploads require a complete-file SHA-1.
       *
       * This happens after duplicate detection, so we do not waste time
       * calculating the complete checksum for a known duplicate.
       */
      handleUploadStatus(
        "Calculating checksum…"
      );


      console.log(
        "Calculating SHA-1:",
        canonicalFilename
      );


      const sha1 =
        await calculateFileSha1(
          payload.file
        );


      console.log(
        "SHA-1 calculated:",
        sha1
      );


      /*
       * Obtain a temporary Backblaze upload URL/token.
       *
       * Permanent B2 credentials remain on the server and are never
       * exposed to this browser module.
       */
      handleUploadStatus(
        "Preparing secure Backblaze upload…"
      );


      const {
        data:
          uploadAuth,

        error:
          authError
      } =
        await supabase
          .functions
          .invoke(
            "zulu-upload-authorize",
            {
              body: {
                action:
                  "normal"
              }
            }
          );


      if (
        authError
      ) {

        throw authError;
      }


      if (
        !uploadAuth
          ?.uploadUrl ||
        !uploadAuth
          ?.authorizationToken
      ) {

        throw new Error(
          "Backblaze upload authorization was incomplete."
        );
      }


      handleUploadStatus(
        `Uploading ${canonicalFilename}…`
      );


      uploadResult =
        await uploadFileToBackblaze({
          uploadUrl:
            uploadAuth
              .uploadUrl,

          authorizationToken:
            uploadAuth
              .authorizationToken,

          file:
            payload.file,

          filename:
            canonicalFilename,

          sha1,

          onProgress:
            handleUploadProgress
        });
    }


    /*
     * The MP4 has successfully reached Backblaze.
     *
     * Force both progress systems to 100% for this stage even if the
     * final XHR/multipart callback rounded slightly below 100.
     */
    addVideoByteUploadPercent =
      100;


    if (
      addVideoProgress
    ) {

      addVideoProgress.value =
        100;
    }


    if (
      addVideoProgressText
    ) {

      addVideoProgressText.textContent =
        `100% — ${formatBytes(payload.file.size)}`;
    }


    /*
     * The storage stage is now complete.
     */
    setIngestionStage(
      "video-upload",
      "complete"
    );


    updateIngestionPercent();


    console.log(
      "BACKBLAZE UPLOAD COMPLETE",
      uploadResult
    );


    /* ---------------------------------------------------------------
       STEP 6: BUILD PUBLIC MEDIA URL
    --------------------------------------------------------------- */

    const publicUrl =
      "https://media.zulu-orchid-falcon.co.uk/" +
      encodeB2Filename(
        canonicalFilename
      );


    console.log(
      "PUBLIC VIDEO URL:",
      publicUrl
    );


    /*
     * Record successful storage.
     *
     * This journal write is deliberately best-effort because the MP4
     * is already safely stored in Backblaze.
     *
     * A temporary journal failure here must not cause the UI to claim
     * that the actual MP4 upload failed.
     */
    try {

      await updateIngestionStatus(
        ingestionId,
        "video_uploaded",
        {
          public_url:
            publicUrl,

          ...(
            uploadResult?.fileId
              ? {
                  backblaze_file_id:
                    uploadResult.fileId
                }
              : {}
          )
        }
      );

    } catch (journalError) {

      console.error(
        "Video uploaded but ingestion journal could not record it:",
        journalError
      );
    }


    /* ---------------------------------------------------------------
       STEP 7: CREATE CATALOGUE RECORD
    --------------------------------------------------------------- */

    currentStage =
      "cataloguing";


    /*
     * Catalogue creation is now the active visual stage.
     */
    setIngestionStage(
      "catalogue",
      "active"
    );


    updateIngestionPercent();


    handleUploadStatus(
      "Creating catalogue entry…"
    );


    /*
     * zulu-finalize-video receives the persistent ingestion UUID.
     *
     * The Edge Function owns the protected catalogue stages:
     *
     *     video_uploaded
     *          ↓
     *     cataloguing
     *          ↓
     *     catalogued
     *
     * It also creates:
     *
     *     zulu_videos
     *     actor relationships
     *     search refresh
     *
     * and writes video_uid back to zulu_ingestions.
     */
    const {
      data:
        finalizeData,

      error:
        finalizeError
    } =
      await supabase
        .functions
        .invoke(
          "zulu-finalize-video",
          {
            body: {

              ingestion_id:
                ingestionId,

              film:
                payload.film,

              url:
                publicUrl,

              actors:
                payload.actors,

              tags:
                payload.tags,

              filesize_bytes:
                addVideoMetadata
                  .filesizeBytes,

              duration_seconds:
                addVideoMetadata
                  .durationSeconds,

              width:
                addVideoMetadata
                  .width,

              height:
                addVideoMetadata
                  .height,

              fingerprint:
                addVideoMetadata
                  .fingerprint
            }
          }
        );


    if (
      finalizeError
    ) {

      console.error(
        "CATALOGUE FINALIZE ERROR:",
        finalizeError
      );


      /*
       * zulu-finalize-video owns persistence of catalogue-stage
       * failures, so the browser does not call markIngestionFailed()
       * here.
       *
       * Visually, however, catalogue creation has failed.
       */
      showIngestionFailure(
        "catalogue"
      );


      throw finalizeError;
    }


    if (
      !finalizeData
        ?.success
    ) {

      /*
       * The Edge Function returned normally but reported that
       * finalisation did not succeed.
       */
      showIngestionFailure(
        "catalogue"
      );


      throw new Error(
        finalizeData?.error ||
        "Could not finalize catalogue entry."
      );
    }


    console.log(
      "ZULU VIDEO CATALOGUE COMPLETE:",
      finalizeData
    );


    /*
     * Catalogue entry now exists and the ingestion record should
     * contain video_uid.
     */
    setIngestionStage(
      "catalogue",
      "complete"
    );


    updateIngestionPercent();


    /* ---------------------------------------------------------------
       STEP 8: THUMBNAIL
       ---------------------------------------------------------------

       Thumbnail publishing remains OPTIONAL.

       At this point:

           MP4        ✓
           Catalogue  ✓

       Therefore a thumbnail problem must never undo or invalidate the
       successful video ingestion.

       The visual manager reflects this distinction:

           ✓ = thumbnail published
           ⚠ = default thumbnail will be used
    --------------------------------------------------------------- */

    const thumbnailBlob =
      getSelectedThumbnailBlob();


    let finalThumbnailStatus =
      "skipped";


    if (
      thumbnailBlob
    ) {

      try {

        currentStage =
          "thumbnail_uploading";


        /*
         * Begin visual thumbnail publishing.
         */
        setIngestionStage(
          "thumbnail-upload",
          "active"
        );


        updateIngestionPercent();


        await updateIngestionStatus(
          ingestionId,
          "thumbnail_uploading",
          {
            thumbnail_status:
              "uploading"
          }
        );


        await uploadThumbnailToBackblaze(
          finalizeData.uid,
          thumbnailBlob,
          {
            onStatus:
              handleUploadStatus
          }
        );


        finalThumbnailStatus =
          "uploaded";


        /*
         * Thumbnail is now available from the media store.
         */
        setIngestionStage(
          "thumbnail-upload",
          "complete"
        );


        updateIngestionPercent();

      } catch (thumbnailUploadError) {

        console.error(
          "Thumbnail upload failed:",
          thumbnailUploadError
        );


        /*
         * Do NOT throw.
         *
         * The MP4 and catalogue entry are already valid.
         *
         * The ingestion will ultimately become
         * complete_without_thumbnail.
         */
        finalThumbnailStatus =
          "failed";


        setIngestionStage(
          "thumbnail-upload",
          "warning"
        );


        updateIngestionPercent();
      }

    } else {

      console.warn(
        "No thumbnail available for video UID:",
        finalizeData.uid
      );


      finalThumbnailStatus =
        "skipped";


      /*
       * No thumbnail is a warning rather than a fatal ingestion
       * failure.
       */
      setIngestionStage(
        "thumbnail-upload",
        "warning"
      );


      updateIngestionPercent();
    }


    /* ---------------------------------------------------------------
       STEP 9: COMPLETE INGESTION
       ---------------------------------------------------------------

       uploaded
           → complete

       failed / skipped
           → complete_without_thumbnail

       zulu-ingestion-status is responsible for selecting the final
       persistent status from finalThumbnailStatus.
    --------------------------------------------------------------- */

    await completeIngestion(
      ingestionId,
      finalThumbnailStatus
    );


    /*
     * The persistent ingestion has now reached its final state.
     *
     * Update the visual manager only after the server confirms
     * completion.
     */
    showIngestionComplete(
      finalizeData.uid,
      finalThumbnailStatus
    );


    /* ---------------------------------------------------------------
       STEP 10: NOTIFY PARENT APPLICATION
    --------------------------------------------------------------- */

    addVideoCompleted =
      true;


    if (
      onVideoAdded
    ) {

      await onVideoAdded({
        uid:
          finalizeData.uid,

        data:
          finalizeData
      });
    }


    /* ---------------------------------------------------------------
       STEP 11: DISPLAY SUCCESS
    --------------------------------------------------------------- */

    /*
     * Ensure the native upload bar also remains at 100%.
     */
    if (
      addVideoProgress
    ) {

      addVideoProgress.value =
        100;
    }


    if (
      addVideoProgressText
    ) {

      addVideoProgressText.textContent =
        `100% — ${formatBytes(payload.file.size)}`;
    }


    /*
     * Preserve the existing detailed status message beneath the
     * enhanced ingestion manager.
     */
    if (
      finalThumbnailStatus ===
        "uploaded"
    ) {

      handleUploadStatus(
        `✓ Video added successfully. UID ${finalizeData.uid}`
      );

    } else {

      handleUploadStatus(
        `✓ Video added successfully. UID ${finalizeData.uid} — ` +
        `using default thumbnail.`
      );
    }


    /*
     * Lock the Upload button after success.
     */
    if (
      addVideoSubmit
    ) {

      addVideoSubmit.textContent =
        "Uploaded ✓";
    }


    /*
     * Cancel becomes Close after successful ingestion.
     */
    if (
      addVideoCancel
    ) {

      addVideoCancel.textContent =
        "Close";
    }


  } catch (error) {

    /* ---------------------------------------------------------------
       INGESTION FAILURE
       ---------------------------------------------------------------

       This catch can receive failures from:

           ready journal update
           checksum generation
           Backblaze authorization
           Backblaze upload
           catalogue finalisation
           final completion journal

       Ownership of the persistent error depends on the stage.
    --------------------------------------------------------------- */

    console.error(
      "ZULU UPLOAD FAILED:",
      error
    );


    /*
     * Pre-catalogue failures are recorded here.
     *
     * Catalogue-stage failures are already recorded by
     * zulu-finalize-video.
     */
    if (
      currentStage ===
        "ready" ||
      currentStage ===
        "uploading"
    ) {

      await markIngestionFailed(
        ingestionId,
        currentStage,
        error
      );
    }


    /*
     * Ensure the visual manager identifies the appropriate failing
     * stage.
     *
     * Some failure routes already set the stage before throwing, but
     * doing this defensively makes the UI reliable for unexpected
     * exceptions too.
     */
    if (
      currentStage ===
        "ready"
    ) {

      /*
       * The failure happened while preparing the final ready state.
       * Duplicate checking has already succeeded, so the next logical
       * visible stage is video upload.
       */
      showIngestionFailure(
        "video-upload"
      );

    } else if (
      currentStage ===
        "uploading"
    ) {

      showIngestionFailure(
        "video-upload"
      );

    } else if (
      currentStage ===
        "cataloguing"
    ) {

      showIngestionFailure(
        "catalogue"
      );

    } else if (
      currentStage ===
        "thumbnail_uploading"
    ) {

      /*
       * Normally thumbnail errors are caught inside their own nested
       * try/catch and converted to warnings.
       *
       * Reaching this branch therefore indicates an unexpected error
       * around the thumbnail/completion portion of the workflow.
       */
      showIngestionFailure(
        "thumbnail-upload"
      );
    }


    /*
     * Once catalogue creation has succeeded, thumbnail/completion
     * journal errors must not rewrite the persistent ingestion as a
     * generic pre-upload failure.
     *
     * We preserve that existing behaviour here.
     */
    handleUploadStatus(
      `Upload failed: ${
        error?.message ||
        "Unknown error"
      }`
    );


  } finally {

    /* ---------------------------------------------------------------
       STEP 12: RESTORE UI STATE
    --------------------------------------------------------------- */

    addVideoUploadInProgress =
      false;


    /*
     * File selection is locked only while the actual upload pipeline
     * is running.
     */
    if (
      addVideoFile
    ) {

      addVideoFile.disabled =
        false;
    }


    if (
      addVideoCompleted
    ) {

      /*
       * Successful ingestion remains visible until the modal is closed.
       */
      if (
        addVideoSubmit
      ) {

        addVideoSubmit.disabled =
          true;

        addVideoSubmit.textContent =
          "Uploaded ✓";
      }


      if (
        addVideoCancel
      ) {

        addVideoCancel.textContent =
          "Close";
      }

    } else {

      /*
       * Failed or interrupted workflows can be inspected and, where
       * appropriate, retried/reselected.
       */
      if (
        addVideoSubmit
      ) {

        addVideoSubmit.disabled =
          false;

        addVideoSubmit.textContent =
          "Upload Video";
      }


      if (
        addVideoCancel
      ) {

        addVideoCancel.textContent =
          "Cancel";
      }
    }
  }
}


