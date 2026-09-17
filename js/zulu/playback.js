import { supabase } from "../supabaseClient.js";


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


let activeVideoUid = null;
let viewTimer = null;
let viewLogged = false;


/* =================================================================================================================
   SIGNED VIDEO URL
==================================================================================================================== */

async function getSignedVideoUrl(
  originalUrl
) {
  if (!originalUrl) {
    throw new Error(
      "No video URL supplied."
    );
  }

  let path;

  try {
    const parsedUrl =
      new URL(originalUrl);

    path = parsedUrl.pathname;

  } catch {
    path =
      originalUrl.startsWith("/")
        ? originalUrl
        : `/${originalUrl}`;
  }

  console.log(
    "Requesting signed URL for:",
    path
  );

  const {
    data,
    error
  } =
    await supabase.functions.invoke(
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


/* =================================================================================================================
   OPEN VIDEO
==================================================================================================================== */

export async function openVideo(
  url,
  uid
) {
  if (!url) {
    console.warn(
      "No video URL found."
    );

    return;
  }

  if (!modal || !modalVideo) {
    return;
  }

  activeVideoUid = uid;
  viewLogged = false;

  clearViewTimer();
  resetModalSources();

  modal.classList.add("open");

  document.body.classList.add(
    "modal-open"
  );

  try {
    const signedUrl =
      await getSignedVideoUrl(url);

    modalVideo.src =
      signedUrl;

    modalVideo.style.display =
      "block";

    await modalVideo.play();

    startViewTimer();

  } catch (error) {
    console.error(
      "Video could not be opened:",
      error
    );

    resetModalSources();

    modal.classList.remove(
      "open"
    );

    document.body.classList.remove(
      "modal-open"
    );
  }
}


/* =================================================================================================================
   CLOSE VIDEO
==================================================================================================================== */

function closeVideoModal() {
  modal?.classList.remove(
    "open"
  );

  document.body.classList.remove(
    "modal-open"
  );

  clearViewTimer();
  resetModalSources();

  activeVideoUid = null;
  viewLogged = false;
}


function resetModalSources() {
  if (!modalVideo) {
    return;
  }

  try {
    modalVideo.pause();

  } catch {
    // Ignore pause errors
  }

  modalVideo.removeAttribute(
    "src"
  );

  modalVideo.load();

  modalVideo.style.display =
    "none";
}


/* =================================================================================================================
   VIEW LOGGING
==================================================================================================================== */

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


function clearViewTimer() {
  if (viewTimer) {
    clearTimeout(
      viewTimer
    );

    viewTimer = null;
  }
}


async function logVideoView(uid) {
  if (
    !uid ||
    viewLogged
  ) {
    return;
  }

  viewLogged = true;

  const {
    error
  } =
    await supabase
      .from(
        "zulu_video_views"
      )
      .insert({
        video_uid: uid,
        watch_seconds: 15
      });

  if (error) {
    console.error(
      "Error logging video view:",
      error
    );
  }
}


/* =================================================================================================================
   MODAL EVENTS
==================================================================================================================== */

export function attachPlaybackEvents() {
  closeModal?.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      closeVideoModal();
    }
  );

  modal?.addEventListener(
    "click",
    event => {
      if (
        event.target === modal
      ) {
        closeVideoModal();
      }
    }
  );

  document.addEventListener(
    "keydown",
    event => {
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
