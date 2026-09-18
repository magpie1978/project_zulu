import { supabase } from "../supabaseClient.js";


/* =====================================================================
   DELETE-VIDEO.JS
   =====================================================================

   PURPOSE
   -------

   This module manages the complete user-facing video deletion workflow
   for the Zulu Videos catalogue.

   Its responsibilities are:

   1. Display the Delete Video confirmation modal.
   2. Show the title and UID of the video being deleted.
   3. Allow the user to cancel deletion using:
        - the Cancel button;
        - the modal backdrop;
        - the Escape key.
   4. Prevent the modal from being closed once deletion has started.
   5. Call the zulu-delete-video Supabase Edge Function.
   6. Display a temporary "Deleting…" state while the request runs.
   7. Close the modal immediately after a successful deletion.
   8. Notify the calling module through the optional onDeleted callback.
   9. Restore the modal controls if deletion fails.
   10. Remove temporary event listeners whenever the modal closes.

   SERVER-SIDE DELETION
   --------------------

   The actual deletion is NOT performed directly by this browser module.

   Instead, the module calls the Supabase Edge Function:

       zulu-delete-video

   and sends:

       {
         uid: video.uid
       }

   The Edge Function is responsible for performing the actual deletion
   work.

   RETURN VALUE
   ------------

   deleteZuluVideo() returns a Promise which resolves to:

       true
           The deletion succeeded.

       false
           The user cancelled or closed the confirmation modal.

   RELATED MODULE
   --------------

   catalogue.js

       Calls deleteZuluVideo() when the trash button on a video card
       is selected.

       It can supply an onDeleted callback to refresh the catalogue,
       actor counts, or other UI after deletion succeeds.

   ===================================================================== */


/* =====================================================================
   01. DELETE VIDEO WORKFLOW
===================================================================== */

/**
 * Opens the Delete Video confirmation modal and manages the complete
 * deletion lifecycle for one video.
 *
 * The function deliberately returns a Promise so the calling module can
 * optionally wait for the user's decision.
 *
 * @param {Object} video
 *        Video record being deleted.
 *
 * @param {*} video.uid
 *        Unique database identifier sent to zulu-delete-video.
 *
 * @param {string} video.film
 *        Film title displayed in the confirmation modal.
 *
 * @param {Object} options
 *
 * @param {Function} [options.onDeleted]
 *        Optional callback executed after deletion succeeds.
 *
 *        Receives:
 *
 *            {
 *              video,
 *              data
 *            }
 *
 *        where:
 *
 *            video = original video object
 *            data  = response from zulu-delete-video
 *
 * @returns {Promise<boolean>|undefined}
 *        true  = deletion succeeded
 *        false = deletion cancelled
 *
 *        Returns undefined if the required modal DOM elements are
 *        missing and the workflow cannot start.
 */
