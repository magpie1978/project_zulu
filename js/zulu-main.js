import { supabase } from "./supabaseClient.js";

import {
  attachPlaybackEvents
} from "./zulu/playback.js";

import {
  attachActorEvents,
  loadActorSidebar
} from "./zulu/actors.js";

import {
  attachCatalogueEvents,
  loadZuluVideos
} from "./zulu/catalogue.js";

import {
  attachAddVideoEvents
} from "./zulu/add-video.js";


/* =================================================================================================================
   DOM ELEMENTS
==================================================================================================================== */

const logoutButton =
  document.getElementById(
    "logoutButton"
  );


const headerMenuButton =
  document.getElementById(
    "header-menu-button"
  );

const headerMenu =
  document.getElementById(
    "header-menu"
  );


headerMenuButton?.addEventListener(
  "click",
  event => {
    event.stopPropagation();

    const isOpen =
      !headerMenu.hidden;

    headerMenu.hidden =
      isOpen;

    headerMenuButton.setAttribute(
      "aria-expanded",
      String(!isOpen)
    );
  }
);


headerMenu?.addEventListener(
  "click",
  event => {
    event.stopPropagation();
  }
);


document.addEventListener(
  "click",
  () => {
    if (!headerMenu) {
      return;
    }

    headerMenu.hidden = true;

    headerMenuButton?.setAttribute(
      "aria-expanded",
      "false"
    );
  }
);


document.addEventListener(
  "keydown",
  event => {
    if (
      event.key !== "Escape" ||
      !headerMenu
    ) {
      return;
    }

    headerMenu.hidden = true;

    headerMenuButton?.setAttribute(
      "aria-expanded",
      "false"
    );
  }
);

/* =================================================================================================================
   INITIALISATION
==================================================================================================================== */

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const {
      data: { session },
      error
    } =
      await supabase.auth
        .getSession();

    if (error) {
      console.error(
        "Session check failed:",
        error
      );

      window.location.replace(
        "index.html"
      );

      return;
    }

    if (!session) {
      window.location.replace(
        "index.html"
      );

      return;
    }


    attachActorEvents({
      onSelected:
        loadZuluVideos
    });


    attachCatalogueEvents({
      onDeleted:
        loadActorSidebar
    });


    attachAddVideoEvents({
      onAdded: async () => {
        await loadActorSidebar();
        await loadZuluVideos();
      }
    });


    await loadActorSidebar();
    await loadZuluVideos();

    attachPlaybackEvents();
  }
);


/* =================================================================================================================
   LOGOUT
==================================================================================================================== */

logoutButton?.addEventListener(
  "click",
  async () => {
    const { error } =
      await supabase.auth
        .signOut();

    if (error) {
      console.error(
        "Logout error:",
        error
      );
    }

    window.location.replace(
      "index.html"
    );
  }
);
