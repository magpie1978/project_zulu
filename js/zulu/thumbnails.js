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
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";


/* =====================================================================
   THUMBNAILS.JS
   =====================================================================

   PURPOSE
   -------

   This module manages thumbnail generation, selection and publishing
   for videos being added to the Zulu Videos catalogue.

   It has three main responsibilities:


   1. INTELLIGENT THUMBNAIL GENERATION

      The module samples frames from several points throughout the
      selected video.

      Each sampled frame is analysed using Google's MediaPipe face
      detector.

      Frames are scored according to:

          - number of useful faces detected;
          - combined size of those faces;
          - how centrally positioned the faces are;
          - whether a single face occupies a substantial part
            of the frame.

      Frames are then ranked from strongest to weakest candidate.


   2. FACE-AWARE 16:9 CROPPING

      Zulu video cards display thumbnails at 16:9.

      Landscape frames that already match the required composition can
      therefore be used naturally.

      Portrait / vertical frames are automatically cropped to 16:9.

      The crop position is selected using the detected faces.

      Crop selection prioritises:

          1. greatest number of faces retained;
          2. greatest visible face area;
          3. faces positioned nearest the centre of the crop.

      A face must have at least 70% of its area inside the crop to count
      as being retained.

      If no useful faces are available, the frame is centre-cropped.


   3. THUMBNAIL PREVIEW / SELECTION

      The highest-scoring frame is selected automatically.

      The user can then move backwards and forwards through all sampled
      candidates using the thumbnail navigation controls.

      The currently displayed candidate becomes the thumbnail that will
      eventually be uploaded.


   4. THUMBNAIL PUBLISHING

      After the video catalogue entry has been created, the selected
      thumbnail is uploaded to Backblaze B2 as:

          images/{uid}.png

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
===================================================================== */

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


/* =====================================================================
   02. MODULE STATE
===================================================================== */

let faceDetector = null;

let thumbnailCandidates = [];

let selectedThumbnailIndex = 0;

let selectedThumbnailBlob = null;

let currentThumbnailPreviewUrl = null;

let thumbnailDragActive = false;

let thumbnailDragPointerId = null;

let thumbnailDragStartY = 0;

let thumbnailDragStartCropY = 0;


/* =====================================================================
   03. THUMBNAIL NAVIGATION EVENTS
===================================================================== */

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


/* =====================================================================
   04. FACE-AWARE 16:9 CROPPING
===================================================================== */

const THUMBNAIL_ASPECT_RATIO =
  16 / 9;

const MIN_FACE_VISIBLE_RATIO =
  0.70;


/**
 * Returns useful MediaPipe face bounding boxes.
 *
 * Faces occupying less than 2.5% of the complete frame are ignored,
 * matching the existing thumbnail-scoring behaviour.
 */
function getUsefulFaceBoxes(
  detections,
  width,
  height
) {

  const frameArea =
    width *
    height;


  return (
    detections || []
  )
    .map(
      detection =>
        detection.boundingBox
    )
    .filter(
      box => {

        if (!box) {
          return false;
        }


        const faceArea =
          box.width *
          box.height;


        if (!faceArea) {
          return false;
        }


        return (
          faceArea /
          frameArea
        ) >= 0.025;
      }
    );
}


/**
 * Calculates the intersection between a face rectangle and a proposed
 * crop rectangle.
 */
function getRectangleIntersectionArea(
  a,
  b
) {

  const left =
    Math.max(
      a.x,
      b.x
    );

  const top =
    Math.max(
      a.y,
      b.y
    );

  const right =
    Math.min(
      a.x + a.width,
      b.x + b.width
    );

  const bottom =
    Math.min(
      a.y + a.height,
      b.y + b.height
    );


  const width =
    Math.max(
      0,
      right - left
    );

  const height =
    Math.max(
      0,
      bottom - top
    );


  return (
    width *
    height
  );
}


/**
 * Scores one proposed crop according to how successfully it retains
 * the detected faces.
 *
 * Priority:
 *
 *     retained face count
 *         ↓
 *     visible face area
 *         ↓
 *     central positioning
 */
function scoreCropPosition(
  crop,
  faceBoxes
) {

  let retainedFaceCount =
    0;

  let visibleFaceArea =
    0;

  let centreScore =
    0;


  const cropCentreX =
    crop.x +
    crop.width / 2;

  const cropCentreY =
    crop.y +
    crop.height / 2;


  for (
    const box of faceBoxes
  ) {

    const faceRect = {
      x:
        box.originX,

      y:
        box.originY,

      width:
        box.width,

      height:
        box.height
    };


    const faceArea =
      faceRect.width *
      faceRect.height;


    if (!faceArea) {
      continue;
    }


    const intersectionArea =
      getRectangleIntersectionArea(
        crop,
        faceRect
      );


    const visibleRatio =
      intersectionArea /
      faceArea;


    /*
     * A face only counts as retained when at least 70% remains visible.
     */
    if (
      visibleRatio <
      MIN_FACE_VISIBLE_RATIO
    ) {

      continue;
    }


    retainedFaceCount +=
      1;


    visibleFaceArea +=
      intersectionArea;


    const faceCentreX =
      faceRect.x +
      faceRect.width / 2;

    const faceCentreY =
      faceRect.y +
      faceRect.height / 2;


    const dx =
      Math.abs(
        faceCentreX -
        cropCentreX
      ) /
      (
        crop.width /
        2
      );


    const dy =
      Math.abs(
        faceCentreY -
        cropCentreY
      ) /
      (
        crop.height /
        2
      );


    const centrality =
      1 -
      Math.min(
        1,
        (
          dx +
          dy
        ) /
        2
      );


    centreScore +=
      centrality;
  }


  return {
    retainedFaceCount,
    visibleFaceArea,
    centreScore
  };
}


/**
 * Compares two crop scores.
 *
 * Returns true when candidateScore is preferable to bestScore.
 */
