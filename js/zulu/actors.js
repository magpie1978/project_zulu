import { supabase } from "../supabaseClient.js";


const actorList =
  document.getElementById(
    "actor-sidebar-list"
  );

const actorSort =
  document.getElementById(
    "actor-sort"
  );


let actorSidebarData = [];
let totalVideoCount = 0;
let onActorSelected = null;


/* =================================================================================================================
   INITIALISATION
==================================================================================================================== */

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
      preserveSidebarScroll(
        () => renderActorSidebar()
      );
    }
  );
}


/* =================================================================================================================
   LOAD ACTOR SIDEBAR
==================================================================================================================== */

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

    console.log(
      "ACTOR DEBUG:",
      {
        rowCount:
          rows.length,

        firstFiveRows:
          rows.slice(0, 5)
      }
    );

    const actorCounts =
      new Map();

    const uniqueVideoIds =
      new Set();

    rows.forEach(
      ({
        uid,
        actor
      }) => {
        if (!uid) {
          return;
        }

        uniqueVideoIds.add(
          String(uid)
        );

        if (!actor) {
          return;
        }

        if (
          !actorCounts.has(actor)
        ) {
          actorCounts.set(
            actor,
            new Set()
          );
        }

        actorCounts
          .get(actor)
          .add(
            String(uid)
          );
      }
    );

    totalVideoCount =
      uniqueVideoIds.size;

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


/* =================================================================================================================
   RENDER ACTOR SIDEBAR
==================================================================================================================== */

function renderActorSidebar() {
  if (!actorList) {
    return;
  }

  actorList.innerHTML = "";

  const sortedActors =
    sortActors(
      actorSidebarData
    );

  actorList.appendChild(
    createAllVideosLink()
  );

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


/* =================================================================================================================
   SIDEBAR LINKS
==================================================================================================================== */

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

      history.pushState(
        {},
        "",
        "index.html"
      );

      renderActorSidebar();

      if (onActorSelected) {
        await onActorSelected();
      }

      scrollVideosToTop();
    }
  );

  return link;
}


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

  const nameSpan =
    document.createElement(
      "span"
    );

  nameSpan.className =
    "actor-name";

  nameSpan.textContent =
    actor;

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

      history.pushState(
        {},
        "",
        `index.html?actor=${encodeURIComponent(actor)}`
      );

      renderActorSidebar();

      if (onActorSelected) {
        await onActorSelected();
      }

      scrollVideosToTop();
    }
  );

  return link;
}


/* =================================================================================================================
   SELECTED ACTOR
==================================================================================================================== */

export function getSelectedActor() {
  return new URLSearchParams(
    window.location.search
  ).get("actor");
}


/* =================================================================================================================
   SCROLL HELPERS
==================================================================================================================== */

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


function scrollVideosToTop() {
  const mainContent =
    document.querySelector(
      ".main-content"
    );

  if (mainContent) {
    mainContent.scrollTop = 0;
  }

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


/* =================================================================================================================
   DATA HELPER
==================================================================================================================== */

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

    allRows =
      allRows.concat(
        data || []
      );

    if (
      !data ||
      data.length <
        batchSize
    ) {
      break;
    }

    from +=
      batchSize;
  }

  return allRows;
}
