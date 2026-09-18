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

      The frames are then ranked from strongest to weakest candidate.


   2. THUMBNAIL PREVIEW / SELECTION

      The highest-scoring frame is selected automatically.

      The user can then move backwards and forwards through all sampled
      candidates using the thumbnail navigation controls.

      The currently displayed candidate becomes the thumbnail that will
      eventually be uploaded.


   3. THUMBNAIL PUBLISHING

      After the video catalogue entry has been created, the selected
      thumbnail is uploaded to Backblaze B2 as:

          images/{uid}.png

      For example:

          images/1525.png


   RELATED MODULES
   ---------------

   add-video.js

       Calls:

           generateThumbnailCandidates(file)

       while analysing a newly selected MP4.

       Later calls:

           getSelectedThumbnailBlob()

       and:

           uploadThumbnailToBackblaze(uid, blob)

       after the video itself has been uploaded and its catalogue UID
       has been created.


   upload.js

       Provides:

           calculateFileSha1()
           uploadFileToBackblaze()


   utils.js

       Provides:

           formatBytes()


   EXTERNAL DEPENDENCY
   -------------------

   MediaPipe Tasks Vision is used for browser-side face detection.

   The BlazeFace short-range model is loaded lazily the first time
   thumbnail generation is requested.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
   =====================================================================

   Cache the thumbnail controls belonging to the Add Video interface.
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
   =====================================================================

   faceDetector
       Cached MediaPipe FaceDetector instance.

       The model is relatively expensive to initialise, so it is loaded
       once and reused for subsequent videos.


   thumbnailCandidates
       Array containing every sampled video frame.

       Each candidate has the structure:

           {
             time,
             blob,
             score,
             faceCount,
             combinedFaceRatio
           }


   selectedThumbnailIndex
       Array index of the candidate currently displayed in the preview.


   selectedThumbnailBlob
       PNG Blob belonging to the currently selected candidate.

       add-video.js retrieves this when the thumbnail is ready to be
       uploaded.


   currentThumbnailPreviewUrl
       Temporary browser object URL used to display the currently
       selected PNG Blob.

       The previous object URL is revoked whenever the preview changes
       to avoid accumulating unused browser memory.
===================================================================== */

let faceDetector = null;

let thumbnailCandidates = [];

let selectedThumbnailIndex = 0;

let selectedThumbnailBlob = null;

let currentThumbnailPreviewUrl = null;


/* =====================================================================
   03. THUMBNAIL NAVIGATION EVENTS
   =====================================================================

   These buttons cycle through the generated candidates.

   showThumbnailCandidate() wraps the supplied index automatically, so:

       Previous from candidate 0
           → displays the final candidate.

       Next from the final candidate
           → returns to candidate 0.
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
   04. GENERATE THUMBNAIL CANDIDATES
   =====================================================================

   This is the main public thumbnail-analysis function.

   Workflow:

       Reset previous candidates
             ↓
       Load MediaPipe face detector
             ↓
       Create temporary local video
             ↓
       Read video metadata
             ↓
       Create thumbnail canvas
             ↓
       Seek to predefined points throughout video
             ↓
       Draw each frame to canvas
             ↓
       Detect faces
             ↓
       Score frame
             ↓
       Convert frame to PNG
             ↓
       Store candidate
             ↓
       Rank candidates by score
             ↓
       Display best candidate
===================================================================== */

/**
 * Generates and ranks thumbnail candidates from a local video file.
 *
 * Fifteen frames are sampled at predefined percentages throughout the
 * video:
 *
 *      5%, 10%, 15%, 20%, 25%, 30%, 35%, 40%,
 *      50%, 60%, 70%, 80%, 85%, 90%, 95%
 *
 * Each frame is:
 *
 *   1. drawn onto a canvas;
 *   2. analysed by MediaPipe for faces;
 *   3. scored according to face composition;
 *   4. converted into a PNG Blob;
 *   5. stored as a thumbnail candidate.
 *
 * Candidates are sorted by score descending, meaning candidate 0 is
 * the automatically preferred thumbnail.
 *
 * The temporary video object URL is always released in the finally
 * block.
 *
 * @param {File} file
 *        Local MP4 selected in the Add Video interface.
 */
