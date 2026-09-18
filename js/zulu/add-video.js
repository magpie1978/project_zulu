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

   This module controls the complete "Add Video" workflow for the
   Zulu Videos catalogue.

   It coordinates several parts of the ingestion pipeline:

   1. Opens and manages the Add Video modal.
   2. Accepts a local MP4 file selected by the user.
   3. Derives the initial film title from the filename.
   4. Attempts to identify actor names from the title.
   5. Provides autocomplete using the existing actor catalogue.
   6. Reads local video metadata:
        - file size
        - duration
        - width
        - height
   7. Creates a lightweight content fingerprint for duplicate detection.
   8. Checks Supabase for an existing video with that fingerprint.
   9. Generates thumbnail candidates.
   10. Uploads the MP4 to Backblaze B2:
        - normal upload for smaller files
        - multipart upload for large files
   11. Builds the public media URL.
   12. Calls the zulu-finalize-video Supabase Edge Function to create
       the catalogue/database records.
   13. Uploads the selected thumbnail.
   14. Notifies the parent application when ingestion is complete.

   IMPORTANT
   ---------

   This module coordinates the workflow but delegates specialised work
   to other modules:

       upload.js
           Backblaze upload mechanics, checksums and filename encoding.

       thumbnails.js
           Thumbnail generation, selection and upload.

       utils.js
           General formatting helpers.

       supabaseClient.js
           Shared Supabase client.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
   =====================================================================

   Cache all Add Video interface elements used by this module.
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
   =====================================================================

   addVideoUploadInProgress
       Prevents the modal being closed while a video is uploading.

   addVideoCompleted
       Records whether the current ingestion completed successfully.
       This controls the modal's final button state and form reset.

   addVideoMetadata
       Metadata and fingerprint extracted from the currently selected
       local MP4.

   zuluActorNames
       Cached list of existing actors used by autocomplete.

   onVideoAdded
       Optional callback supplied by the parent application. Called
       after a new video has been successfully added to the catalogue.
===================================================================== */

let addVideoUploadInProgress = false;
let addVideoCompleted = false;
let addVideoMetadata = null;

let zuluActorNames = [];

let onVideoAdded = null;


/* =====================================================================
   03. INITIALISATION / EVENT BINDING
===================================================================== */

/**
 * Attaches all event listeners required by the Add Video interface.
 *
 * The optional onAdded callback allows the parent application to
 * refresh the catalogue/sidebar after a successful upload.
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


  /*
   * Clicking the backdrop closes the modal, but never while an
   * upload is in progress.
   */
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


  /*
   * Selecting a local MP4 begins metadata analysis and thumbnail
   * generation.
   */
  addVideoFile?.addEventListener(
    "change",
    handleFileSelection
  );


  /*
   * Allows additional actors to be entered manually.
   */
  addVideoAddActor?.addEventListener(
    "click",
    handleAddActor
  );


  /*
   * Begins validation, duplicate checking and upload.
   */
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
 *
 * Ensures at least one actor input exists and loads the existing actor
 * catalogue for autocomplete.
 */
function openAddVideoModal() {

  addVideoCompleted = false;

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


  /*
   * Actor names are cached after the first successful load, so this
   * normally results in only one Supabase request per page session.
   */
  loadZuluActorNames();
}


/**
 * Closes the Add Video modal.
 *
 * Closing is deliberately blocked during an active upload so that the
 * interface cannot accidentally abandon an upload in progress.
 *
 * After a successful upload, closing also resets the form ready for
 * the next video.
 */
