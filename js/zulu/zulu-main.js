import { supabase } from "../supabaseClient.js";

import {
  attachPlaybackEvents
} from "./playback.js";

import {
  attachActorEvents,
  loadActorSidebar
} from "./actors.js";

import {
  attachCatalogueEvents,
  loadZuluVideos
} from "./catalogue.js";

import {
  attachAddVideoEvents
} from "./add-video.js";


/* =====================================================================
   ZULU-MAIN.JS
   =====================================================================

   PURPOSE
   -------

   This is the main application controller for the authenticated
   Zulu Videos catalogue.

   Individual feature modules contain the actual catalogue, actor,
   playback, upload and Add Video logic.

   This file is responsible for connecting those modules together and
   controlling the overall application lifecycle.


   MAIN RESPONSIBILITIES
   ---------------------

   1. Verify that the visitor has an active Supabase Auth session.

   2. Redirect unauthenticated visitors back to:

          index.html

   3. Connect the actor sidebar to the video catalogue.

   4. Connect video deletion to actor-sidebar refreshing.

   5. Connect successful Add Video operations to catalogue/sidebar
      refreshing.

   6. Perform the initial actor and video catalogue loads.

   7. Initialise video playback controls.

   8. Manage the header dropdown menu.

   9. Sign the user out and return them to the login page.


   MODULE RELATIONSHIPS
   --------------------

   actors.js
       Manages actor filtering and the actor sidebar.

       When an actor is selected:

           loadZuluVideos()

       is called so the catalogue reflects the selected actor.


   catalogue.js
       Loads, searches, sorts and renders videos.

       When a video is deleted:

           loadActorSidebar()

       is called so actor counts remain accurate.


   add-video.js
       Handles video ingestion.

       When a new video is successfully added:

           loadActorSidebar()
           loadZuluVideos()

       are both called.


   playback.js
       Handles signed media URLs, the video modal and view logging.


   supabaseClient.js
       Provides the shared Supabase client used for authentication.


   APPLICATION FLOW
   ----------------

       DOM ready
           ↓
       Check Supabase session
           ↓
       No session ─────────────→ index.html
           ↓
       Session exists
           ↓
       Connect module callbacks
           ↓
       Load actor sidebar
           ↓
       Load video catalogue
           ↓
       Attach playback events
           ↓
       Application ready

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
===================================================================== */

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


/* =====================================================================
   02. APPLICATION INITIALISATION
   =====================================================================

   Wait until the document has loaded before:

       - checking authentication;
       - wiring modules together;
       - loading catalogue data.
===================================================================== */

document.addEventListener(
  "DOMContentLoaded",
  initialiseApplication
);


/**
 * Initialises the authenticated Zulu Videos application.
 *
 * Authentication is checked before catalogue data is loaded or feature
 * modules are connected.
 *
 * If Supabase cannot confirm a valid session, the visitor is redirected
 * to index.html.
 */
async function initialiseApplication() {

  /* -----------------------------------------------------------------
     CHECK AUTHENTICATION
  ----------------------------------------------------------------- */

  const {
    data: {
      session
    },
    error
  } =
    await supabase.auth
      .getSession();


  /*
   * If Supabase itself cannot perform the session check, do not allow
   * the protected catalogue to continue initialising.
   */
  if (error) {

    console.error(
      "Session check failed:",
      error
    );


    redirectToLogin();

    return;
  }


  /*
   * A successful session lookup can still return no active session.
   */
  if (!session) {

    redirectToLogin();

    return;
  }


  /* -----------------------------------------------------------------
     CONNECT FEATURE MODULES
  ----------------------------------------------------------------- */

  attachApplicationEvents();


  /* -----------------------------------------------------------------
     INITIAL DATA LOAD
  -----------------------------------------------------------------

     Load the actor sidebar first, followed by the catalogue.

     This preserves the existing startup sequence.
  ----------------------------------------------------------------- */

  await loadActorSidebar();

  await loadZuluVideos();


  /* -----------------------------------------------------------------
     INITIALISE PLAYBACK
  ----------------------------------------------------------------- */

  attachPlaybackEvents();
}


/* =====================================================================
   03. MODULE WIRING
   =====================================================================

   The feature modules deliberately remain relatively independent.

   This controller connects them using callbacks rather than having
   each module directly manage unrelated parts of the application.
===================================================================== */

/**
 * Connects callbacks between the main Zulu feature modules.
 */