export async function generateThumbnailCandidates(
  file
) {

  /* -----------------------------------------------------------------
     RESET PREVIOUS THUMBNAIL SESSION
  ----------------------------------------------------------------- */

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


  /* -----------------------------------------------------------------
     LOAD FACE DETECTOR
  ----------------------------------------------------------------- */

  const detector =
    await loadFaceDetector();


  /* -----------------------------------------------------------------
     CREATE TEMPORARY VIDEO
  ----------------------------------------------------------------- */

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

    /* ---------------------------------------------------------------
       READ VIDEO METADATA
    --------------------------------------------------------------- */

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


    /* ---------------------------------------------------------------
       DEFINE FRAME SAMPLE POINTS
    ---------------------------------------------------------------

       Frames are deliberately sampled throughout most of the video
       rather than just near the beginning.

       The exact beginning/end are avoided because they are more likely
       to contain fades, titles or transitional frames.
    --------------------------------------------------------------- */

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


    /* ---------------------------------------------------------------
       PREPARE FRAME CANVAS
    --------------------------------------------------------------- */

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


    /*
     * Thumbnail analysis does not need the video's full native
     * resolution.
     *
     * Limit analysis width to 960px while preserving the original
     * aspect ratio. Smaller source videos retain their native width.
     *
     * This reduces the amount of image data MediaPipe must analyse.
     */
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


    /* ---------------------------------------------------------------
       SAMPLE EACH FRAME
    --------------------------------------------------------------- */

    for (
      let i = 0;
      i < percentages.length;
      i++
    ) {

      /*
       * Calculate the requested point in the video.
       *
       * duration - 0.25 prevents seeking directly onto the absolute
       * final frame, which can be unreliable in some media files.
       */
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


      /* -------------------------------------------------------------
         SEEK VIDEO
      ------------------------------------------------------------- */

      await seekVideo(
        video,
        time
      );


      /* -------------------------------------------------------------
         COPY FRAME TO CANVAS
      ------------------------------------------------------------- */

      ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );


      /* -------------------------------------------------------------
         DETECT FACES
      ------------------------------------------------------------- */

      const result =
        detector.detect(
          canvas
        );


      const detections =
        result?.detections ||
        [];


      /* -------------------------------------------------------------
         SCORE FRAME
      ------------------------------------------------------------- */

      const scoring =
        scoreThumbnailFrame(
          detections,
          canvas.width,
          canvas.height
        );


      /* -------------------------------------------------------------
         CONVERT FRAME TO PNG
      ------------------------------------------------------------- */

      const blob =
        await canvasToPngBlob(
          canvas
        );


      /* -------------------------------------------------------------
         STORE CANDIDATE
      ------------------------------------------------------------- */

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


    /* ---------------------------------------------------------------
       RANK CANDIDATES
    ---------------------------------------------------------------

       Highest-scoring candidate becomes index 0.
    --------------------------------------------------------------- */

    thumbnailCandidates.sort(
      (a, b) =>
        b.score -
        a.score
    );


    /* ---------------------------------------------------------------
       DISPLAY BEST CANDIDATE
    --------------------------------------------------------------- */

    showThumbnailCandidate(
      0
    );

  } finally {

    /* ---------------------------------------------------------------
       CLEAN UP TEMPORARY VIDEO
    --------------------------------------------------------------- */

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
   05. MEDIAPIPE FACE DETECTOR
===================================================================== */

/**
 * Loads and caches the MediaPipe face detector.
 *
 * The detector is loaded lazily rather than during initial page load.
 * This means MediaPipe resources are only initialised when the user
 * actually selects a video for thumbnail generation.
 *
 * Subsequent calls return the existing detector instance immediately.
 *
 * Configuration:
 *
 *     Model:
 *         BlazeFace short-range float16
 *
 *     Mode:
 *         IMAGE
 *
 *     Minimum confidence:
 *         0.55
 *
 * @returns {Promise<FaceDetector>}
 */

/* =====================================================================
   MEDIAPIPE VERSION
   =====================================================================

   MediaPipe is deliberately pinned to a specific stable version rather
   than using @latest.

   This ensures that a future MediaPipe release cannot unexpectedly
   change the JavaScript API or WASM implementation used by thumbnail
   generation without us explicitly upgrading and testing it first.

   IMPORTANT:

   The JavaScript module and WASM directory must use the SAME version.

   Current pinned version:

       @mediapipe/tasks-vision 1.0.1

   When upgrading MediaPipe in future, update BOTH URLs together and
   test thumbnail generation before deploying.
===================================================================== */


async function loadFaceDetector() {

  /*
   * Reuse the already-loaded detector.
   */
  if (faceDetector) {
    return faceDetector;
  }


  if (
    addVideoThumbnailStatus
  ) {

    addVideoThumbnailStatus.textContent =
      "Loading face detector…";
  }


  /*
   * Load the MediaPipe WebAssembly runtime.
   */
  const vision =
    await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );

  /*
   * Create the actual face detector.
   */
  faceDetector =
    await FaceDetector
      .createFromOptions(
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
   06. VIDEO FRAME SEEKING
===================================================================== */

/**
 * Moves the temporary video element to a specific timestamp and waits
 * until the browser confirms that seeking has completed.
 *
 * The returned Promise resolves on the video's "seeked" event.
 *
 * It rejects if the video raises an error while seeking.
 *
 * Temporary event listeners are removed after either outcome.
 *
 * @param {HTMLVideoElement} video
 * @param {number} time
 * @returns {Promise<void>}
 */
function seekVideo(
  video,
  time
) {

  return new Promise(
    (resolve, reject) => {

      /**
       * Called when the requested video position has been reached.
       */
      const onSeeked =
        () => {

          cleanup();

          resolve();
        };


      /**
       * Called if seeking fails.
       */
      const onError =
        () => {

          cleanup();


          reject(
            new Error(
              "Could not seek video for thumbnail generation."
            )
          );
        };


      /**
       * Removes temporary seek listeners.
       */
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


      /*
       * Install listeners before changing currentTime so a very fast
       * seek cannot complete before the listener exists.
       */
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


      /*
       * Initiate the seek.
       */
      video.currentTime =
        time;
    }
  );
}


/* =====================================================================
   07. FRAME SCORING
   =====================================================================

   The scoring system attempts to favour frames that make useful
   catalogue thumbnails.

   The broad priorities are:

       Multiple visible faces
            ↓
       Larger combined face area
            ↓
       Faces nearer the centre
            ↓
       Strong single-face portrait

   Very small face detections are ignored.
===================================================================== */

/**
 * Scores a frame according to the faces detected by MediaPipe.
 *
 * Faces occupying less than 2.5% of the complete frame are discarded.
 * This helps prevent tiny/background faces from dominating the ranking.
 *
 * Scoring:
 *
 *     2+ useful faces
 *         +100
 *
 *     each face beyond the first two
 *         +20
 *
 *     combined face area
 *         combinedFaceRatio × 180
 *
 *     central positioning
 *         up to +10 per useful face
 *
 *     one large face occupying >= 15% of frame
 *         +40
 *
 * @param {Array} detections
 *        MediaPipe face detections.
 *
 * @param {number} width
 *        Canvas/frame width.
 *
 * @param {number} height
 *        Canvas/frame height.
 *
 * @returns {{
 *   score: number,
 *   faceCount: number,
 *   combinedFaceRatio: number
 * }}
 */
function scoreThumbnailFrame(
  detections,
  width,
  height
) {

  const frameArea =
    width *
    height;


  /* -----------------------------------------------------------------
     REMOVE INSIGNIFICANT FACE DETECTIONS
  ----------------------------------------------------------------- */

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


          /*
           * Ignore faces occupying less than 2.5% of the frame.
           */
          return (
            areaRatio >=
            0.025
          );
        }
      );


  const faceCount =
    usefulFaces.length;


  /*
   * A frame without useful faces receives no score.
   */
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


  /* -----------------------------------------------------------------
     CALCULATE FACE AREA + CENTRALITY
  ----------------------------------------------------------------- */

  for (
    const box of usefulFaces
  ) {

    combinedFaceArea +=
      box.width *
      box.height;


    /*
     * Find the centre point of the detected face.
     */
    const centreX =
      box.originX +
      box.width / 2;


    const centreY =
      box.originY +
      box.height / 2;


    /*
     * Calculate horizontal and vertical distance from the centre of
     * the complete frame.
     *
     * Values are normalised so:
     *
     *     0 = centre
     *     1 = edge
     */
    const dx =
      Math.abs(
        centreX -
        width / 2
      ) /
      (width / 2);


    const dy =
      Math.abs(
        centreY -
        height / 2
      ) /
      (height / 2);


    /*
     * Convert distance into a centrality score:
     *
     *     1 = highly central
     *     0 = highly peripheral
     */
    const centrality =
      1 -
      Math.min(
        1,
        (dx + dy) / 2
      );


    /*
     * Each face can contribute up to 10 centrality points.
     */
    centreBonus +=
      centrality *
      10;
  }


  /* -----------------------------------------------------------------
     COMBINED FACE COVERAGE
  ----------------------------------------------------------------- */

  const combinedFaceRatio =
    combinedFaceArea /
    frameArea;


  /* -----------------------------------------------------------------
     BUILD FINAL SCORE
  ----------------------------------------------------------------- */

  let score = 0;


  /*
   * Strong preference for frames containing at least two useful faces.
   */
  if (
    faceCount >= 2
  ) {

    score +=
      100;
  }


  /*
   * Additional reward for frames containing more than two useful faces.
   */
  if (
    faceCount > 2
  ) {

    score +=
      (faceCount - 2) *
      20;
  }


  /*
   * Prefer frames where faces occupy more of the image.
   */
  score +=
    combinedFaceRatio *
    180;


  /*
   * Prefer faces positioned closer to the centre.
   */
  score +=
    centreBonus;


  /*
   * A strong single-person portrait is still considered a desirable
   * thumbnail even though it does not receive the multiple-face bonus.
   */
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
   08. CANVAS → PNG
===================================================================== */

/**
 * Converts the current canvas contents into a PNG Blob.
 *
 * canvas.toBlob() uses a callback rather than returning a Promise, so
 * this helper wraps it in a Promise to make thumbnail generation easier
 * to use with async/await.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Blob>}
 */
function canvasToPngBlob(
  canvas
) {

  return new Promise(
    (resolve, reject) => {

      canvas.toBlob(
        blob => {

          if (blob) {

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


/* =================================================================================================================
   REMOTE VIDEO THUMBNAIL GENERATION
   =================================================================================================================

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
=================================================================================================================== */

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

        const timeout =
          window.setTimeout(
            () => {

              cleanup();

              reject(
                new Error(
                  "Timed out while loading video metadata."
                )
              );
            },
            30000
          );


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
              "error",
              onError
            );
          };


        const onLoaded =
          () => {

            cleanup();
            resolve();
          };


        const onError =
          () => {

            cleanup();

            reject(
              new Error(
                "Could not read the remote video for thumbnail repair."
              )
            );
          };


        video.addEventListener(
          "loadedmetadata",
          onLoaded,
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
          willReadFrequently: true
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


      ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );


      /*
       * If the media response does not permit cross-origin canvas use,
       * accessing the canvas here will throw a SecurityError. That error
       * is intentionally allowed to propagate to Admin so the repair
       * cannot accidentally upload an invalid image.
       */
      const result =
        detector.detect(
          canvas
        );


      const detections =
        result?.detections ||
        [];


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


      thumbnailCandidates.push(
        {
          time,

          blob,

          score:
            scoring.score,

          faceCount:
            scoring.faceCount,

          combinedFaceRatio:
            scoring.combinedFaceRatio
        }
      );
    }


    if (
      !thumbnailCandidates.length
    ) {

      throw new Error(
        "No thumbnail candidates could be generated."
      );
    }


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
   09. THUMBNAIL PREVIEW / SELECTION
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
 * The previous preview object URL is revoked before creating the new
 * one.
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
   */
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


/* =====================================================================
   10. GET SELECTED THUMBNAIL
===================================================================== */

/**
 * Returns the PNG Blob belonging to the currently displayed thumbnail.
 *
 * add-video.js calls this after the video catalogue entry has been
 * created.
 *
 * @returns {Blob|null}
 */
export function getSelectedThumbnailBlob() {

  return selectedThumbnailBlob;
}


/* =====================================================================
   11. RESET THUMBNAIL STATE
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
   12. THUMBNAIL UPLOAD
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

  if (!thumbnailBlob) {

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