function cropScoreIsBetter(
  candidateScore,
  bestScore
) {

  if (!bestScore) {
    return true;
  }


  if (
    candidateScore.retainedFaceCount !==
    bestScore.retainedFaceCount
  ) {

    return (
      candidateScore.retainedFaceCount >
      bestScore.retainedFaceCount
    );
  }


  if (
    candidateScore.visibleFaceArea !==
    bestScore.visibleFaceArea
  ) {

    return (
      candidateScore.visibleFaceArea >
      bestScore.visibleFaceArea
    );
  }


  return (
    candidateScore.centreScore >
    bestScore.centreScore
  );
}


/**
 * Finds the best 16:9 crop rectangle for a frame.
 *
 * Portrait videos mainly require vertical movement of the crop.
 * Extremely wide frames may instead require horizontal movement.
 */
function findBestThumbnailCrop(
  frameWidth,
  frameHeight,
  detections
) {

  const frameAspect =
    frameWidth /
    frameHeight;


  let cropWidth;
  let cropHeight;


  /*
   * Frame is narrower/taller than 16:9.
   *
   * Keep the complete width and crop vertically.
   */
  if (
    frameAspect <
    THUMBNAIL_ASPECT_RATIO
  ) {

    cropWidth =
      frameWidth;

    cropHeight =
      frameWidth /
      THUMBNAIL_ASPECT_RATIO;

  } else {

    /*
     * Frame is wider than 16:9.
     *
     * Keep the complete height and crop horizontally.
     */
    cropHeight =
      frameHeight;

    cropWidth =
      frameHeight *
      THUMBNAIL_ASPECT_RATIO;
  }


  cropWidth =
    Math.min(
      frameWidth,
      cropWidth
    );

  cropHeight =
    Math.min(
      frameHeight,
      cropHeight
    );


  const maxX =
    Math.max(
      0,
      frameWidth -
      cropWidth
    );

  const maxY =
    Math.max(
      0,
      frameHeight -
      cropHeight
    );


  const usefulFaces =
    getUsefulFaceBoxes(
      detections,
      frameWidth,
      frameHeight
    );


  /*
   * With no useful faces, simply centre the crop.
   */
  if (
    !usefulFaces.length
  ) {

    return {
      x:
        maxX / 2,

      y:
        maxY / 2,

      width:
        cropWidth,

      height:
        cropHeight,

      retainedFaceCount:
        0
    };
  }


  /*
   * Build candidate crop positions.
   *
   * We test:
   *
   *   - the centred position;
   *   - positions centred around each detected face;
   *   - positions aligned with the top/bottom or left/right of faces;
   *   - a fine sweep through the movable crop range.
   */
  const positions =
    new Set();


  const movementIsVertical =
    maxY >
    0;


  const maximumMovement =
    movementIsVertical
      ? maxY
      : maxX;


  positions.add(
    maximumMovement /
    2
  );


  positions.add(
    0
  );


  positions.add(
    maximumMovement
  );


  for (
    const box of usefulFaces
  ) {

    if (
      movementIsVertical
    ) {

      const faceCentre =
        box.originY +
        box.height / 2;


      positions.add(
        faceCentre -
        cropHeight / 2
      );


      positions.add(
        box.originY
      );


      positions.add(
        box.originY +
        box.height -
        cropHeight
      );

    } else {

      const faceCentre =
        box.originX +
        box.width / 2;


      positions.add(
        faceCentre -
        cropWidth / 2
      );


      positions.add(
        box.originX
      );


      positions.add(
        box.originX +
        box.width -
        cropWidth
      );
    }
  }


  /*
   * Add a fine sweep across the complete available movement range.
   *
   * 100 intervals gives sufficiently accurate positioning without
   * making thumbnail generation expensive.
   */
  const SWEEP_STEPS =
    100;


  for (
    let i = 0;
    i <= SWEEP_STEPS;
    i++
  ) {

    positions.add(
      maximumMovement *
      (
        i /
        SWEEP_STEPS
      )
    );
  }


  let bestCrop =
    null;

  let bestScore =
    null;


  for (
    const rawPosition of positions
  ) {

    const position =
      Math.max(
        0,
        Math.min(
          maximumMovement,
          rawPosition
        )
      );


    const crop = {
      x:
        movementIsVertical
          ? 0
          : position,

      y:
        movementIsVertical
          ? position
          : 0,

      width:
        cropWidth,

      height:
        cropHeight
    };


    const score =
      scoreCropPosition(
        crop,
        usefulFaces
      );


    if (
      cropScoreIsBetter(
        score,
        bestScore
      )
    ) {

      bestCrop =
        crop;

      bestScore =
        score;
    }
  }


  return {
    ...bestCrop,

    retainedFaceCount:
      bestScore
        ?.retainedFaceCount ||
      0
  };
}


/**
 * Produces the final 16:9 thumbnail PNG from a complete sampled frame.
 */
async function createCroppedThumbnailBlob(
  sourceCanvas,
  detections
) {

  const crop =
    findBestThumbnailCrop(
      sourceCanvas.width,
      sourceCanvas.height,
      detections
    );


  /*
   * Store the maximum available crop movement.
   *
   * Portrait/tall images will have maxY > 0.
   */
  crop.maxX =
    Math.max(
      0,
      sourceCanvas.width -
      crop.width
    );


  crop.maxY =
    Math.max(
      0,
      sourceCanvas.height -
      crop.height
    );


  crop.movable =
    crop.maxY > 0;


  crop.direction =
    crop.maxY > 0
      ? "vertical"
      : crop.maxX > 0
        ? "horizontal"
        : null;


  crop.automaticX =
    crop.x;


  crop.automaticY =
    crop.y;


  /*
   * Keep a copy of the COMPLETE source frame.
   *
   * This is important because the user can subsequently drag the crop
   * vertically. We therefore need the image outside the original crop
   * area to remain available.
   */
  const storedSourceCanvas =
    document.createElement(
      "canvas"
    );


  storedSourceCanvas.width =
    sourceCanvas.width;


  storedSourceCanvas.height =
    sourceCanvas.height;


  const storedSourceContext =
    storedSourceCanvas.getContext(
      "2d"
    );


  if (!storedSourceContext) {

    throw new Error(
      "Could not store thumbnail source frame."
    );
  }


  storedSourceContext.drawImage(
    sourceCanvas,
    0,
    0
  );


  const blob =
    await renderThumbnailCrop(
      storedSourceCanvas,
      crop
    );


  return {
    blob,
    crop,
    sourceCanvas:
      storedSourceCanvas
  };
}


