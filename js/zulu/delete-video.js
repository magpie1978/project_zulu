import { supabase } from "../supabaseClient.js";


export async function deleteZuluVideo(
  video,
  button,
  {
    onDeleted
  } = {}
) {
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

  titleElement.textContent =
    video.film;

  uidElement.textContent =
    `UID ${video.uid}`;

  modal.classList.add("open");

  modal.setAttribute(
    "aria-hidden",
    "false"
  );

  confirmButton.focus();

  return new Promise(resolve => {

    let deleting = false;

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

      cleanup();

      resolve(false);
    }


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


    function handleBackdrop(event) {
      if (
        event.target === modal
      ) {
        closeModal();
      }
    }


    function handleKeydown(event) {
      if (
        event.key === "Escape"
      ) {
        closeModal();
      }
    }


    async function confirmDelete() {
      deleting = true;

      confirmButton.disabled = true;
      cancelButton.disabled = true;

      confirmButton.textContent =
        "Deleting…";

      try {
        const {
          data,
          error
        } =
          await supabase.functions.invoke(
            "zulu-delete-video",
            {
              body: {
                uid:
                  video.uid
              }
            }
          );

        if (error) {
          throw error;
        }

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

        modal.classList.remove(
          "open"
        );

        modal.setAttribute(
          "aria-hidden",
          "true"
        );

        cleanup();

        if (typeof onDeleted === "function") {
          await onDeleted({
            video,
            data
          });
        }

        resolve(true);

      } catch (error) {
        console.error(
          "VIDEO DELETE FAILED:",
          error
        );

        deleting = false;

        confirmButton.disabled =
          false;

        cancelButton.disabled =
          false;

        confirmButton.textContent =
          "Delete permanently";

        alert(
          `Delete failed: ${
            error?.message ||
            "Unknown error"
          }`
        );
      }
    }


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
