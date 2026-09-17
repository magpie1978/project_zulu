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


/* =================================================================================================================
   DOM ELEMENTS
==================================================================================================================== */

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


/* =================================================================================================================
   STATE
==================================================================================================================== */

let addVideoUploadInProgress = false;
let addVideoCompleted = false;
let addVideoMetadata = null;

let zuluActorNames = [];

let onVideoAdded = null;


/* =================================================================================================================
   INITIALISATION
==================================================================================================================== */

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


/* =================================================================================================================
   ENCRYPTION / METADATA HELPERS
==================================================================================================================== */

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
    video.pause();

    video.removeAttribute(
      "src"
    );

    URL.revokeObjectURL(
      objectUrl
    );
  }
}


/* =================================================================================================================
   DUPLICATE FILE CHECK
==================================================================================================================== */

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


/* =================================================================================================================
   MODAL
==================================================================================================================== */

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

  loadZuluActorNames();
}


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


/* =================================================================================================================
   ACTOR CATALOGUE
==================================================================================================================== */

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


/* =================================================================================================================
   FILE SELECTION
==================================================================================================================== */

function handleFileSelection() {
  const file =
    addVideoFile
      ?.files?.[0];

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

  analyseSelectedFile(
    file
  );
}


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

    if (
      addVideoFile
        ?.files?.[0] !== file
    ) {
      console.log(
        "Ignoring analysis result for previous file."
      );

      return;
    }

    await generateThumbnailCandidates(
      file
    );

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


/* =================================================================================================================
   ACTOR ROWS
==================================================================================================================== */

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


/* =================================================================================================================
   ACTOR AUTOCOMPLETE
==================================================================================================================== */

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


/* =================================================================================================================
   ACTOR SUGGESTIONS FROM FILENAME
==================================================================================================================== */

function suggestActorsFromTitle(
  title
) {
  if (!addVideoActors) {
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

  const actors = [];

  const withMatch =
    workingTitle.match(
      /^(.+?)\s+with\s+(.+)$/i
    );

  if (withMatch) {
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

  if (!actors.length) {
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


/* =================================================================================================================
   BUILD PAYLOAD
==================================================================================================================== */

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


/* =================================================================================================================
   UPLOAD STATUS
==================================================================================================================== */

function handleUploadStatus(
  message
) {
  if (addVideoStatus) {
    addVideoStatus.textContent =
      message;
  }
}


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


/* =================================================================================================================
   SUBMIT
==================================================================================================================== */

async function handleSubmit() {
  const payload =
    getAddVideoPayload();

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

  if (!addVideoMetadata) {
    handleUploadStatus(
      "Please wait for video analysis to finish."
    );

    return;
  }

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

  const canonicalFilename =
    `${payload.film}.mp4`;

  try {
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

    let uploadResult;

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

    const publicUrl =
      "https://media.zulu-orchid-falcon.co.uk/" +
      encodeB2Filename(
        canonicalFilename
      );

    console.log(
      "PUBLIC VIDEO URL:",
      publicUrl
    );

    handleUploadStatus(
      "Creating catalogue entry…"
    );

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

    const selectedThumbnailBlob =
      getSelectedThumbnailBlob();

    if (
      selectedThumbnailBlob
    ) {
      await uploadThumbnailToBackblaze(
        finalizeData.uid,
        selectedThumbnailBlob,
        {
          onStatus:
            handleUploadStatus
        }
      );

    } else {
      console.warn(
        "No thumbnail selected — continuing without thumbnail."
      );
    }

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
    addVideoUploadInProgress =
      false;

    if (addVideoFile) {
      addVideoFile.disabled =
        false;
    }

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
