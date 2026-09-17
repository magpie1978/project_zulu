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
