import { supabase } from "../supabaseClient.js";

import {
  formatBytes
} from "./utils.js";

import {
  calculateFileSha1,
  uploadFileToBackblaze
} from "./upload.js";

import {
  FaceDetector,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";


/* =================================================================================================================
   STATE
=================================================================================================================== */

let faceDetector = null;

let thumbnailCandidates = [];
let selectedThumbnailIndex = 0;
let selectedThumbnailBlob = null;

let currentThumbnailPreviewUrl = null;


/* =================================================================================================================
   DOM
=================================================================================================================== */

const addVideoThumbnailPreview =
  document.getElementById(
    "add-video-thumbnail-preview"
  );

const addVideoThumbnailStatus =
  document.getElementById(
    "add-video-thumbnail-status"
  );

const addVideoThumbnailActions =
  document.getElementById(
    "add-video-thumbnail-actions"
  );

const addVideoThumbnailPrev =
  document.getElementById(
    "add-video-thumbnail-prev"
  );

const addVideoThumbnailNext =
  document.getElementById(
    "add-video-thumbnail-next"
  );


/* =================================================================================================================
   FACE DETECTOR
=================================================================================================================== */

async function loadFaceDetector() {
  if (faceDetector) {
    return faceDetector;
  }

  if (addVideoThumbnailStatus) {
    addVideoThumbnailStatus.textContent =
      "Loading face detector…";
  }

  const vision =
    await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

  faceDetector =
    await FaceDetector.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
        },

        runningMode: "IMAGE",

        minDetectionConfidence: 0.55
      }
    );

  return faceDetector;
}


/* =================================================================================================================
   FRAME SEEKING
=================================================================================================================== */

function seekVideo(video, time) {
  return new Promise(
    (resolve, reject) => {

      const onSeeked = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();

        reject(
          new Error(
            "Could not seek video for thumbnail generation."
          )
        );
      };

      const cleanup = () => {
        video.removeEventListener(
          "seeked",
          onSeeked
        );

        video.removeEventListener(
          "error",
          onError
        );
      };

      video.addEventListener(
        "seeked",
        onSeeked,
        { once: true }
      );

      video.addEventListener(
        "error",
        onError,
        { once: true }
      );

      video.currentTime = time;
    }
  );
}


/* =================================================================================================================
   FRAME SCORING
=================================================================================================================== */

function scoreThumbnailFrame(
  detections,
  width,
  height
) {
  const frameArea =
    width * height;

  const usefulFaces =
    detections
      .map(
        detection =>
          detection.boundingBox
      )
      .filter(box => {
        if (!box) {
          return false;
        }

        const faceArea =
          box.width *
          box.height;

        const areaRatio =
          faceArea /
          frameArea;

        return areaRatio >= 0.025;
      });

  const faceCount =
    usefulFaces.length;

  if (!faceCount) {
    return {
      score: 0,
      faceCount: 0,
      combinedFaceRatio: 0
    };
  }

  let combinedFaceArea = 0;
  let centreBonus = 0;

  for (const box of usefulFaces) {
    combinedFaceArea +=
      box.width *
      box.height;

    const centreX =
      box.originX +
      box.width / 2;

    const centreY =
      box.originY +
      box.height / 2;

    const dx =
      Math.abs(
        centreX - width / 2
      ) /
      (width / 2);

    const dy =
      Math.abs(
        centreY - height / 2
      ) /
      (height / 2);

    const centrality =
      1 -
      Math.min(
        1,
        (dx + dy) / 2
      );

    centreBonus +=
      centrality * 10;
  }

  const combinedFaceRatio =
    combinedFaceArea /
    frameArea;

  let score = 0;

  if (faceCount >= 2) {
    score += 100;
  }

  if (faceCount > 2) {
    score +=
      (faceCount - 2) * 20;
  }

  score +=
    combinedFaceRatio * 180;

  score +=
    centreBonus;

  if (
    faceCount === 1 &&
    combinedFaceRatio >= 0.15
  ) {
    score += 40;
  }

  return {
    score,
    faceCount,
    combinedFaceRatio
  };
}