/**
 * Renders the supplied crop from a complete source frame.
 *
 * This is used both for:
 *
 *   - the initial automatic face-aware crop;
 *   - a manually repositioned crop after dragging.
 */
async function renderThumbnailCrop(
  sourceCanvas,
  crop
) {

  const outputWidth =
    960;


  const outputHeight =
    540;


  const outputCanvas =
    document.createElement(
      "canvas"
    );


  outputCanvas.width =
    outputWidth;


  outputCanvas.height =
    outputHeight;


  const outputContext =
    outputCanvas.getContext(
      "2d"
    );


  if (!outputContext) {

    throw new Error(
      "Could not create thumbnail crop canvas."
    );
  }


  outputContext.drawImage(
    sourceCanvas,

    crop.x,
    crop.y,
    crop.width,
    crop.height,

    0,
    0,
    outputCanvas.width,
    outputCanvas.height
  );


  return canvasToPngBlob(
    outputCanvas
  );
}


/* =====================================================================
   05. GENERATE THUMBNAIL CANDIDATES
===================================================================== */

/**
 * Generates and ranks thumbnail candidates from a local video file.
 */
export async function generateThumbnailCandidates(
  file
) {

  thumbnailCandidates = [];

  selectedThumbnailIndex = 0;

  selectedThumbnailBlob = null;


  if (
    addVideoThumbnailPreview
  ) {

    addVideoThumbnailPreview.style.display =
      "none";
  }


  if (
    addVideoThumbnailActions
  ) {

    addVideoThumbnailActions.style.display =
      "none";
  }


  if (
    addVideoThumbnailStatus
  ) {

    addVideoThumbnailStatus.textContent =
      "Analysing video for faces…";
  }


  const detector =
    await loadFaceDetector();


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
            once: true
          }
        );


        video.addEventListener(
          "error",
          () => {

            reject(
              new Error(
                "Could not read video metadata."
              )
            );
          },
          {
            once: true
          }
        );
      }
    );


    const duration =
      video.duration;


    if (
      !Number.isFinite(
        duration
      ) ||
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
          willReadFrequently:
            true
        }
      );


    if (!ctx) {

      throw new Error(
        "Could not create thumbnail canvas."
      );
    }


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


      if (
        addVideoThumbnailStatus
      ) {

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
        result?.detections ||
        [];


      /*
       * Score the COMPLETE frame first.
       *
       * This preserves the existing candidate-ranking behaviour.
       */
      const scoring =
        scoreThumbnailFrame(
          detections,
          canvas.width,
          canvas.height
        );


      /*
       * The actual PNG stored as the candidate is now a face-aware
       * 16:9 crop.
       */
const cropped =
  await createCroppedThumbnailBlob(
    canvas,
    detections
  );


thumbnailCandidates.push({
  time,

  blob:
    cropped.blob,

  sourceCanvas:
    cropped.sourceCanvas,

  score:
    scoring.score,

  faceCount:
    scoring.faceCount,

  combinedFaceRatio:
    scoring.combinedFaceRatio,

  crop:
    cropped.crop
});
    }


    thumbnailCandidates.sort(
      (
        a,
        b
      ) =>
        b.score -
        a.score
    );


    showThumbnailCandidate(
      0
    );

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


/* =====================================================================
   06. MEDIAPIPE FACE DETECTOR
===================================================================== */

async function loadFaceDetector() {

  if (
    faceDetector
  ) {

    return faceDetector;
  }


  if (
    addVideoThumbnailStatus
  ) {

    addVideoThumbnailStatus.textContent =
      "Loading face detector…";
  }


  const vision =
    await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );


  faceDetector =
    await FaceDetector.createFromOptions(
      vision,
      {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
        },

        runningMode:
          "IMAGE",

        minDetectionConfidence:
          0.55
      }
    );


  return faceDetector;
}


/* =====================================================================
   07. VIDEO FRAME SEEKING
===================================================================== */

function seekVideo(
  video,
  time
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const onSeeked =
        () => {

          cleanup();

          resolve();
        };


      const onError =
        () => {

          cleanup();


          reject(
            new Error(
              "Could not seek video for thumbnail generation."
            )
          );
        };


      const cleanup =
        () => {

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
        {
          once: true
        }
      );


      video.addEventListener(
        "error",
        onError,
        {
          once: true
        }
      );


      video.currentTime =
        time;
    }
  );
}


/* =====================================================================
   08. FRAME SCORING
===================================================================== */

