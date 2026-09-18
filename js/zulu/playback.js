import { supabase } from "../supabaseClient.js";


/* =====================================================================
   PLAYBACK.JS
   =====================================================================

   PURPOSE
   -------

   This module manages video playback for the Zulu Videos catalogue.

   Its responsibilities are:

   1. Open the video-player modal when a catalogue video is selected.
   2. Request a temporary signed media URL from the Supabase Edge
      Function:
      
          zulu-sign-media

   3. Load the signed URL into the HTML <video> element.
   4. Start video playback.
   5. Close and reset the player when the user:
        - clicks the close button;
        - clicks the modal backdrop;
        - presses Escape.
   6. Start a 15-second timer when playback begins.
   7. Record a view in zulu_video_views if the video remains open for
      at least 15 seconds.
   8. Ensure only one view is recorded for each playback session.
   9. Cancel the view timer if the video is closed before 15 seconds.
   10. Release the current video source when playback ends.

   SIGNED MEDIA ACCESS
   -------------------

   Raw catalogue URLs are not loaded directly into the video player.

   Instead, the media path is sent to:

       zulu-sign-media

   which returns a temporary signed URL that authorises access through
   the protected media delivery system.

   VIEW COUNTING
   -------------

   A catalogue view is currently counted after 15 seconds of playback.

   When the timer completes, this module inserts:

       {
         video_uid: uid,
         watch_seconds: 15
       }

   into:

       zulu_video_views

   The viewLogged flag prevents the same playback session from being
   counted more than once.

   RELATED MODULE
   --------------

   catalogue.js

       Calls openVideo(url, uid) when a user clicks a video card.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
   =====================================================================

   Cache the player modal elements used by this module.
===================================================================== */

const modal =
  document.getElementById(
    "videoModal"
  );

const modalVideo =
  document.getElementById(
    "modalVideo"
  );

const closeModal =
  document.getElementById(
    "closeModal"
  );


/* =====================================================================
   02. PLAYBACK STATE
   =====================================================================

   activeVideoUid
       UID of the video currently loaded in the player.

       This is used when the 15-second view timer completes.

   viewTimer
       Reference to the current setTimeout timer.

       Keeping the reference allows the timer to be cancelled if the
       user closes the video before reaching 15 seconds.

   viewLogged
       Prevents more than one view being inserted for the same playback
       session.
===================================================================== */

let activeVideoUid = null;
let viewTimer = null;
let viewLogged = false;


/* =====================================================================
   03. INITIALISATION / MODAL EVENTS
===================================================================== */

/**
 * Attaches the permanent event listeners used by the playback modal.
 *
 * The player can be closed using:
 *
 *   - the close button;
 *   - the modal backdrop;
 *   - the Escape key.
 *
 * This function should normally be called once when the application
 * initialises.
 */
export function attachPlaybackEvents() {

  /* -----------------------------------------------------------------
     CLOSE BUTTON
  ----------------------------------------------------------------- */

  closeModal?.addEventListener(
    "click",
    event => {

      /*
       * Prevent the close-button interaction from triggering any
       * underlying or parent click behaviour.
       */
      event.preventDefault();
      event.stopPropagation();

      closeVideoModal();
    }
  );


  /* -----------------------------------------------------------------
     MODAL BACKDROP
  ----------------------------------------------------------------- */

  modal?.addEventListener(
    "click",
    event => {

      /*
       * Only close if the user clicked the outer modal itself.
       *
       * Clicking the video or another element inside the modal should
       * not close playback.
       */
      if (
        event.target === modal
      ) {
        closeVideoModal();
      }
    }
  );


  /* -----------------------------------------------------------------
     ESCAPE KEY
  ----------------------------------------------------------------- */

  document.addEventListener(
    "keydown",
    event => {

      /*
       * Escape only needs to do anything while the player is open.
       */
      if (
        event.key === "Escape" &&
        modal?.classList.contains(
          "open"
        )
      ) {
        closeVideoModal();
      }
    }
  );
}


/* =====================================================================
   04. OPEN VIDEO
===================================================================== */

/**
 * Opens a catalogue video in the player modal.
 *
 * Workflow:
 *
 *   1. Validate the supplied URL and player elements.
 *   2. Store the active video UID.
 *   3. Reset view-tracking state.
 *   4. Clear any previous timer/video source.
 *   5. Open the modal.
 *   6. Request a signed media URL.
 *   7. Load that URL into the <video> element.
 *   8. Start playback.
 *   9. Start the 15-second view timer.
 *
 * If signing or playback fails, the player is reset and the modal is
 * closed again.
 *
 * @param {string} url
 *        Original catalogue/media URL.
 *
 * @param {*} uid
 *        UID of the catalogue video. Used for view logging.
 */