/* =================================================================================================================
   CANVAS → PNG
=================================================================================================================== */

function canvasToPngBlob(canvas) {
  return new Promise(
    (resolve, reject) => {

      canvas.toBlob(
        blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(
              new Error(
                "Could not create thumbnail image."
              )
            );
          }
        },

        "image/png"
      );
    }
  );
}


/* =================================================================================================================
   THUMBNAIL CANDIDATES
=================================================================================================================== */

export async function generateThumbnailCandidates(
  file
) {
  thumbnailCandidates = [];
  selectedThumbnailIndex = 0;
  selectedThumbnailBlob = null;

  if (addVideoThumbnailPreview) {
    addVideoThumbnailPreview.style.display =
      "none";
  }

  if (addVideoThumbnailActions) {
    addVideoThumbnailActions.style.display =
      "none";
  }

  if (addVideoThumbnailStatus) {
    addVideoThumbnailStatus.textContent =
      "Analysing video for faces…";
  }

  const detector =
    await loadFaceDetector();

  const objectUrl =
    URL.createObjectURL(file);

  const video =
    document.createElement("video");

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
      (resolve, reject) => {

        video.addEventListener(
          "loadedmetadata",
          resolve,
          { once: true }
        );

        video.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                "Could not read video metadata."
              )
            ),
          { once: true }
        );
      }
    );

    const duration =
      video.duration;

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        "Video duration is unavailable."
      );
    }

    const percentages = [
      0.05,
      0.10,
      0.15,
      0.20,
      0.25,
      0.30,
      0.35,
      0.40,
      0.50,
      0.60,
      0.70,
      0.80,
      0.85,
      0.90,
      0.95
    ];

    const canvas =
      document.createElement(
        "canvas"
      );

    const ctx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    const targetWidth =
      Math.min(
        video.videoWidth,
        960
      );

    const scale =
      targetWidth /
      video.videoWidth;

    canvas.width =
      targetWidth;

    canvas.height =
      Math.round(
        video.videoHeight *
        scale
      );

    for (
      let i = 0;
      i < percentages.length;
      i++
    ) {
      const time =
        Math.min(
          duration - 0.25,
          duration *
            percentages[i]
        );

      if (addVideoThumbnailStatus) {
        addVideoThumbnailStatus.textContent =
          `Checking thumbnail ${i + 1} of ${percentages.length}…`;
      }

      await seekVideo(
        video,
        time
      );

      ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const result =
        detector.detect(
          canvas
        );

      const detections =
        result?.detections || [];

      const scoring =
        scoreThumbnailFrame(
          detections,
          canvas.width,
          canvas.height
        );

      const blob =
        await canvasToPngBlob(
          canvas
        );

      thumbnailCandidates.push({
        time,
        blob,
        score:
          scoring.score,
        faceCount:
          scoring.faceCount,
        combinedFaceRatio:
          scoring.combinedFaceRatio
      });
    }

    thumbnailCandidates.sort(
      (a, b) =>
        b.score - a.score
    );

    showThumbnailCandidate(0);

  } finally {
    video.pause();
    video.removeAttribute(
      "src"
    );
    video.load();

    URL.revokeObjectURL(
      objectUrl
    );
  }
}


/* =================================================================================================================
   PREVIEW
=================================================================================================================== */