function scoreThumbnailFrame(
  detections,
  width,
  height
) {

  const frameArea =
    width *
    height;


  const usefulFaces =
    detections
      .map(
        detection =>
          detection.boundingBox
      )
      .filter(
        box => {

          if (!box) {
            return false;
          }


          const faceArea =
            box.width *
            box.height;


          const areaRatio =
            faceArea /
            frameArea;


          return (
            areaRatio >=
            0.025
          );
        }
      );


  const faceCount =
    usefulFaces.length;


  if (!faceCount) {

    return {
      score: 0,
      faceCount: 0,
      combinedFaceRatio: 0
    };
  }


  let combinedFaceArea =
    0;

  let centreBonus =
    0;


  for (
    const box of usefulFaces
  ) {

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
        centreX -
        width / 2
      ) /
      (
        width /
        2
      );


    const dy =
      Math.abs(
        centreY -
        height / 2
      ) /
      (
        height /
        2
      );


    const centrality =
      1 -
      Math.min(
        1,
        (
          dx +
          dy
        ) /
        2
      );


    centreBonus +=
      centrality *
      10;
  }


  const combinedFaceRatio =
    combinedFaceArea /
    frameArea;


  let score =
    0;


  if (
    faceCount >= 2
  ) {

    score +=
      100;
  }


  if (
    faceCount > 2
  ) {

    score +=
      (
        faceCount -
        2
      ) *
      20;
  }


  score +=
    combinedFaceRatio *
    180;


  score +=
    centreBonus;


  if (
    faceCount === 1 &&
    combinedFaceRatio >=
    0.15
  ) {

    score +=
      40;
  }


  return {
    score,
    faceCount,
    combinedFaceRatio
  };
}


/* =====================================================================
   09. CANVAS → PNG
===================================================================== */