export async function openVideo(
  url,
  uid
) {

  /* -----------------------------------------------------------------
     VALIDATE REQUEST
  ----------------------------------------------------------------- */

  if (!url) {

    console.warn(
      "No video URL found."
    );

    return;
  }


  if (!modal || !modalVideo) {
    return;
  }


  /* -----------------------------------------------------------------
     PREPARE PLAYBACK SESSION
  ----------------------------------------------------------------- */

  activeVideoUid =
    uid;

  viewLogged =
    false;


  /*
   * Remove any state left behind by a previous playback session.
   */
  clearViewTimer();

  resetModalSources();


  /* -----------------------------------------------------------------
     OPEN MODAL
  ----------------------------------------------------------------- */

  modal.classList.add(
    "open"
  );

  document.body.classList.add(
    "modal-open"
  );


  try {

    /* ---------------------------------------------------------------
       REQUEST SIGNED MEDIA URL
    --------------------------------------------------------------- */

    const signedUrl =
      await getSignedVideoUrl(
        url
      );


    /* ---------------------------------------------------------------
       LOAD VIDEO
    --------------------------------------------------------------- */

    modalVideo.src =
      signedUrl;

    modalVideo.style.display =
      "block";


    /* ---------------------------------------------------------------
       START PLAYBACK
    --------------------------------------------------------------- */

    await modalVideo.play();


    /* ---------------------------------------------------------------
       START VIEW TIMER
    --------------------------------------------------------------- */

    startViewTimer();

  } catch (error) {

    console.error(
      "Video could not be opened:",
      error
    );


    /*
     * Signing or playback failed.
     *
     * Return the player to a clean closed state rather than leaving an
     * empty modal visible.
     */
    resetModalSources();

    modal.classList.remove(
      "open"
    );

    document.body.classList.remove(
      "modal-open"
    );
  }
}


/* =====================================================================
   05. CLOSE VIDEO
===================================================================== */

/**
 * Closes the video player and completely resets the current playback
 * session.
 *
 * Closing:
 *
 *   - hides the modal;
 *   - restores normal body state;
 *   - cancels the 15-second view timer;
 *   - stops/unloads the video;
 *   - clears the active video UID;
 *   - resets the viewLogged flag.
 */
function closeVideoModal() {

  modal?.classList.remove(
    "open"
  );

  document.body.classList.remove(
    "modal-open"
  );


  /*
   * If the user closes the video before the timer fires, the view
   * should not be recorded.
   */
  clearViewTimer();


  /*
   * Stop playback and release the current media source.
   */
  resetModalSources();


  /*
   * Clear session-specific state.
   */
  activeVideoUid =
    null;

  viewLogged =
    false;
}


/* =====================================================================
   06. SIGNED MEDIA URL
===================================================================== */

/**
 * Requests a temporary signed URL for a protected video.
 *
 * The function first extracts the pathname from the supplied catalogue
 * URL.
 *
 * Example:
 *
 *     https://media.zulu-orchid-falcon.co.uk/Video%20Name.mp4
 *
 * becomes:
 *
 *     /Video%20Name.mp4
 *
 * Only the path is sent to the Edge Function:
 *
 *     zulu-sign-media
 *
 * If the supplied value is not a complete URL, it is treated as a
 * media path and normalised so that it begins with "/".
 *
 * @param {string} originalUrl
 * @returns {Promise<string>}
 *        Temporary signed media URL.
 *
 * @throws
 *        If no URL was supplied, the signing request fails, or the
 *        signing service does not return a URL.
 */
async function getSignedVideoUrl(
  originalUrl
) {

  if (!originalUrl) {

    throw new Error(
      "No video URL supplied."
    );
  }


  let path;


  /* -----------------------------------------------------------------
     EXTRACT MEDIA PATH
  ----------------------------------------------------------------- */

  try {

    const parsedUrl =
      new URL(
        originalUrl
      );

    path =
      parsedUrl.pathname;

  } catch {

    /*
     * The supplied value may already be a relative media path.
     */
    path =
      originalUrl.startsWith("/")
        ? originalUrl
        : `/${originalUrl}`;
  }


  console.log(
    "Requesting signed URL for:",
    path
  );


  /* -----------------------------------------------------------------
     REQUEST SIGNED URL
  ----------------------------------------------------------------- */

  const {
    data,
    error
  } =
    await supabase
      .functions
      .invoke(
        "zulu-sign-media",
        {
          body: {
            path
          }
        }
      );


  if (error) {

    console.error(
      "Signed URL error:",
      error
    );

    throw error;
  }


  /*
   * A successful Edge Function invocation must still contain the
   * expected signed URL.
   */
  if (!data?.url) {

    console.error(
      "Signing response:",
      data
    );

    throw new Error(
      "Signing service did not return a video URL."
    );
  }


  console.log(
    "Signed video URL received."
  );


  return data.url;
}


/* =====================================================================
   07. PLAYER RESET
===================================================================== */

