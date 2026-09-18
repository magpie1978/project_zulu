import { supabase } from "../supabaseClient.js";


/* =====================================================================
   ACTORS.JS
   =====================================================================

   PURPOSE
   -------

   This module manages the actor sidebar on the Zulu Videos catalogue.

   Its responsibilities are:

   1. Load actor/video relationships from Supabase.
   2. Calculate:
      - the total number of unique videos;
      - the number of unique videos associated with each actor.
   3. Store that information locally for rendering.
   4. Sort actors according to the user's selected sort mode.
   5. Render the "All Videos" and individual actor links.
   6. Keep the selected actor in the page URL:
         index.html?actor=Actor%20Name
   7. Notify the main application when the selected actor changes.
   8. Preserve sidebar scroll position when its contents are re-sorted.
   9. Return the video area to the top when changing actor.

   DATA SOURCE
   -----------

   Actor/video relationships are loaded from:

       zulu_videos_with_actors

   Expected fields:

       uid
       actor

   Each UID may appear multiple times because a video can have multiple
   actors. Sets are therefore used when counting videos so that each
   video is counted only once.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
   =====================================================================

   Cache the elements used by this module so that they do not need to
   be repeatedly queried from the DOM.
===================================================================== */

const actorList =
  document.getElementById(
    "actor-sidebar-list"
  );

const actorSort =
  document.getElementById(
    "actor-sort"
  );


/* =====================================================================
   02. MODULE STATE
   =====================================================================

   actorSidebarData
       Cached actor/count objects used when rendering the sidebar.

       Example:
       [
         { actor: "Actor One", videoCount: 12 },
         { actor: "Actor Two", videoCount: 8 }
       ]

   totalVideoCount
       Total number of unique video UIDs represented in the actor view.

   onActorSelected
       Callback supplied by the main application. It is called whenever
       the user changes the actor filter so the video catalogue can be
       refreshed.
===================================================================== */

let actorSidebarData = [];
let totalVideoCount = 0;
let onActorSelected = null;


/* =====================================================================
   03. INITIALISATION
===================================================================== */

/**
 * Connects the actor sidebar to the rest of the application.
 *
 * The optional onSelected callback is stored and later called whenever
 * the user selects an actor or returns to "All Videos".
 *
 * This function also attaches the actor-sort change listener.
 *
 * @param {Object} options
 * @param {Function} [options.onSelected]
 */
export function attachActorEvents({
  onSelected
} = {}) {

  onActorSelected =
    typeof onSelected === "function"
      ? onSelected
      : null;

  actorSort?.addEventListener(
    "change",
    () => {

      /*
       * Sorting causes the sidebar to be rebuilt.
       * Preserve its current scroll position so the user does not jump
       * back to the top every time the sort order changes.
       */
      preserveSidebarScroll(
        () => renderActorSidebar()
      );
    }
  );
}


/* =====================================================================
   04. LOAD ACTOR DATA
===================================================================== */

/**
 * Loads all actor/video relationships from Supabase and builds the
 * local data used by the sidebar.
 *
 * Two calculations are performed:
 *
 *   1. totalVideoCount
 *      Number of unique video UIDs across the entire dataset.
 *
 *   2. actorSidebarData
 *      Number of unique videos associated with each actor.
 *
 * Sets are deliberately used rather than simple counters because the
 * underlying view may contain repeated rows. A UID should only count
 * once for any given actor.
 *
 * Once the data has been prepared, the sidebar is rendered.
 */
export async function loadActorSidebar() {

  if (!actorList) {
    return;
  }

  actorList.innerHTML = "";

  try {

    const rows =
      await fetchAllRows({
        table:
          "zulu_videos_with_actors",

        select:
          "uid, actor",

        orderColumn:
          "actor"
      });


    /*
     * Map structure:
     *
     * actor => Set of video UIDs
     *
     * Example:
     *
     * "Actor One" => Set("1001", "1004", "1020")
     */
    const actorCounts =
      new Map();


    /*
     * Stores every unique video UID found in the dataset.
     * This is used for the "All Videos" count.
     */
    const uniqueVideoIds =
      new Set();


    rows.forEach(
      ({
        uid,
        actor
      }) => {

        /*
         * Rows without a video UID cannot contribute to either
         * the total video count or an actor's video count.
         */
        if (!uid) {
          return;
        }


        /*
         * Add the UID to the global set of videos.
         */
        uniqueVideoIds.add(
          String(uid)
        );


        /*
         * A valid video can theoretically exist without an actor.
         * It still counts towards All Videos, but cannot be added
         * to an actor-specific count.
         */
        if (!actor) {
          return;
        }


        /*
         * Create the actor's UID set the first time we encounter
         * that actor.
         */
        if (
          !actorCounts.has(actor)
        ) {
          actorCounts.set(
            actor,
            new Set()
          );
        }


        /*
         * Add this video to the actor's set.
         * Set automatically prevents duplicate UID counts.
         */
        actorCounts
          .get(actor)
          .add(
            String(uid)
          );
      }
    );


    /*
     * Total number of unique videos.
     */
    totalVideoCount =
      uniqueVideoIds.size;


    /*
     * Convert the Map into the simpler array structure expected
     * by the rendering and sorting functions.
     */
    actorSidebarData =
      Array.from(
        actorCounts.entries()
      ).map(
        ([actor, videos]) => ({
          actor,
          videoCount:
            videos.size
        })
      );


    renderActorSidebar();

  } catch (error) {

    console.error(
      "Error loading actors:",
      error
    );

    actorList.innerHTML =
      `<p class="error">Could not load actors.</p>`;
  }
}