function attachApplicationEvents() {

  /* -----------------------------------------------------------------
     ACTOR SELECTION → RELOAD CATALOGUE
  -----------------------------------------------------------------

     actors.js updates the selected actor state.

     Once that happens, catalogue.js reloads the video list using the
     currently selected actor.
  ----------------------------------------------------------------- */

  attachActorEvents({
    onSelected:
      loadZuluVideos
  });


  /* -----------------------------------------------------------------
     VIDEO DELETED → RELOAD ACTOR SIDEBAR
  -----------------------------------------------------------------

     catalogue.js already reloads its own video list after a successful
     deletion.

     The callback supplied here refreshes the actor sidebar so actor
     counts and actor availability also reflect the deletion.
  ----------------------------------------------------------------- */

  attachCatalogueEvents({
    onDeleted:
      loadActorSidebar
  });


  /* -----------------------------------------------------------------
     VIDEO ADDED → RELOAD SIDEBAR + CATALOGUE
  -----------------------------------------------------------------

     A successful ingestion can affect:

         - the list of actors;
         - actor video counts;
         - the visible catalogue.

     Refresh both.
  ----------------------------------------------------------------- */

  attachAddVideoEvents({
    onAdded:
      async () => {

        await loadActorSidebar();

        await loadZuluVideos();
      }
  });
}


/* =====================================================================
   04. HEADER MENU
===================================================================== */

/**
 * Opens the header dropdown menu and updates its accessibility state.
 */
function openHeaderMenu() {

  if (!headerMenu) {
    return;
  }


  headerMenu.hidden =
    false;


  headerMenuButton?.setAttribute(
    "aria-expanded",
    "true"
  );
}


/**
 * Closes the header dropdown menu and updates its accessibility state.
 *
 * Safe to call even if the menu is already closed.
 */
function closeHeaderMenu() {

  if (!headerMenu) {
    return;
  }


  headerMenu.hidden =
    true;


  headerMenuButton?.setAttribute(
    "aria-expanded",
    "false"
  );
}


/**
 * Toggles the header dropdown menu between open and closed.
 */
function toggleHeaderMenu() {

  if (!headerMenu) {
    return;
  }


  if (headerMenu.hidden) {

    openHeaderMenu();

  } else {

    closeHeaderMenu();
  }
}


/* ---------------------------------------------------------------------
   HEADER MENU BUTTON
------------------------------------------------------------------------

   Stop propagation so the same click does not immediately reach the
   document-level listener and close the menu again.
------------------------------------------------------------------------ */

headerMenuButton?.addEventListener(
  "click",
  event => {

    event.stopPropagation();

    toggleHeaderMenu();
  }
);


/* ---------------------------------------------------------------------
   CLICKS INSIDE MENU
------------------------------------------------------------------------

   Prevent clicks on the menu itself from reaching the document-level
   close handler.
------------------------------------------------------------------------ */

headerMenu?.addEventListener(
  "click",
  event => {

    event.stopPropagation();
  }
);


/* ---------------------------------------------------------------------
   CLICK OUTSIDE MENU
------------------------------------------------------------------------

   Any click reaching the document closes the menu.
------------------------------------------------------------------------ */

document.addEventListener(
  "click",
  () => {

    closeHeaderMenu();
  }
);


/* ---------------------------------------------------------------------
   ESCAPE KEY
------------------------------------------------------------------------

   Escape closes the header menu.

   Calling closeHeaderMenu() while the menu is already closed is safe.
------------------------------------------------------------------------ */

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Escape"
    ) {

      closeHeaderMenu();
    }
  }
);


/* =====================================================================
   05. LOGOUT
===================================================================== */

/**
 * Signs the current user out of Supabase Auth.
 *
 * The visitor is returned to index.html after the sign-out attempt.
 *
 * This preserves the existing behaviour: even if signOut() reports an
 * error, the browser still leaves the catalogue page.
 */
logoutButton?.addEventListener(
  "click",
  async () => {

    const {
      error
    } =
      await supabase.auth
        .signOut();


    if (error) {

      console.error(
        "Logout error:",
        error
      );
    }


    redirectToLogin();
  }
);


/* =====================================================================
   06. NAVIGATION HELPERS
===================================================================== */

/**
 * Returns the browser to the site's login/landing page.
 *
 * replace() is used rather than assigning location.href so the current
 * protected catalogue page does not remain as the immediately previous
 * browser-history entry.
 */
function redirectToLogin() {

  window.location.replace(
    "index.html"
  );
}