function showThumbnailCandidate(
  index
) {
  if (
    !thumbnailCandidates.length
  ) {
    return;
  }

  selectedThumbnailIndex =
    (
      index +
      thumbnailCandidates.length
    ) %
    thumbnailCandidates.length;

  const candidate =
    thumbnailCandidates[
      selectedThumbnailIndex
    ];

  selectedThumbnailBlob =
    candidate.blob;

  if (
    currentThumbnailPreviewUrl
  ) {
    URL.revokeObjectURL(
      currentThumbnailPreviewUrl
    );
  }

  currentThumbnailPreviewUrl =
    URL.createObjectURL(
      candidate.blob
    );

  if (addVideoThumbnailPreview) {
    addVideoThumbnailPreview.src =
      currentThumbnailPreviewUrl;

    addVideoThumbnailPreview.style.display =
      "block";
  }

  if (addVideoThumbnailActions) {
    addVideoThumbnailActions.style.display =
      "block";
  }

  const time =
    Math.round(
      candidate.time
    );

  if (!addVideoThumbnailStatus) {
    return;
  }

  if (
    candidate.faceCount >= 2
  ) {
    addVideoThumbnailStatus.textContent =
      `Suggested frame — ${candidate.faceCount} faces detected at ${time}s`;

  } else if (
    candidate.faceCount === 1
  ) {
    addVideoThumbnailStatus.textContent =
      `Alternative frame — 1 face detected at ${time}s`;

  } else {
    addVideoThumbnailStatus.textContent =
      `Fallback frame at ${time}s`;
  }
}


/* =================================================================================================================
   SELECTED THUMBNAIL
=================================================================================================================== */

export function getSelectedThumbnailBlob() {
  return selectedThumbnailBlob;
}


/* =================================================================================================================
   RESET
=================================================================================================================== */

export function resetThumbnailState() {
  thumbnailCandidates = [];
  selectedThumbnailIndex = 0;
  selectedThumbnailBlob = null;

  if (
    currentThumbnailPreviewUrl
  ) {
    URL.revokeObjectURL(
      currentThumbnailPreviewUrl
    );

    currentThumbnailPreviewUrl =
      null;
  }

  if (addVideoThumbnailPreview) {
    addVideoThumbnailPreview.removeAttribute(
      "src"
    );

    addVideoThumbnailPreview.style.display =
      "none";
  }

  if (addVideoThumbnailActions) {
    addVideoThumbnailActions.style.display =
      "none";
  }

  if (addVideoThumbnailStatus) {
    addVideoThumbnailStatus.textContent =
      "Select a video to generate suggestions.";
  }
}


/* =================================================================================================================
   THUMBNAIL UPLOAD
=================================================================================================================== */

export async function uploadThumbnailToBackblaze(
  uid,
  thumbnailBlob,
  {
    onStatus
  } = {}
) {
  if (!thumbnailBlob) {
    throw new Error(
      "No thumbnail has been selected."
    );
  }

  const filename =
    `images/${uid}.png`;

  onStatus?.(
    "Publishing thumbnail…"
  );

  console.log(
    "Preparing thumbnail upload:",
    filename,
    formatBytes(
      thumbnailBlob.size
    )
  );

  const sha1 =
    await calculateFileSha1(
      thumbnailBlob
    );

  const {
    data: uploadAuth,
    error: authError
  } =
    await supabase.functions.invoke(
      "zulu-upload-authorize",
      {
        body: {
          action: "normal"
        }
      }
    );

  if (authError) {
    console.error(
      "THUMBNAIL AUTH ERROR:",
      authError
    );

    throw authError;
  }

  if (
    !uploadAuth?.uploadUrl ||
    !uploadAuth?.authorizationToken
  ) {
    throw new Error(
      "Backblaze thumbnail upload authorization was incomplete."
    );
  }

  const result =
    await uploadFileToBackblaze({
      uploadUrl:
        uploadAuth.uploadUrl,

      authorizationToken:
        uploadAuth.authorizationToken,

      file:
        thumbnailBlob,

      filename,

      sha1
    });

  console.log(
    "THUMBNAIL PUBLISHED TO BACKBLAZE:",
    result
  );

  return result;
}


/* =================================================================================================================
   PREVIEW BUTTONS
=================================================================================================================== */

addVideoThumbnailPrev
  ?.addEventListener(
    "click",
    () => {
      showThumbnailCandidate(
        selectedThumbnailIndex - 1
      );
    }
  );

addVideoThumbnailNext
  ?.addEventListener(
    "click",
    () => {
      showThumbnailCandidate(
        selectedThumbnailIndex + 1
      );
    }
  );