/* =====================================================================
   05. RENDER ACTOR SIDEBAR
===================================================================== */

/**
 * Rebuilds the complete actor sidebar.
 *
 * Rendering order:
 *
 *   1. "All Videos"
 *   2. Actor links in the currently selected sort order
 *
 * The active actor is determined from the URL rather than separate
 * application state.
 */
function renderActorSidebar() {

  if (!actorList) {
    return;
  }

  actorList.innerHTML = "";


  /*
   * Work with a sorted copy of the actor data.
   */
  const sortedActors =
    sortActors(
      actorSidebarData
    );


  /*
   * "All Videos" always appears first regardless of sort mode.
   */
  actorList.appendChild(
    createAllVideosLink()
  );


  /*
   * Add one sidebar link for each actor.
   */
  sortedActors.forEach(
    actorData => {

      actorList.appendChild(
        createActorLink(
          actorData
        )
      );
    }
  );
}


/* =====================================================================
   06. ACTOR SORTING
===================================================================== */

/**
 * Returns a sorted COPY of the supplied actor array.
 *
 * Supported modes:
 *
 *   actor-asc   Actor name A → Z
 *   actor-desc  Actor name Z → A
 *   count-desc  Most videos → fewest videos
 *   count-asc   Fewest videos → most videos
 *
 * Count sorts use actor name as a secondary sort so actors with the
 * same video count remain consistently alphabetical.
 *
 * The original array is not modified.
 *
 * @param {Array} actors
 * @returns {Array}
 */
function sortActors(actors) {

  const sortMode =
    actorSort?.value ||
    "actor-asc";

  return [...actors].sort(
    (a, b) => {

      switch (sortMode) {

        case "actor-desc":
          return b.actor
            .localeCompare(
              a.actor
            );


        case "count-desc":
          return (
            b.videoCount -
              a.videoCount ||
            a.actor.localeCompare(
              b.actor
            )
          );


        case "count-asc":
          return (
            a.videoCount -
              b.videoCount ||
            a.actor.localeCompare(
              b.actor
            )
          );


        case "actor-asc":
        default:
          return a.actor
            .localeCompare(
              b.actor
            );
      }
    }
  );
}


/* =====================================================================
   07. SIDEBAR LINK CREATION
===================================================================== */

/**
 * Creates the "All Videos" link displayed at the top of the sidebar.
 *
 * The link is marked active whenever there is no actor parameter in
 * the current URL.
 *
 * Clicking it:
 *
 *   1. removes the actor query parameter;
 *   2. re-renders the sidebar active state;
 *   3. tells the main application to reload the videos;
 *   4. scrolls the video area back to the top.
 *
 * @returns {HTMLAnchorElement}
 */
function createAllVideosLink() {

  const link =
    document.createElement("a");

  link.href = "#";

  link.className =
    getSelectedActor()
      ? "actor-link"
      : "actor-link active";

  link.textContent =
    `All Videos (${totalVideoCount})`;


  link.addEventListener(
    "click",
    async event => {

      event.preventDefault();


      /*
       * Remove the actor filter from the URL without performing
       * a full page reload.
       */
      history.pushState(
        {},
        "",
        "index.html"
      );


      /*
       * Refresh active sidebar highlighting.
       */
      renderActorSidebar();


      /*
       * Ask the parent application to refresh the video catalogue.
       */
      if (onActorSelected) {
        await onActorSelected();
      }


      scrollVideosToTop();
    }
  );


  return link;
}


/**
 * Creates a sidebar link for an individual actor.
 *
 * The actor's name and unique video count are displayed separately
 * so they can be styled independently.
 *
 * Clicking the link updates the URL to:
 *
 *     index.html?actor=Actor%20Name
 *
 * The main application is then notified so it can display only videos
 * associated with that actor.
 *
 * @param {Object} actorData
 * @param {string} actorData.actor
 * @param {number} actorData.videoCount
 * @returns {HTMLAnchorElement}
 */