function canvasToPngBlob(
  canvas
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      canvas.toBlob(
        blob => {

          if (
            blob
          ) {

            resolve(
              blob
            );

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
/* =====================================================================
   10. REMOTE VIDEO THUMBNAIL GENERATION
   =====================================================================

   Used by the Admin Library Health repair workflow.

   Unlike generateThumbnailCandidates(), this function does NOT require
   a local File object.

   Instead it receives an authenticated/signed media URL for an MP4
   already stored in Backblaze.

   The browser's <video> element seeks directly into the remote MP4.
   Because the media endpoint supports Range requests, the browser does
   not need to download the complete video before thumbnail generation.

   The same face detector, scoring system and selected-thumbnail state
   used by Add Video are reused here.

   IMPORTANT:

   The final candidate PNG is passed through the same face-aware 16:9
   cropping system as normal Add Video ingestion.

===================================================================== */

export async function generateThumbnailCandidatesFromUrl(
  videoUrl,
  {
    onStatus
  } = {}
) {

  if (
    !videoUrl
  ) {

    throw new Error(
      "No video URL was supplied for thumbnail repair."
    );
  }


  thumbnailCandidates = [];

  selectedThumbnailIndex = 0;

  selectedThumbnailBlob = null;


  onStatus?.(
    "Loading face detector…"
  );


  const detector =
    await loadFaceDetector();


  const video =
    document.createElement(
      "video"
    );


  /*
   * The Admin page and media hostname are different origins.
   *
   * crossOrigin must be set BEFORE src. This allows the decoded video
   * frame to be drawn to canvas without tainting it, provided the media
   * response includes the appropriate CORS header.
   */
  video.crossOrigin =
    "anonymous";


  video.preload =
    "metadata";


  video.muted =
    true;


  video.playsInline =
    true;


  /*
   * Setting src only after all video properties have been configured is
   * deliberate.
   */
  video.src =
    videoUrl;


  try {

    onStatus?.(
      "Reading video metadata…"
    );


    await new Promise(
      (
        resolve,
        reject
      ) => {

        /*
         * Some large/older MP4 files can take considerably longer than
         * 30 seconds before the browser has fetched enough of the file to
         * expose its metadata.
         *
         * Give remote repair jobs up to 90 seconds.
         */
        const METADATA_TIMEOUT_MS =
          90000;


        let settled =
          false;


        const cleanup =
          () => {

            window.clearTimeout(
              timeout
            );


            video.removeEventListener(
              "loadedmetadata",
              onLoaded
            );


            video.removeEventListener(
              "durationchange",
              onDurationChange
            );


            video.removeEventListener(
              "error",
              onError
            );
          };


        const finish =
          () => {

            if (
              settled
            ) {

              return;
            }


            settled =
              true;


            cleanup();


            resolve();
          };


        const fail =
          error => {

            if (
              settled
            ) {

              return;
            }


            settled =
              true;


            cleanup();


            reject(
              error
            );
          };


        const metadataIsUsable =
          () => {

            return (
              video.readyState >=
                HTMLMediaElement.HAVE_METADATA &&
              Number.isFinite(
                video.duration
              ) &&
              video.duration >
                0
            );
          };


        const onLoaded =
          () => {

            /*
             * loadedmetadata normally gives us everything required.
             * Check the duration as well before continuing.
             */
            if (
              metadataIsUsable()
            ) {

              finish();
            }
          };


        const onDurationChange =
          () => {

            /*
             * Some MP4s expose the duration slightly after loadedmetadata.
             * durationchange therefore gives those files another route to
             * completing metadata initialisation.
             */
            if (
              metadataIsUsable()
            ) {

              finish();
            }
          };


        const onError =
          () => {

            const mediaError =
              video.error;


            const errorCode =
              mediaError?.code ??
              "unknown";


            const errorMessage =
              mediaError?.message ??
              "No browser media error was supplied.";


            fail(
              new Error(
                `Could not read the remote video for thumbnail repair. ` +
                `Media error ${errorCode}: ${errorMessage}`
              )
            );
          };


        const timeout =
          window.setTimeout(
            () => {

              /*
               * Check one final time before failing. It is possible for
               * metadata to have become available immediately around the
               * timeout boundary without our event handler having completed.
               */
              if (
                metadataIsUsable()
              ) {

                finish();

                return;
              }


              fail(
                new Error(
                  `Timed out after ${
                    METADATA_TIMEOUT_MS /
                    1000
                  } seconds while loading video metadata. ` +
                  `readyState=${video.readyState}, ` +
                  `networkState=${video.networkState}, ` +
                  `duration=${video.duration}.`
                )
              );
            },

            METADATA_TIMEOUT_MS
          );


        video.addEventListener(
          "loadedmetadata",
          onLoaded
        );


        video.addEventListener(
          "durationchange",
          onDurationChange
        );


        video.addEventListener(
          "error",
          onError
        );


        /*
         * The video may already have usable metadata by the time this
         * Promise is established.
         */
        if (
          metadataIsUsable()
        ) {

          finish();

          return;
        }


        /*
         * Explicitly begin loading the signed remote MP4.
         */
        video.load();
      }
    );


    const duration =
      video.duration;


    if (
      !Number.isFinite(
        duration
      ) ||
      duration <= 0
    ) {

      throw new Error(
        "Video duration is unavailable."
      );
    }


    /*
     * Use the same sampling positions as normal Add Video ingestion so
     * repaired thumbnails are generated using exactly the same strategy.
     */
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
          willReadFrequently:
            true
        }
      );


    if (
      !ctx
    ) {

      throw new Error(
        "Could not create thumbnail canvas."
      );
    }


    const targetWidth =
      Math.min(
        video.videoWidth,
        960
      );


    if (
      !targetWidth ||
      !video.videoHeight
    ) {

      throw new Error(
        "Video dimensions are unavailable."
      );
    }


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


    /*
     * Inspect fifteen points throughout the existing MP4.
     *
     * Range-capable playback means each seek should retrieve only the
     * portions of the MP4 required by the browser.
     */
    for (
      let i = 0;
      i < percentages.length;
      i++
    ) {

      const time =
        Math.max(
          0,
          Math.min(
            duration - 0.25,

            duration *
            percentages[i]
          )
        );


      onStatus?.(
        `Checking frame ${i + 1} of ${percentages.length}…`
      );


      await seekVideo(
        video,
        time
      );


      /*
       * Draw the COMPLETE source frame first.
       *
       * Face detection is deliberately performed before cropping so that
       * MediaPipe can see every face in the portrait frame.
       */
      ctx.drawImage(
        video,

        0,
        0,

        canvas.width,
        canvas.height
      );


      /*
       * If the media response does not permit cross-origin canvas use,
       * accessing the canvas here will throw a SecurityError.
       *
       * That error is intentionally allowed to propagate to Admin so the
       * repair cannot accidentally upload an invalid image.
       */
      const result =
        detector.detect(
          canvas
        );


      const detections =
        result?.detections ||
        [];


      /*
       * Score the complete frame using the original Zulu scoring system.
       */
      const scoring =
        scoreThumbnailFrame(
          detections,

          canvas.width,
          canvas.height
        );


      /*
       * NEW:
       *
       * Convert the complete sampled frame into a face-aware 16:9 card
       * thumbnail.
       *
       * For portrait video this chooses the vertical slice containing the
       * greatest number of detected faces.
       *
       * Where several positions contain the same number of faces, visible
       * face area and central positioning decide the winner.
       */
      const cropped =
        await createCroppedThumbnailBlob(
          canvas,
          detections
        );


      const blob =
        cropped.blob;


thumbnailCandidates.push({
  time,

  blob,

  sourceCanvas:
    cropped.sourceCanvas,

  score:
    scoring.score,

  faceCount:
    scoring.faceCount,

  combinedFaceRatio:
    scoring.combinedFaceRatio,

  crop:
    cropped.crop
});
    }


    if (
      !thumbnailCandidates.length
    ) {

      throw new Error(
        "No thumbnail candidates could be generated."
      );
    }


    /*
     * Candidate ranking remains exactly as before.
     *
     * The frame with the strongest face score becomes candidate 0.
     */
    thumbnailCandidates.sort(
      (
        a,
        b
      ) =>
        b.score -
        a.score
    );


    /*
     * This sets selectedThumbnailBlob to the highest-scoring candidate,
     * exactly as the normal Add Video workflow does.
     */
    showThumbnailCandidate(
      0
    );


    const selected =
      thumbnailCandidates[0];


    onStatus?.(
      selected.faceCount >= 2

        ? `Best frame found — ${selected.faceCount} faces detected.`

        : selected.faceCount === 1

          ? "Best frame found — 1 face detected."

          : "Best available frame found."
    );


    return {
      count:
        thumbnailCandidates.length,

      selectedTime:
        selected.time,

      faceCount:
        selected.faceCount,

      score:
        selected.score
    };


  } finally {

    video.pause();


    video.removeAttribute(
      "src"
    );


    video.load();
  }
}

/* =====================================================================
   MANUAL PORTRAIT CROP POSITIONING
===================================================================== */

function getCurrentThumbnailCandidate() {

  if (
    !thumbnailCandidates.length
  ) {

    return null;
  }


  return thumbnailCandidates[
    selectedThumbnailIndex
  ];
}


/**
 * Replaces the preview URL after a candidate has been re-rendered.
 */
function refreshThumbnailPreview(
  candidate
) {

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


  if (
    addVideoThumbnailPreview
  ) {

    addVideoThumbnailPreview.src =
      currentThumbnailPreviewUrl;
  }
}


/**
 * Produces a temporary preview during dragging.
 *
 * This redraws from the complete stored source frame, so the user can
 * actually see the portrait image moving behind the 16:9 crop window.
 */
function renderThumbnailDragPreview(
  candidate
) {

  if (
    !candidate?.sourceCanvas ||
    !candidate?.crop ||
    !addVideoThumbnailPreview
  ) {

    return;
  }


  const previewCanvas =
    document.createElement(
      "canvas"
    );


  previewCanvas.width =
    640;


  previewCanvas.height =
    360;


  const ctx =
    previewCanvas.getContext(
      "2d"
    );


  if (!ctx) {

    return;
  }


  ctx.drawImage(
    candidate.sourceCanvas,

    candidate.crop.x,
    candidate.crop.y,
    candidate.crop.width,
    candidate.crop.height,

    0,
    0,
    previewCanvas.width,
    previewCanvas.height
  );


  /*
   * toDataURL is appropriate here because this is only a small temporary
   * 640 × 360 preview. The final PNG still uses canvasToPngBlob().
   */
  addVideoThumbnailPreview.src =
    previewCanvas.toDataURL(
      "image/jpeg",
      0.85
    );
}


/**
 * Starts dragging a portrait thumbnail.
 */
function startThumbnailDrag(
  event
) {

  const candidate =
    getCurrentThumbnailCandidate();


  if (
    !candidate?.sourceCanvas ||
    !candidate?.crop?.movable ||
    candidate.crop.direction !==
      "vertical"
  ) {

    return;
  }


  event.preventDefault();


  thumbnailDragActive =
    true;


  thumbnailDragPointerId =
    event.pointerId;


  thumbnailDragStartY =
    event.clientY;


  thumbnailDragStartCropY =
    candidate.crop.y;


  addVideoThumbnailPreview
    ?.setPointerCapture(
      event.pointerId
    );


  addVideoThumbnailPreview
    ?.classList
    .add(
      "is-dragging"
    );


  if (
    addVideoThumbnailStatus
  ) {

    addVideoThumbnailStatus.textContent =
      "Drag up or down to reposition the crop";
  }
}


/**
 * Moves the crop while the pointer is being dragged.
 */
function moveThumbnailDrag(
  event
) {

  if (
    !thumbnailDragActive ||
    event.pointerId !==
      thumbnailDragPointerId
  ) {

    return;
  }


  const candidate =
    getCurrentThumbnailCandidate();


  if (
    !candidate?.sourceCanvas ||
    !candidate?.crop
  ) {

    return;
  }


  event.preventDefault();


  const previewRect =
    addVideoThumbnailPreview
      ?.getBoundingClientRect();


  if (
    !previewRect?.height
  ) {

    return;
  }


  const pointerDelta =
    event.clientY -
    thumbnailDragStartY;


  /*
   * Convert movement in browser pixels into movement within the complete
   * source frame.
   *
   * The crop itself is what moves through the portrait source.
   */
  const sourcePixelsPerPreviewPixel =
    candidate.crop.height /
    previewRect.height;


  const cropDelta =
    pointerDelta *
    sourcePixelsPerPreviewPixel;


  /*
   * Natural "drag the picture" behaviour:
   *
   * drag picture DOWN
   *      -> crop moves UP through source
   *
   * drag picture UP
   *      -> crop moves DOWN through source
   */
  candidate.crop.y =
    Math.max(
      0,
      Math.min(
        candidate.crop.maxY,

        thumbnailDragStartCropY -
        cropDelta
      )
    );


  renderThumbnailDragPreview(
    candidate
  );


  if (
    addVideoThumbnailStatus
  ) {

    const percentage =
      candidate.crop.maxY
        ? Math.round(
            (
              candidate.crop.y /
              candidate.crop.maxY
            ) *
            100
          )
        : 50;


    addVideoThumbnailStatus.textContent =
      `Manual crop position: ${percentage}%`;
  }
}


/**
 * Finishes a manual crop movement and regenerates the actual PNG that
 * will be uploaded.
 */
async function finishThumbnailDrag(
  event
) {

  if (
    !thumbnailDragActive ||
    event.pointerId !==
      thumbnailDragPointerId
  ) {

    return;
  }


  thumbnailDragActive =
    false;


  const candidate =
    getCurrentThumbnailCandidate();


  try {

    addVideoThumbnailPreview
      ?.releasePointerCapture(
        event.pointerId
      );

  } catch {

    /*
     * Pointer capture may already have been released.
     */
  }


  thumbnailDragPointerId =
    null;


  addVideoThumbnailPreview
    ?.classList
    .remove(
      "is-dragging"
    );


  if (
    !candidate?.sourceCanvas ||
    !candidate?.crop
  ) {

    return;
  }


  if (
    addVideoThumbnailStatus
  ) {

    addVideoThumbnailStatus.textContent =
      "Saving manual crop…";
  }


  try {

    /*
     * Generate the actual 960 × 540 PNG from the manually selected
     * position.
     */
    candidate.blob =
      await renderThumbnailCrop(
        candidate.sourceCanvas,
        candidate.crop
      );


    /*
     * Because this candidate is currently selected, this newly rendered
     * Blob is now the thumbnail that will be uploaded.
     */
    selectedThumbnailBlob =
      candidate.blob;


    refreshThumbnailPreview(
      candidate
    );


    const time =
      Math.round(
        candidate.time
      );


    if (
      addVideoThumbnailStatus
    ) {

      addVideoThumbnailStatus.textContent =
        `Manual crop selected — frame at ${time}s`;
    }

  } catch (error) {

    console.error(
      "Could not save manual thumbnail crop:",
      error
    );


    /*
     * Restore the candidate's existing preview if regeneration fails.
     */
    refreshThumbnailPreview(
      candidate
    );


    if (
      addVideoThumbnailStatus
    ) {

      addVideoThumbnailStatus.textContent =
        "Could not save manual crop.";
    }
  }
}


/* ---------------------------------------------------------------------
   POINTER EVENTS
--------------------------------------------------------------------- */

addVideoThumbnailPreview
  ?.addEventListener(
    "pointerdown",
    startThumbnailDrag
  );


addVideoThumbnailPreview
  ?.addEventListener(
    "pointermove",
    moveThumbnailDrag
  );


addVideoThumbnailPreview
  ?.addEventListener(
    "pointerup",
    finishThumbnailDrag
  );


addVideoThumbnailPreview
  ?.addEventListener(
    "pointercancel",
    finishThumbnailDrag
  );


/* =====================================================================
   11. THUMBNAIL PREVIEW / SELECTION
===================================================================== */

/**
 * Displays one generated thumbnail candidate.
 *
 * Index wrapping is automatic:
 *
 *     -1
 *         becomes the final candidate.
 *
 *     candidateCount
 *         becomes candidate 0.
 *
 * The displayed candidate's Blob becomes selectedThumbnailBlob, meaning
 * it will be returned by getSelectedThumbnailBlob() for upload.
 *
 * The previous preview object URL is revoked before creating the new one.
 *
 * @param {number} index
 */
function showThumbnailCandidate(
  index
) {

  if (
    !thumbnailCandidates.length
  ) {

    return;
  }


  /* -----------------------------------------------------------------
     NORMALISE / WRAP INDEX
  ----------------------------------------------------------------- */

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

/*
 * Manual repositioning is available only when this candidate has a
 * vertically movable crop.
 */
if (
  addVideoThumbnailPreview
) {

  if (
    candidate.sourceCanvas &&
    candidate.crop?.movable &&
    candidate.crop.direction ===
      "vertical"
  ) {

    addVideoThumbnailPreview
      .classList
      .add(
        "is-croppable"
      );

  } else {

    addVideoThumbnailPreview
      .classList
      .remove(
        "is-croppable",
        "is-dragging"
      );
  }
}
  
  /*
   * The displayed candidate is also the selected candidate.
   */
  selectedThumbnailBlob =
    candidate.blob;


  /* -----------------------------------------------------------------
     RELEASE PREVIOUS PREVIEW URL
  ----------------------------------------------------------------- */

  if (
    currentThumbnailPreviewUrl
  ) {

    URL.revokeObjectURL(
      currentThumbnailPreviewUrl
    );
  }


  /* -----------------------------------------------------------------
     CREATE NEW PREVIEW URL
  ----------------------------------------------------------------- */

  currentThumbnailPreviewUrl =
    URL.createObjectURL(
      candidate.blob
    );


  if (
    addVideoThumbnailPreview
  ) {

    addVideoThumbnailPreview.src =
      currentThumbnailPreviewUrl;


    addVideoThumbnailPreview.style.display =
      "block";
  }


  if (
    addVideoThumbnailActions
  ) {

    addVideoThumbnailActions.style.display =
      "block";
  }


  /* -----------------------------------------------------------------
     DESCRIBE SELECTED FRAME
  ----------------------------------------------------------------- */

  const time =
    Math.round(
      candidate.time
    );


  if (
    !addVideoThumbnailStatus
  ) {

    return;
  }


  /*
   * The status message indicates why the frame ranked as it did.
   *
   * If this candidate required a meaningful crop, mention how many faces
   * survived the final 16:9 crop.
   */
  const retainedFaceCount =
    candidate.crop
      ?.retainedFaceCount;


  if (
    candidate.faceCount >= 2
  ) {

    if (
      Number.isFinite(
        retainedFaceCount
      ) &&
      retainedFaceCount <
        candidate.faceCount
    ) {

      addVideoThumbnailStatus.textContent =
        `Suggested frame — ${candidate.faceCount} faces detected, ` +
        `${retainedFaceCount} inside crop at ${time}s`;

    } else {

      addVideoThumbnailStatus.textContent =
        `Suggested frame — ${candidate.faceCount} faces detected at ${time}s`;
    }

  } else if (
    candidate.faceCount === 1
  ) {

    addVideoThumbnailStatus.textContent =
      `Alternative frame — 1 face detected at ${time}s`;

  } else {

    addVideoThumbnailStatus.textContent =
      `Fallback frame at ${time}s`;
  }


  /*
   * Tell the user when this thumbnail can be manually repositioned.
   */
  if (
    candidate.crop?.movable &&
    candidate.crop.direction ===
      "vertical"
  ) {

    addVideoThumbnailStatus.textContent +=
      " — drag image up/down to reposition";
  }
}

/* =====================================================================
   12. GET SELECTED THUMBNAIL
===================================================================== */

/**
 * Returns the PNG Blob belonging to the currently displayed thumbnail.
 *
 * add-video.js calls this after the video catalogue entry has been
 * created.
 *
 * Because portrait frames are cropped before they are stored as
 * candidates, this Blob is already the final 16:9 thumbnail.
 *
 * @returns {Blob|null}
 */
export function getSelectedThumbnailBlob() {

  return selectedThumbnailBlob;
}


/* =====================================================================
   13. ADMIN THUMBNAIL CANDIDATE API
===================================================================== */

/**
 * Returns information about the thumbnail candidate currently selected.
 *
 * The Blob itself remains available through getSelectedThumbnailBlob().
 */
/**
 * Admin Review crop API. Uses the same stored source frame and PNG
 * renderer as Add Video, without coupling Admin to Add Video's DOM.
 */
export function getSelectedThumbnailCropInfo() {
  const candidate = thumbnailCandidates[selectedThumbnailIndex];
  if (!candidate?.sourceCanvas || candidate.crop?.direction !== "vertical" || !candidate.crop?.maxY) return null;
  return { y: candidate.crop.y, maxY: candidate.crop.maxY, cropHeight: candidate.crop.height };
}

export function previewSelectedThumbnailCrop(y) {
  const candidate = thumbnailCandidates[selectedThumbnailIndex];
  if (!candidate?.sourceCanvas || candidate.crop?.direction !== "vertical") return null;
  candidate.crop.y = Math.max(0, Math.min(candidate.crop.maxY, y));
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(candidate.sourceCanvas, candidate.crop.x, candidate.crop.y,
    candidate.crop.width, candidate.crop.height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export async function commitSelectedThumbnailCrop() {
  const candidate = thumbnailCandidates[selectedThumbnailIndex];
  if (!candidate?.sourceCanvas || candidate.crop?.direction !== "vertical") return null;
  const blob = await renderThumbnailCrop(candidate.sourceCanvas, candidate.crop);
  candidate.blob = blob;
  selectedThumbnailBlob = blob;
  return blob;
}

export function getSelectedThumbnailCandidate() {

  if (
    !thumbnailCandidates.length
  ) {

    return null;
  }


  const candidate =
    thumbnailCandidates[
      selectedThumbnailIndex
    ];


  return {
    index:
      selectedThumbnailIndex,

    number:
      selectedThumbnailIndex + 1,

    count:
      thumbnailCandidates.length,

    time:
      candidate.time,

    score:
      candidate.score,

    faceCount:
      candidate.faceCount,

    combinedFaceRatio:
      candidate.combinedFaceRatio,

    crop:
      candidate.crop,

    blob:
      candidate.blob
  };
}


/**
 * Selects a particular generated candidate.
 *
 * This reuses the same selection mechanism used by Add Video, so
 * selectedThumbnailBlob always stays in sync.
 */
export function selectThumbnailCandidate(
  index
) {

  showThumbnailCandidate(
    index
  );


  return getSelectedThumbnailCandidate();
}


/**
 * Selects the previous generated candidate.
 */
export function selectPreviousThumbnailCandidate() {

  return selectThumbnailCandidate(
    selectedThumbnailIndex - 1
  );
}


/**
 * Selects the next generated candidate.
 */
export function selectNextThumbnailCandidate() {

  return selectThumbnailCandidate(
    selectedThumbnailIndex + 1
  );
}


/* =====================================================================
   14. RESET THUMBNAIL STATE
===================================================================== */

/**
 * Completely resets thumbnail generation and preview state.
 *
 * Called when the Add Video form is reset.
 *
 * This:
 *
 *   - removes all generated candidates;
 *   - returns the selected index to zero;
 *   - clears the selected Blob;
 *   - revokes the active preview object URL;
 *   - removes the preview image source;
 *   - hides thumbnail navigation controls;
 *   - restores the initial status message.
 *
 * The MediaPipe faceDetector is deliberately NOT reset because the
 * loaded model can be reused for the next video.
 */
export function resetThumbnailState() {

  thumbnailCandidates = [];

  selectedThumbnailIndex = 0;

  selectedThumbnailBlob = null;

  thumbnailDragActive =
  false;

thumbnailDragPointerId =
  null;

thumbnailDragStartY =
  0;

thumbnailDragStartCropY =
  0;


  /* -----------------------------------------------------------------
     RELEASE PREVIEW OBJECT URL
  ----------------------------------------------------------------- */

  if (
    currentThumbnailPreviewUrl
  ) {

    URL.revokeObjectURL(
      currentThumbnailPreviewUrl
    );


    currentThumbnailPreviewUrl =
      null;
  }


  /* -----------------------------------------------------------------
     RESET PREVIEW
  ----------------------------------------------------------------- */

  if (
    addVideoThumbnailPreview
  ) {

    addVideoThumbnailPreview
  .classList
  .remove(
    "is-croppable",
    "is-dragging"
  );

    addVideoThumbnailPreview.removeAttribute(
      "src"
    );


    addVideoThumbnailPreview.style.display =
      "none";
  }


  /* -----------------------------------------------------------------
     HIDE NAVIGATION
  ----------------------------------------------------------------- */

  if (
    addVideoThumbnailActions
  ) {

    addVideoThumbnailActions.style.display =
      "none";
  }


  /* -----------------------------------------------------------------
     RESET STATUS
  ----------------------------------------------------------------- */

  if (
    addVideoThumbnailStatus
  ) {

    addVideoThumbnailStatus.textContent =
      "Select a video to generate suggestions.";
  }
}


/* =====================================================================
   15. THUMBNAIL UPLOAD
   =====================================================================

   Thumbnail files are uploaded separately from the MP4.

   The video UID determines the thumbnail filename:

       UID 1525
          ↓
       images/1525.png

   Workflow:

       Validate thumbnail
           ↓
       Build filename
           ↓
       Calculate SHA-1
           ↓
       Request Backblaze upload authorisation
           ↓
       Upload PNG
           ↓
       Return Backblaze result

===================================================================== */

/**
 * Publishes the selected thumbnail to Backblaze B2.
 *
 * The thumbnail is uploaded using the normal Backblaze upload path,
 * because generated PNG thumbnails are small and do not require the
 * multipart upload system used for large MP4 files.
 *
 * @param {*} uid
 *        UID of the newly created video catalogue record.
 *
 * @param {Blob} thumbnailBlob
 *        PNG thumbnail selected by the user.
 *
 * @param {Object} options
 *
 * @param {Function} [options.onStatus]
 *        Optional callback used by add-video.js to display upload
 *        progress/status messages.
 *
 * @returns {Promise<Object>}
 *        Result returned by uploadFileToBackblaze().
 */
export async function uploadThumbnailToBackblaze(
  uid,
  thumbnailBlob,
  {
    onStatus
  } = {}
) {

  /* -----------------------------------------------------------------
     VALIDATE THUMBNAIL
  ----------------------------------------------------------------- */

  if (
    !thumbnailBlob
  ) {

    throw new Error(
      "No thumbnail has been selected."
    );
  }


  /* -----------------------------------------------------------------
     BUILD BACKBLAZE FILENAME
  ----------------------------------------------------------------- */

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


  /* -----------------------------------------------------------------
     CALCULATE SHA-1
  -----------------------------------------------------------------

     Normal Backblaze uploads require the SHA-1 checksum of the file.
  ----------------------------------------------------------------- */

  const sha1 =
    await calculateFileSha1(
      thumbnailBlob
    );


  /* -----------------------------------------------------------------
     REQUEST BACKBLAZE UPLOAD AUTHORISATION
  -----------------------------------------------------------------

     The browser does not hold the permanent Backblaze credentials.

     Instead, zulu-upload-authorize supplies a temporary upload URL and
     authorisation token.
  ----------------------------------------------------------------- */

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

    console.error(
      "THUMBNAIL AUTH ERROR:",
      authError
    );


    throw authError;
  }


  /*
   * Validate that the Edge Function returned everything required by
   * uploadFileToBackblaze().
   */
  if (
    !uploadAuth?.uploadUrl ||
    !uploadAuth?.authorizationToken
  ) {

    throw new Error(
      "Backblaze thumbnail upload authorization was incomplete."
    );
  }


  /* -----------------------------------------------------------------
     UPLOAD PNG
  ----------------------------------------------------------------- */

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