/**
 * Stops playback and removes the current media source from the player.
 *
 * Removing src and calling load() is important because simply hiding
 * the modal would leave the browser holding the previous media
 * resource and potentially continuing network activity.
 *
 * The function is safe to call even when no video is currently loaded.
 */
function resetModalSources() {

  if (!modalVideo) {
    return;
  }


  /*
   * pause() should normally succeed, but there is no reason for a pause
   * failure to prevent the rest of the player cleanup.
   */
  try {

    modalVideo.pause();

  } catch {

    /*
     * Intentionally ignore pause errors.
     */
  }


  /*
   * Remove the signed media URL.
   */
  modalVideo.removeAttribute(
    "src"
  );


  /*
   * Reset the HTMLMediaElement after removing its source.
   */
  modalVideo.load();


  /*
   * Hide the player until another video is successfully loaded.
   */
  modalVideo.style.display =
    "none";
}


/* =====================================================================
   08. VIEW TIMER
===================================================================== */

/**
 * Starts the timer used to determine whether a playback session counts
 * as a video view.
 *
 * A view is currently recorded after 15,000 ms / 15 seconds.
 *
 * Any existing timer is cleared first so only one timer can exist for
 * the active playback session.
 */
function startViewTimer() {

  clearViewTimer();


  viewTimer =
    setTimeout(
      () => {

        logVideoView(
          activeVideoUid
        );
      },
      15000
    );
}


/**
 * Cancels the active view timer, if one exists.
 *
 * This is called:
 *
 *   - before starting a new timer;
 *   - when a video closes;
 *   - before opening another video.
 */
function clearViewTimer() {

  if (viewTimer) {

    clearTimeout(
      viewTimer
    );

    viewTimer =
      null;
  }
}


/* =====================================================================
   09. VIEW LOGGING
===================================================================== */

/**
 * Records a video view after the viewer has watched for the required
 * amount of time.
 *
 * A view is only marked as successfully logged AFTER Supabase confirms
 * that the database insert succeeded.
 *
 * If the insert fails because of a temporary network or Supabase
 * problem, another attempt is made after 5 seconds.
 *
 * Retries continue while:
 *
 *     - the same video is still active; and
 *     - the view has not already been logged successfully.
 *
 * If the viewer closes the video or opens another video before the
 * retry occurs, the retry is abandoned.
 *
 * @param {string|number} uid
 *        UID of the video whose view should be recorded.
 */
async function logVideoView(
  uid
) {

  /* -----------------------------------------------------------------
     VALIDATE REQUEST
     -----------------------------------------------------------------

     Do nothing if:

         - there is no video UID; or
         - this playback session has already successfully logged a view.

     The viewLogged flag prevents multiple successful inserts for the
     same playback session.
  ----------------------------------------------------------------- */

  if (
    !uid ||
    viewLogged
  ) {
    return;
  }


  /* -----------------------------------------------------------------
     ATTEMPT TO RECORD VIEW
     -----------------------------------------------------------------

     Insert one view into zulu_video_views.

     watch_seconds remains fixed at 15 because this function is first
     called by the existing 15-second playback timer.
  ----------------------------------------------------------------- */

  const {
    error
  } =
    await supabase
      .from(
        "zulu_video_views"
      )
      .insert({
        video_uid:
          uid,

        watch_seconds:
          15
      });


  /* -----------------------------------------------------------------
     INSERT FAILED
     -----------------------------------------------------------------

     IMPORTANT:

     Do NOT set viewLogged to true here.

     The database has not confirmed that the view was recorded, so the
     playback session must remain eligible for another attempt.

     Wait 5 seconds before trying again. This avoids immediately
     hammering Supabase during a temporary connection or service issue.
  ----------------------------------------------------------------- */

  if (error) {

    console.error(
      "Could not log video view:",
      error
    );


    setTimeout(
      () => {

        /* -------------------------------------------------------------
           VERIFY PLAYBACK SESSION BEFORE RETRYING
           -------------------------------------------------------------

           Only retry if:

               1. The video currently open is still the same video that
                  originally generated this view.

               2. Another attempt has not already successfully recorded
                  the view.

           This prevents a delayed retry from recording a view after
           the original video has been closed or replaced by another
           video.
        ------------------------------------------------------------- */

        if (
          activeVideoUid === uid &&
          !viewLogged
        ) {

          logVideoView(
            uid
          );
        }
      },

      5000
    );


    return;
  }


  /* -----------------------------------------------------------------
     INSERT SUCCEEDED
     -----------------------------------------------------------------

     Supabase has now confirmed that the view exists in
     zulu_video_views.

     Only at this point do we mark the playback session as logged.

     Any pending retry callback will see viewLogged === true and will
     therefore do nothing.
  ----------------------------------------------------------------- */

  viewLogged =
    true;
}