function createActorLink({
  actor,
  videoCount
}) {

  const link =
    document.createElement("a");

  const selectedActor =
    getSelectedActor();

  link.href = "#";

  link.className =
    selectedActor === actor
      ? "actor-link active"
      : "actor-link";


  /*
   * Actor name.
   */
  const nameSpan =
    document.createElement(
      "span"
    );

  nameSpan.className =
    "actor-name";

  nameSpan.textContent =
    actor;


  /*
   * Number of unique videos for the actor.
   */
  const countSpan =
    document.createElement(
      "span"
    );

  countSpan.className =
    "actor-count";

  countSpan.textContent =
    ` (${videoCount})`;


  link.appendChild(
    nameSpan
  );

  link.appendChild(
    countSpan
  );


  link.addEventListener(
    "click",
    async event => {

      event.preventDefault();


      /*
       * Store the selected actor in the URL without reloading
       * the page.
       */
      history.pushState(
        {},
        "",
        `index.html?actor=${encodeURIComponent(actor)}`
      );


      /*
       * Immediately update active sidebar highlighting.
       */
      renderActorSidebar();


      /*
       * Ask the parent application to reload/filter the videos.
       */
      if (onActorSelected) {
        await onActorSelected();
      }


      scrollVideosToTop();
    }
  );


  return link;
}


/* =====================================================================
   08. SELECTED ACTOR / URL STATE
===================================================================== */

/**
 * Returns the actor currently selected in the page URL.
 *
 * Example:
 *
 *     index.html?actor=Hugo%20Dupre
 *
 * returns:
 *
 *     "Hugo Dupre"
 *
 * Returns null when no actor filter is present, which represents
 * the "All Videos" state.
 *
 * @returns {string|null}
 */
export function getSelectedActor() {

  return new URLSearchParams(
    window.location.search
  ).get("actor");
}


/* =====================================================================
   09. SCROLL HELPERS
===================================================================== */

/**
 * Executes a callback while preserving the actor sidebar's current
 * vertical scroll position.
 *
 * This is primarily used when changing actor sort order. Rendering
 * clears and rebuilds the sidebar, but the user should remain at the
 * same approximate position rather than jumping back to the top.
 *
 * @param {Function} callback
 */
function preserveSidebarScroll(
  callback
) {

  const sidebar =
    actorList?.parentElement;

  const currentScroll =
    sidebar?.scrollTop || 0;


  callback();


  if (sidebar) {
    sidebar.scrollTop =
      currentScroll;
  }
}


/**
 * Returns the video catalogue to the top after the selected actor
 * changes.
 *
 * The application currently uses an independently scrolling
 * .main-content container, so that element is reset first.
 *
 * The document and window positions are also reset as fallbacks for
 * layouts or browsers where page-level scrolling may still occur.
 */
function scrollVideosToTop() {

  const mainContent =
    document.querySelector(
      ".main-content"
    );


  if (mainContent) {
    mainContent.scrollTop = 0;
  }


  /*
   * Page-level fallbacks.
   */
  document.documentElement.scrollTop =
    0;

  document.body.scrollTop =
    0;

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: "auto"
  });
}


/* =====================================================================
   10. SUPABASE DATA HELPER
===================================================================== */

/**
 * Fetches every row required from a Supabase table/view using batches.
 *
 * Supabase/PostgREST commonly limits individual responses, so this
 * helper requests rows in batches of 1,000 until a batch contains
 * fewer than 1,000 records.
 *
 * This prevents actor counts from silently becoming incomplete when
 * the actor/video relationship dataset grows beyond a single response.
 *
 * @param {Object} options
 * @param {string} options.table
 *        Supabase table or view to query.
 *
 * @param {string} options.select
 *        Columns to return.
 *
 * @param {string} options.orderColumn
 *        Column used to keep pagination deterministic.
 *
 * @returns {Promise<Array>}
 *        Complete combined result set.
 *
 * @throws
 *        Propagates any Supabase query error to the caller.
 */
async function fetchAllRows({
  table,
  select,
  orderColumn
}) {

  const batchSize = 1000;

  let from = 0;
  let allRows = [];


  while (true) {

    const {
      data,
      error
    } =
      await supabase
        .from(table)
        .select(select)
        .order(
          orderColumn,
          {
            ascending: true
          }
        )
        .range(
          from,
          from +
            batchSize -
            1
        );


    if (error) {
      throw error;
    }


    /*
     * Add this batch to everything collected so far.
     */
    allRows =
      allRows.concat(
        data || []
      );


    /*
     * A partial batch means we have reached the final page.
     */
    if (
      !data ||
      data.length <
        batchSize
    ) {
      break;
    }


    /*
     * Advance to the next batch.
     */
    from +=
      batchSize;
  }


  return allRows;
}