function closeAddVideoModal() {

  if (
    addVideoUploadInProgress
  ) {

    if (addVideoStatus) {
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


  if (addVideoCompleted) {
    resetAddVideoForm();
  }
}


/**
 * Restores the Add Video form to its initial state.
 *
 * Clears:
 *   - selected file
 *   - metadata
 *   - title
 *   - actors
 *   - tags
 *   - status messages
 *   - upload progress
 *   - thumbnail state
 *
 * A fresh blank actor row is added at the end.
 */
function resetAddVideoForm() {

  if (addVideoFile) {
    addVideoFile.value = "";
  }


  addVideoMetadata = null;


  if (addVideoTitle) {
    addVideoTitle.value = "";
  }


  if (addVideoActors) {
    addVideoActors.innerHTML = "";
  }


  if (addVideoTags) {
    addVideoTags.value = "";
  }


  if (addVideoFileInfo) {
    addVideoFileInfo.textContent = "";
  }


  if (addVideoStatus) {
    addVideoStatus.textContent = "";
  }


  if (addVideoProgress) {
    addVideoProgress.value = 0;
  }


  if (addVideoProgressText) {
    addVideoProgressText.textContent = "";
  }


  if (addVideoProgressWrap) {
    addVideoProgressWrap.style.display =
      "none";
  }


  if (addVideoSubmit) {
    addVideoSubmit.disabled = false;

    addVideoSubmit.textContent =
      "Upload Video";
  }


  if (addVideoCancel) {
    addVideoCancel.textContent =
      "Cancel";
  }


  addVideoCompleted = false;


  addActorRow();

  resetThumbnailState();
}


/* =====================================================================
   05. ACTOR CATALOGUE
===================================================================== */

/**
 * Loads the existing actor catalogue from Supabase.
 *
 * zulu_distinct_actors returns the unique actor names already present
 * in zulu_actors. These names power the actor autocomplete fields in
 * the Add Video form.
 *
 * Results are cached in zuluActorNames. Once successfully loaded, the
 * function does not query Supabase again during the current page
 * session.
 */
async function loadZuluActorNames() {

  if (zuluActorNames.length) {
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


    if (error) {
      throw error;
    }


    /*
     * Trim names, discard blank values and defensively remove
     * duplicates before storing the autocomplete catalogue.
     */
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
 * Adds an actor input row to the form.
 *
 * Each row contains:
 *   - actor text input
 *   - autocomplete results container
 *   - remove button
 *
 * An optional value can pre-populate the field, which is used when
 * actor names have been inferred from the filename.
 *
 * @param {string} value
 */
function addActorRow(
  value = ""
) {

  if (!addVideoActors) {
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

  input.type = "text";

  input.className =
    "add-video-actor-input";

  input.placeholder =
    "Actor name";

  input.autocomplete =
    "off";

  input.value =
    value;


  /*
   * Each actor field owns its own autocomplete results container.
   */
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
 * Handles the Add Actor button.
 *
 * Creates another blank actor field and moves keyboard focus directly
 * into the newly created input.
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
 *
 * Matching:
 *   - is case-insensitive;
 *   - matches anywhere within the actor name;
 *   - is limited to the first 10 results.
 *
 * Selecting a suggestion inserts the canonical existing actor name
 * into the input.
 *
 * @param {HTMLInputElement} input
 * @param {HTMLElement} container
 */
function showActorSuggestions(
  input,
  container
) {

  const value =
    input.value
      .trim()
      .toLowerCase();


  container.innerHTML = "";


  if (value.length < 1) {

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
            .includes(value)
      )
      .slice(
        0,
        10
      );


  if (!matches.length) {

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


    /*
     * mousedown is used rather than click so selection occurs before
     * the input potentially loses focus.
     */
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
 * Attempts to infer actor names from the proposed film title.
 *
 * The expected naming convention is broadly:
 *
 *     Actor A with Actor B
 *
 * It also understands multiple secondary actors separated by:
 *
 *     &
 *     and
 *     ,
 *
 * Examples:
 *
 *     Actor A with Actor B
 *     Actor A with Actor B & Actor C
 *     Actor A with Actor B and Actor C
 *
 * It also removes:
 *
 *     PREVIEW -
 *
 * from the beginning of a title and strips some trailing title
 * annotations such as:
 *
 *     - description
 *     #2
 *
 * If no actors can be inferred, a single blank actor row is created.
 *
 * @param {string} title
 */
function suggestActorsFromTitle(
  title
) {

  if (!addVideoActors) {
    return;
  }


  /*
   * Replace any existing actor rows whenever a new file is selected.
   */
  addVideoActors.innerHTML =
    "";


  let workingTitle =
    title
      .replace(
        /^PREVIEW\s*-\s*/i,
        ""
      )
      .trim();


  const actors = [];


  /*
   * Split the title around the first "with".
   *
   * Group 1 = primary actor
   * Group 2 = remaining actor section
   */
  const withMatch =
    workingTitle.match(
      /^(.+?)\s+with\s+(.+)$/i
    );


  if (withMatch) {

    actors.push(
      withMatch[1].trim()
    );


    /*
     * Remove trailing descriptive/title markers from the secondary
     * actor portion before splitting it into individual names.
     */
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


    /*
     * Normalise "and" to "&", then accept comma or ampersand as
     * actor separators.
     */
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


  /*
   * If the filename does not match the expected naming convention,
   * leave the user with a normal blank actor field.
   */
  if (!actors.length) {

    addActorRow();

    return;
  }


  /*
   * Prevent the same actor being suggested twice.
   */
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
   09. FILE SELECTION
===================================================================== */

/**
 * Handles selection of a local MP4.
 *
 * Immediately:
 *
 *   1. clears metadata from any previously selected file;
 *   2. derives the proposed film title from the filename;
 *   3. displays the filename and file size;
 *   4. attempts to identify actors from the title;
 *   5. starts asynchronous video analysis.
 */
function handleFileSelection() {

  const file =
    addVideoFile
      ?.files?.[0];


  /*
   * Metadata from a previous file must never be reused.
   */
  addVideoMetadata = null;


  if (!file) {

    if (addVideoFileInfo) {
      addVideoFileInfo.textContent =
        "";
    }

    return;
  }


  const filename =
    file.name;


  /*
   * The initial catalogue title is simply the filename without
   * its .mp4 extension. The user can edit it before upload.
   */
  const title =
    filename.replace(
      /\.mp4$/i,
      ""
    );


  if (addVideoTitle) {
    addVideoTitle.value =
      title;
  }


  const sizeMB =
    file.size /
    (1024 * 1024);


  if (addVideoFileInfo) {

    addVideoFileInfo.textContent =
      `${filename} — ${sizeMB.toFixed(1)} MB`;
  }


  suggestActorsFromTitle(
    title
  );


  /*
   * Metadata extraction and thumbnail generation can take time, so
   * they run asynchronously after the immediate UI updates above.
   */
  analyseSelectedFile(
    file
  );
}


/* =====================================================================
   10. VIDEO ANALYSIS / FINGERPRINTING
===================================================================== */

/**
 * Calculates a SHA-256 hash for a Blob.
 *
 * Used by the fingerprinting system to hash selected chunks of the
 * video without hashing the entire potentially multi-gigabyte file.
 *
 * @param {Blob} blob
 * @returns {Promise<string>} Lowercase hexadecimal SHA-256 hash.
 */
async function sha256Blob(blob) {

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
          .padStart(2, "0")
    )
    .join("");
}


/**
 * Reads metadata from the selected local video and creates a content
 * fingerprint used for duplicate detection.
 *
 * Native browser video metadata supplies:
 *
 *   duration
 *   width
 *   height
 *
 * The fingerprint uses:
 *
 *   file size
 *   SHA-256 of first 4 MB
 *   SHA-256 of middle 4 MB
 *   SHA-256 of final 4 MB
 *
 * Those values are combined and SHA-256 hashed again to produce one
 * compact fingerprint.
 *
 * This avoids reading/hashing the entire video while still producing
 * a strong identifier based on several parts of the file.
 *
 * The temporary object URL is always revoked in the finally block.
 *
 * @param {File} file
 * @returns {Promise<Object>}
 */
async function extractVideoMetadata(file) {

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

  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;


  try {

    /*
     * Wait until the browser has read the MP4 metadata.
     */
    await new Promise(
      (resolve, reject) => {

        video.addEventListener(
          "loadedmetadata",
          resolve,
          {
            once: true
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
            once: true
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
     * Fingerprint three 4 MB samples rather than hashing the complete
     * video file.
     */
    const sampleSize =
      4 * 1024 * 1024;


    /* First 4 MB */

    const firstChunk =
      file.slice(
        0,
        Math.min(
          sampleSize,
          file.size
        )
      );


    /* Middle 4 MB */

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


    /* Final 4 MB */

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
     * Hash all three samples concurrently.
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
     * File size is included so two files containing identical sampled
     * chunks but different overall lengths do not share a fingerprint.
     */
    const fingerprintSource =
      [
        file.size,
        firstSha256,
        middleSha256,
        lastSha256
      ].join("|");


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
     * Always release the temporary video resources.
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
 * Coordinates analysis of the currently selected file.
 *
 * First extracts metadata/fingerprint, then generates thumbnail
 * candidates.
 *
 * The selected file is checked again after metadata extraction. This
 * prevents a slower analysis of an old file from overwriting state if
 * the user selects another file before the first analysis finishes.
 *
 * @param {File} file
 */
async function analyseSelectedFile(
  file
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
     * The user may have selected another file while metadata extraction
     * was running. Ignore this result if it is now stale.
     */
    if (
      addVideoFile
        ?.files?.[0] !== file
    ) {

      console.log(
        "Ignoring analysis result for previous file."
      );

      return;
    }


/* -----------------------------------------------------------------
   GENERATE THUMBNAIL CANDIDATES
   -----------------------------------------------------------------

   Thumbnail generation is an OPTIONAL part of ingestion.

   The video's metadata, fingerprint, duplicate detection and Backblaze
   upload are more important than automatically generating a thumbnail.

   Thumbnail generation depends on several browser/external components:

       - MediaPipe Tasks Vision;
       - the MediaPipe WASM runtime;
       - the BlazeFace model;
       - browser video seeking;
       - canvas frame extraction.

   A temporary failure in any of these components must therefore NOT
   prevent an otherwise valid MP4 from being added to the catalogue.

   If thumbnail generation fails:

       - log the full error for debugging;
       - reset any partially generated thumbnail state;
       - show a non-fatal status message;
       - continue with the rest of video ingestion.

   getSelectedThumbnailBlob() will subsequently return null, allowing
   the submission stage to skip thumbnail publishing.
----------------------------------------------------------------- */

try {

    await generateThumbnailCandidates(
      file
    );
  
  } catch (thumbnailError) {
  
    console.error(
      "Thumbnail generation failed:",
      thumbnailError
    );
  
  
    /*
     * Remove any partial candidates or preview state that may have been
     * created before thumbnail generation failed.
     *
     * The cached MediaPipe detector itself is deliberately retained by
     * resetThumbnailState().
     */
    resetThumbnailState();
  
  
    /*
     * This is informational only.
     *
     * Do NOT throw thumbnailError here. Throwing it would make thumbnail
     * generation a fatal dependency of the complete ingestion process.
     */
    if (
      addVideoThumbnailStatus
    ) {
  
      addVideoThumbnailStatus.textContent =
        "Thumbnail generation failed — video can still be uploaded.";
    }
  }
  } catch (error) {

    console.error(
      "VIDEO ANALYSIS ERROR:",
      error
    );


    addVideoMetadata = null;


    if (
      addVideoThumbnailStatus
    ) {

      addVideoThumbnailStatus.textContent =
        "Could not analyse this video.";
    }
  }
}


/* =====================================================================
   11. DUPLICATE DETECTION
===================================================================== */

/**
 * Looks for an existing catalogue record with the same video
 * fingerprint.
 *
 * A matching fingerprint is treated as a possible duplicate and stops
 * the upload before any file is sent to Backblaze.
 *
 * @param {string} fingerprint
 * @returns {Promise<Object|null>}
 */
async function findDuplicateVideoByFingerprint(
  fingerprint
) {

  if (!fingerprint) {
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


  if (error) {
    throw error;
  }


  return data || null;
}


/* =====================================================================
   12. BUILD SUBMISSION PAYLOAD
===================================================================== */

/**
 * Collects the current Add Video form values into a single normalised
 * object for validation and upload.
 *
 * Actor names are:
 *   - trimmed;
 *   - blank values removed;
 *   - deduplicated.
 *
 * Tags are expected as comma-separated text and converted into an
 * array of trimmed non-empty values.
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
          ) || []
      )
    ]
      .map(
        input =>
          input.value.trim()
      )
      .filter(Boolean);


  const tags =
    (addVideoTags?.value || "")
      .split(",")
      .map(
        tag =>
          tag.trim()
      )
      .filter(Boolean);


  return {
    file,

    filename:
      file?.name || null,

    film:
      addVideoTitle
        ?.value
        .trim() || "",

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
   13. STATUS / PROGRESS HELPERS
===================================================================== */

/**
 * Displays a workflow/status message in the Add Video modal.
 *
 * This function is also passed to upload helpers as an onStatus
 * callback.
 *
 * @param {string} message
 */
function handleUploadStatus(
  message
) {

  if (addVideoStatus) {

    addVideoStatus.textContent =
      message;
  }
}


/**
 * Updates the upload progress bar and its accompanying text.
 *
 * This function is passed to the Backblaze upload helpers as their
 * onProgress callback.
 *
 * @param {Object} progress
 * @param {number} progress.percent
 * @param {string} progress.text
 */
function handleUploadProgress({
  percent,
  text
}) {

  if (addVideoProgress) {

    addVideoProgress.value =
      percent;
  }


  if (addVideoProgressText) {

    addVideoProgressText.textContent =
      text;
  }
}


/* =====================================================================
   14. SUBMISSION / INGESTION PIPELINE
   =====================================================================

   handleSubmit() is the main orchestration function for ingestion.

   The workflow is:

       Validate form
           ↓
       Verify metadata analysis completed
           ↓
       Check fingerprint for duplicate
           ↓
       Build canonical filename
           ↓
       Lock upload UI
           ↓
       Upload MP4 to Backblaze
           ↓
       Build public media URL
           ↓
       Call zulu-finalize-video
           ↓
       Upload selected thumbnail
           ↓
       Notify parent application
           ↓
       Mark upload complete
===================================================================== */

/**
 * Validates and processes the complete Add Video submission.
 *
 * This is intentionally an orchestration function: lower-level upload,
 * fingerprinting and thumbnail operations are delegated to specialised
 * helpers/modules.
 */
async function handleSubmit() {

  const payload =
    getAddVideoPayload();


  /* -----------------------------------------------------------------
     STEP 1: VALIDATE FORM
  ----------------------------------------------------------------- */

  if (!payload.file) {

    handleUploadStatus(
      "Please choose an MP4 file."
    );

    return;
  }


  if (!payload.film) {

    handleUploadStatus(
      "Please enter a film title."
    );

    return;
  }


  if (!payload.actors.length) {

    handleUploadStatus(
      "Please add at least one actor."
    );

    return;
  }


  if (
    !payload.filename
      .toLowerCase()
      .endsWith(".mp4")
  ) {

    handleUploadStatus(
      "Only MP4 files are currently supported."
    );

    return;
  }


  /*
   * File analysis must complete before upload because its metadata and
   * fingerprint are required later in the ingestion pipeline.
   */
  if (!addVideoMetadata) {

    handleUploadStatus(
      "Please wait for video analysis to finish."
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


    /*
     * Do not continue with an upload if duplicate detection itself
     * failed. It is safer to stop than risk creating a duplicate.
     */
    handleUploadStatus(
      `Duplicate check failed: ${
        error?.message ||
        "Unknown error"
      }`
    );

    return;
  }


  if (duplicateVideo) {

    handleUploadStatus(
      `Possible duplicate: "${duplicateVideo.film}" ` +
      `(UID ${duplicateVideo.uid}). ` +
      `Nothing has been uploaded.`
    );


    console.warn(
      "DUPLICATE VIDEO DETECTED:",
      duplicateVideo
    );


    return;
  }


  /* -----------------------------------------------------------------
     STEP 3: BUILD CANONICAL BACKBLAZE FILENAME
  ----------------------------------------------------------------- */

  /*
   * The catalogue film title becomes the canonical stored filename.
   *
   * Example:
   *
   *     Hugo Dupre with Eduell Levine
   *
   * becomes:
   *
   *     Hugo Dupre with Eduell Levine.mp4
   */
  const canonicalFilename =
    `${payload.film}.mp4`;


  try {

    /* ---------------------------------------------------------------
       STEP 4: LOCK UPLOAD UI
    --------------------------------------------------------------- */

    addVideoUploadInProgress =
      true;

    addVideoCompleted =
      false;


    if (addVideoSubmit) {

      addVideoSubmit.disabled =
        true;

      addVideoSubmit.textContent =
        "Uploading…";
    }


    if (addVideoFile) {

      addVideoFile.disabled =
        true;
    }


    if (addVideoProgressWrap) {

      addVideoProgressWrap
        .style.display =
          "block";
    }


    if (addVideoProgress) {

      addVideoProgress.value =
        0;
    }


    if (addVideoProgressText) {

      addVideoProgressText
        .textContent =
          "0%";
    }


    /* ---------------------------------------------------------------
       STEP 5: UPLOAD VIDEO TO BACKBLAZE
    --------------------------------------------------------------- */

    let uploadResult;


    /*
     * Large files use Backblaze multipart upload.
     *
     * uploadLargeFileToBackblaze() handles the multipart mechanics
     * internally and reports progress/status through callbacks.
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
       * Normal Backblaze uploads require a SHA-1 checksum of the
       * complete file.
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
       * Request a short-lived Backblaze upload URL/token from the
       * server-side Edge Function. Backblaze credentials therefore do
       * not need to be exposed directly in the browser.
       */
      handleUploadStatus(
        "Preparing secure Backblaze upload…"
      );


      const {
        data: uploadAuth,
        error: authError
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


      if (authError) {
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
     * At this point the MP4 itself has successfully reached Backblaze.
     */
    if (addVideoProgress) {

      addVideoProgress.value =
        100;
    }


    if (addVideoProgressText) {

      addVideoProgressText
        .textContent =
          `100% — ${formatBytes(payload.file.size)}`;
    }


    console.log(
      "BACKBLAZE UPLOAD COMPLETE",
      uploadResult
    );


    /* ---------------------------------------------------------------
       STEP 6: BUILD PUBLIC MEDIA URL
    --------------------------------------------------------------- */

    /*
     * The site's Cloudflare media hostname is used rather than exposing
     * the raw Backblaze B2 URL.
     */
    const publicUrl =
      "https://media.zulu-orchid-falcon.co.uk/" +
      encodeB2Filename(
        canonicalFilename
      );


    console.log(
      "PUBLIC VIDEO URL:",
      publicUrl
    );


    /* ---------------------------------------------------------------
       STEP 7: CREATE CATALOGUE RECORDS
    --------------------------------------------------------------- */

    handleUploadStatus(
      "Creating catalogue entry…"
    );


    /*
     * zulu-finalize-video performs the server-side database work after
     * the MP4 has successfully uploaded.
     *
     * It receives:
     *
     *   film title
     *   public media URL
     *   actors
     *   tags
     *   file size
     *   duration
     *   dimensions
     *   duplicate-detection fingerprint
     */
    const {
      data: finalizeData,
      error: finalizeError
    } =
      await supabase
        .functions
        .invoke(
          "zulu-finalize-video",
          {
            body: {

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


    if (finalizeError) {

      console.error(
        "CATALOGUE FINALIZE ERROR:",
        finalizeError
      );

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
   STEP 8: UPLOAD SELECTED THUMBNAIL
   ---------------------------------------------------------------

   Thumbnail publishing is OPTIONAL.

   Normally getSelectedThumbnailBlob() contains the best thumbnail
   generated during video analysis.

   However, thumbnail generation may have failed because MediaPipe,
   WASM, the BlazeFace model, video seeking or canvas processing was
   unavailable.

   Likewise, the thumbnail itself may fail to upload to Backblaze.

   Neither situation should cause the completed video ingestion to
   fail because, at this point:

       - the MP4 has already been uploaded successfully;
       - the catalogue entry has already been created successfully.

   The video can therefore remain in the catalogue and use the site's
   normal fallback/default thumbnail.
----------------------------------------------------------------- */
    
    const thumbnailBlob =
      getSelectedThumbnailBlob();
    
    
    if (thumbnailBlob) {
    
      try {
    
        await uploadThumbnailToBackblaze(
          finalizeData.uid,
          thumbnailBlob,
          {
            onStatus:
              handleUploadStatus
          }
        );
    
      } catch (thumbnailUploadError) {
    
        /*
         * Thumbnail publishing failed, but the video itself has already
         * been successfully ingested.
         *
         * Log the failure for debugging but deliberately do NOT rethrow it.
         */
        console.error(
          "Thumbnail upload failed:",
          thumbnailUploadError
        );
      }
    
    } else {
    
      /*
       * Thumbnail generation produced no usable thumbnail.
       *
       * This is non-fatal. The catalogue can display its normal fallback
       * thumbnail instead.
       */
      console.warn(
        "No thumbnail available for video UID:",
        finalizeData.uid
      );
    }
    /* ---------------------------------------------------------------
       STEP 9: NOTIFY PARENT APPLICATION
    --------------------------------------------------------------- */

    addVideoCompleted =
      true;


    if (onVideoAdded) {

      await onVideoAdded({
        uid:
          finalizeData.uid,

        data:
          finalizeData
      });
    }


    /* ---------------------------------------------------------------
       STEP 10: DISPLAY SUCCESS STATE
    --------------------------------------------------------------- */

    if (addVideoProgress) {

      addVideoProgress.value =
        100;
    }


    if (addVideoProgressText) {

      addVideoProgressText
        .textContent =
          `100% — ${formatBytes(payload.file.size)}`;
    }


    handleUploadStatus(
      `✓ Video added successfully. UID ${finalizeData.uid}`
    );


    if (addVideoSubmit) {

      addVideoSubmit.textContent =
        "Uploaded ✓";
    }


    if (addVideoCancel) {

      addVideoCancel.textContent =
        "Close";
    }

  } catch (error) {

    /* ---------------------------------------------------------------
       UPLOAD / INGESTION FAILURE
    --------------------------------------------------------------- */

    console.error(
      "ZULU UPLOAD FAILED:",
      error
    );


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


    if (addVideoFile) {

      addVideoFile.disabled =
        false;
    }


    /*
     * Successful upload:
     *
     * Keep Upload disabled and turn Cancel into Close.
     *
     * Failed upload:
     *
     * Restore controls so the user can correct/retry the upload.
     */
    if (addVideoCompleted) {

      if (addVideoSubmit) {

        addVideoSubmit.disabled =
          true;

        addVideoSubmit.textContent =
          "Uploaded ✓";
      }


      if (addVideoCancel) {

        addVideoCancel.textContent =
          "Close";
      }

    } else {

      if (addVideoSubmit) {

        addVideoSubmit.disabled =
          false;

        addVideoSubmit.textContent =
          "Upload Video";
      }


      if (addVideoCancel) {

        addVideoCancel.textContent =
          "Cancel";
      }
    }
  }
}