export async function deleteZuluVideo(
  video,
  {
    onDeleted
  } = {}
) {

  /* =================================================================
     02. FIND MODAL ELEMENTS
     =================================================================

     These elements are looked up when deletion begins rather than when
     the module is imported.

     This ensures the function works with the modal currently present
     in the document.
  ================================================================= */

  const modal =
    document.getElementById(
      "deleteVideoModal"
    );

  const titleElement =
    document.getElementById(
      "deleteVideoTitle"
    );

  const uidElement =
    document.getElementById(
      "deleteVideoUid"
    );

  const cancelButton =
    document.getElementById(
      "deleteVideoCancel"
    );

  const confirmButton =
    document.getElementById(
      "deleteVideoConfirm"
    );


  /* =================================================================
     03. VERIFY MODAL EXISTS
     =================================================================

     The deletion workflow cannot continue unless every required modal
     element exists.
  ================================================================= */

  if (
    !modal ||
    !titleElement ||
    !uidElement ||
    !cancelButton ||
    !confirmButton
  ) {

    console.error(
      "Delete video modal elements are missing."
    );

    return;
  }


  /* =================================================================
     04. PREPARE MODAL
     =================================================================

     The modal elements persist between deletion attempts.

     Reset their controls every time the modal opens so that a previous
     successful or failed deletion cannot leave buttons disabled or
     displaying stale text.
  ================================================================= */

  confirmButton.disabled =
    false;

  cancelButton.disabled =
    false;

  confirmButton.textContent =
    "Delete permanently";


  /*
   * Display the video being targeted.
   */
  titleElement.textContent =
    video.film;

  uidElement.textContent =
    `UID ${video.uid}`;


  /* =================================================================
     05. OPEN MODAL
  ================================================================= */

  modal.classList.add(
    "open"
  );

  modal.setAttribute(
    "aria-hidden",
    "false"
  );


  /*
   * Put keyboard focus directly on the destructive action.
   */
  confirmButton.focus();


  /* =================================================================
     06. WAIT FOR USER ACTION
     =================================================================

     The Promise remains pending while the confirmation modal is open.

     It resolves:

         false
             if the user cancels;

         true
             if the server confirms successful deletion.
  ================================================================= */

  return new Promise(resolve => {

    /*
     * Tracks whether the server-side deletion request has started.
     *
     * Once true, cancellation is disabled so the user cannot close the
     * modal while the deletion is actively being processed.
     */
    let deleting = false;


    /* ===============================================================
       07. CLOSE / CANCEL MODAL
    =============================================================== */

    /**
     * Closes the modal without deleting the video.
     *
     * This function is shared by:
     *
     *   - Cancel button
     *   - backdrop click
     *   - Escape key
     *
     * Closing is ignored once deletion has started.
     */
    function closeModal() {

      if (deleting) {
        return;
      }


      modal.classList.remove(
        "open"
      );

      modal.setAttribute(
        "aria-hidden",
        "true"
      );


      /*
       * Remove the temporary listeners installed for this particular
       * deletion attempt.
       */
      cleanup();


      /*
       * Tell the caller that deletion was cancelled.
       */
      resolve(false);
    }


    /* ===============================================================
       08. EVENT LISTENER CLEANUP
    =============================================================== */

    /**
     * Removes all listeners attached while this confirmation modal was
     * active.
     *
     * This is important because deleteZuluVideo() may be called many
     * times during a page session. Without cleanup, old listeners would
     * accumulate and future clicks could trigger handlers multiple times.
     */
    function cleanup() {

      cancelButton.removeEventListener(
        "click",
        closeModal
      );

      confirmButton.removeEventListener(
        "click",
        confirmDelete
      );

      modal.removeEventListener(
        "click",
        handleBackdrop
      );

      document.removeEventListener(
        "keydown",
        handleKeydown
      );
    }


    /* ===============================================================
       09. BACKDROP CANCELLATION
    =============================================================== */

    /**
     * Closes the confirmation modal when the user clicks the modal's
     * outer backdrop.
     *
     * event.target === modal ensures that clicks inside the dialog do
     * not accidentally close it.
     *
     * @param {MouseEvent} event
     */
    function handleBackdrop(event) {

      if (
        event.target === modal
      ) {
        closeModal();
      }
    }


    /* ===============================================================
       10. KEYBOARD CANCELLATION
    =============================================================== */

    /**
     * Allows Escape to close the confirmation modal before deletion has
     * started.
     *
     * closeModal() itself checks the deleting flag, so Escape becomes
     * harmless once the server request is underway.
     *
     * @param {KeyboardEvent} event
     */
    function handleKeydown(event) {

      if (
        event.key === "Escape"
      ) {
        closeModal();
      }
    }


    /* ===============================================================
       11. CONFIRM DELETION
    =============================================================== */

    /**
     * Performs the confirmed deletion.
     *
     * Workflow:
     *
     *   1. Mark deletion as active.
     *   2. Disable both modal buttons.
     *   3. Display "Deleting…".
     *   4. Call zulu-delete-video.
     *   5. Validate the Edge Function response.
     *   6. Close the modal.
     *   7. Resolve the deletion Promise as true.
     *   8. Run the optional post-delete callback.
     *
     * If deletion fails, the modal remains open and its controls are
     * restored so the user can retry or cancel.
     */
    async function confirmDelete() {

      /* -------------------------------------------------------------
         LOCK MODAL
      ------------------------------------------------------------- */

      deleting = true;

      confirmButton.disabled =
        true;

      cancelButton.disabled =
        true;

      confirmButton.textContent =
        "Deleting…";


      try {

        /* -----------------------------------------------------------
           CALL SERVER-SIDE DELETE FUNCTION
        ----------------------------------------------------------- */

        const {
          data,
          error
        } =
          await supabase
            .functions
            .invoke(
              "zulu-delete-video",
              {
                body: {
                  uid:
                    video.uid
                }
              }
            );


        /*
         * Supabase invocation/network failure.
         */
        if (error) {
          throw error;
        }


        /*
         * The Edge Function responded, but reported that deletion did
         * not complete successfully.
         */
        if (!data?.success) {

          throw new Error(
            data?.error ||
            "The video could not be deleted."
          );
        }


        console.log(
          "VIDEO DELETED:",
          data
        );


        /* -----------------------------------------------------------
           CLOSE MODAL AFTER SUCCESS
        -----------------------------------------------------------

           The deletion itself has now succeeded.

           Close the modal immediately rather than keeping it visible
           while the catalogue/sidebar refreshes.
        ----------------------------------------------------------- */

        modal.classList.remove(
          "open"
        );

        modal.setAttribute(
          "aria-hidden",
          "true"
        );


        cleanup();


        /*
         * Resolve the primary deletion operation before performing
         * optional UI refresh work.
         */
        resolve(true);


        /* -----------------------------------------------------------
           POST-DELETE REFRESH
        -----------------------------------------------------------

           Refreshing catalogue/sidebar state is deliberately separate
           from the deletion operation itself.

           A refresh failure must NOT make a successful server-side
           deletion appear to have failed.
        ----------------------------------------------------------- */

        if (
          typeof onDeleted ===
          "function"
        ) {

          try {

            await onDeleted({
              video,
              data
            });

          } catch (
            refreshError
          ) {

            console.error(
              "POST-DELETE REFRESH FAILED:",
              refreshError
            );
          }
        }

      } catch (error) {

        /* -----------------------------------------------------------
           DELETE FAILURE
        ----------------------------------------------------------- */

        console.error(
          "VIDEO DELETE FAILED:",
          error
        );


        /*
         * Re-enable cancellation and retry.
         */
        deleting = false;

        confirmButton.disabled =
          false;

        cancelButton.disabled =
          false;

        confirmButton.textContent =
          "Delete permanently";


        /*
         * Keep the confirmation modal open and tell the user what
         * failed.
         */
        alert(
          `Delete failed: ${
            error?.message ||
            "Unknown error"
          }`
        );
      }
    }


    /* ===============================================================
       12. ATTACH TEMPORARY MODAL EVENTS
       ===============================================================

       These listeners exist only while this particular confirmation
       dialog is active.

       cleanup() removes them when the modal closes or deletion
       succeeds.
    =============================================================== */

    cancelButton.addEventListener(
      "click",
      closeModal
    );

    confirmButton.addEventListener(
      "click",
      confirmDelete
    );

    modal.addEventListener(
      "click",
      handleBackdrop
    );

    document.addEventListener(
      "keydown",
      handleKeydown
    );
  });
}
