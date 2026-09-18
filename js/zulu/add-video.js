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

   The workflow is now persistent. A zulu_ingestions record is created
   as soon as a local MP4 is selected and is updated as the video moves
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
function closeAddVideoModal() {

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


  addVideoModal?.classList.remove(
    "open"
  );


  addVideoModal?.setAttribute(
    "aria-hidden",
    "true"
  );


  if (
    addVideoCompleted
  ) {

    resetAddVideoForm();
  }
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
   10. FILE SELECTION
===================================================================== */

/**
 * Handles selection of a local MP4.
 *
 * The ingestion record is created BEFORE video analysis begins.
 */
async function handleFileSelection() {

  const file =
    addVideoFile
      ?.files?.[0];


  /*
   * Invalidate any older asynchronous analysis immediately.
   */
  const analysisToken =
    ++addVideoAnalysisToken;


  addVideoMetadata =
    null;


  resetThumbnailState();


  /*
   * If another file had already created an ingestion but had not begun
   * uploading, preserve that history by marking it cancelled.
   */
  const previousIngestionId =
    addVideoIngestionId;


  addVideoIngestionId =
    null;


  if (
    previousIngestionId &&
    !addVideoUploadInProgress
  ) {

    await cancelIngestion(
      previousIngestionId
    );
  }


  if (
    !file
  ) {

    if (
      addVideoFileInfo
    ) {

      addVideoFileInfo.textContent =
        "";
    }

    return;
  }


  const filename =
    file.name;


  const title =
    filename.replace(
      /\.mp4$/i,
      ""
    );


  if (
    addVideoTitle
  ) {

    addVideoTitle.value =
      title;
  }


  const sizeMB =
    file.size /
    (1024 * 1024);


  if (
    addVideoFileInfo
  ) {

    addVideoFileInfo.textContent =
      `${filename} — ${sizeMB.toFixed(1)} MB`;
  }


  suggestActorsFromTitle(
    title
  );


  /*
   * Create the persistent journal before analysis starts.
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
     * The user may have selected another file while the Edge Function
     * request was running.
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
     * Analysis has now officially started.
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


    if (
      analysisToken ===
        addVideoAnalysisToken
    ) {

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
   11. VIDEO ANALYSIS / FINGERPRINTING
===================================================================== */

/**
 * Calculates a SHA-256 hash for a Blob.
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
 * Reads video metadata and generates a lightweight content fingerprint.
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


    const firstChunk =
      file.slice(
        0,
        Math.min(
          sampleSize,
          file.size
        )
      );


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
     * Thumbnail generation remains OPTIONAL.
     */
    try {

      await generateThumbnailCandidates(
        file
      );


      await updateIngestionStatus(
        ingestionId,
        "analysing",
        {
          thumbnail_status:
            "ready"
        }
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
       * Thumbnail failure is non-fatal.
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
    }

  } catch (error) {

    console.error(
      "VIDEO ANALYSIS ERROR:",
      error
    );


    addVideoMetadata =
      null;


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
  }
}


/* =====================================================================
   12. DUPLICATE DETECTION
===================================================================== */

/**
 * Looks for an existing catalogue record with the same fingerprint.
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
   13. BUILD SUBMISSION PAYLOAD
===================================================================== */

/**
 * Collects and normalises the Add Video form values.
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
   14. STATUS / PROGRESS HELPERS
===================================================================== */

/**
 * Displays the current workflow message.
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
 * Updates the Backblaze upload progress bar.
 */
function handleUploadProgress({
  percent,
  text
}) {

  if (
    addVideoProgress
  ) {

    addVideoProgress.value =
      percent;
  }


  if (
    addVideoProgressText
  ) {

    addVideoProgressText.textContent =
      text;
  }
}


/* =====================================================================
   15. SUBMISSION / INGESTION PIPELINE
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

===================================================================== */

/**
 * Processes the complete Add Video submission.
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
   * Every upload now requires its persistent ingestion record.
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


  /* -----------------------------------------------------------------
     STEP 3: BUILD CANONICAL FILENAME
  ----------------------------------------------------------------- */

  const canonicalFilename =
    `${payload.film}.mp4`;


  let currentStage =
    "ready";


  try {

    /*
     * Persist the final title and analysis-derived fingerprint.
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


    /* ---------------------------------------------------------------
       STEP 5: UPLOAD VIDEO TO BACKBLAZE
    --------------------------------------------------------------- */

    currentStage =
      "uploading";


    await updateIngestionStatus(
      ingestionId,
      "uploading"
    );


    let uploadResult;


    /*
     * Large files use multipart upload.
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
     * This journal write is best-effort because the MP4 is already
     * safely stored. A temporary journal failure must not cause the UI
     * to claim that the MP4 itself failed to upload.
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


    handleUploadStatus(
      "Creating catalogue entry…"
    );


    /*
     * zulu-finalize-video now receives ingestion_id.
     *
     * That function owns:
     *
     *     video_uploaded → cataloguing → catalogued
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
       * zulu-finalize-video records catalogue-stage failures itself.
       */
      throw finalizeError;
    }


    if (
      !finalizeData
        ?.success
    ) {

      throw new Error(
        finalizeData?.error ||
        "Could not finalize catalogue entry."
      );
    }


    console.log(
      "ZULU VIDEO CATALOGUE COMPLETE:",
      finalizeData
    );


    /* ---------------------------------------------------------------
       STEP 8: THUMBNAIL
       ---------------------------------------------------------------

       Thumbnail publishing remains OPTIONAL.

       At this point:

           MP4       ✓
           Catalogue ✓

       Therefore a thumbnail problem must not undo or invalidate the
       successful video ingestion.
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

      } catch (thumbnailUploadError) {

        console.error(
          "Thumbnail upload failed:",
          thumbnailUploadError
        );


        /*
         * Do not throw.
         *
         * The MP4 and catalogue entry are already valid.
         */
        finalThumbnailStatus =
          "failed";
      }

    } else {

      console.warn(
        "No thumbnail available for video UID:",
        finalizeData.uid
      );


      finalThumbnailStatus =
        "skipped";
    }


    /* ---------------------------------------------------------------
       STEP 9: COMPLETE INGESTION
       ---------------------------------------------------------------

       uploaded
           → complete

       failed / skipped
           → complete_without_thumbnail
    --------------------------------------------------------------- */

    await completeIngestion(
      ingestionId,
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


    if (
      addVideoSubmit
    ) {

      addVideoSubmit.textContent =
        "Uploaded ✓";
    }


    if (
      addVideoCancel
    ) {

      addVideoCancel.textContent =
        "Close";
    }

  } catch (error) {

    /* ---------------------------------------------------------------
       INGESTION FAILURE
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
     * Once catalogue creation has succeeded, thumbnail/completion
     * journal errors must not rewrite the ingestion as a generic
     * upload failure.
     */
    handleUploadStatus(
      `Upload failed: ${
        error?.message ||
        "Unknown error"
      }`
    );

  } finally {

    /* ---------------------------------------------------------------
       RESTORE UI STATE
    --------------------------------------------------------------- */

    addVideoUploadInProgress =
      false;


    if (
      addVideoFile
    ) {

      addVideoFile.disabled =
        false;
    }


    if (
      addVideoCompleted
    ) {

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
