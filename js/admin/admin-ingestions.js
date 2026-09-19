/* =====================================================================
   ADMIN-INGESTIONS.JS
   =====================================================================

   PURPOSE
   -------

   Handles the Recent Ingestions section of the PornFlix Admin dashboard.

   This module owns:

       • recent ingestion table rendering
       • expandable ingestion diagnostic rows
       • Video / Catalogue / Thumbnail component states
       • ingestion status badges
       • ingestion detail rendering
       • ingestion-table error rendering

   It does NOT retrieve the dashboard data itself.

   The parent admin.js controller supplies the recent_ingestions array
   returned by zulu-admin-dashboard.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
===================================================================== */

const adminIngestionsBody =
  document.getElementById(
    "admin-ingestions-body"
  );


/* =====================================================================
   02. RECENT INGESTIONS
===================================================================== */

/**
 * Renders the recent ingestion table.
 */
function renderRecentIngestions(
  ingestions
) {

  if (
    !adminIngestionsBody
  ) {

    return;
  }


  if (
    !Array.isArray(
      ingestions
    ) ||
    !ingestions.length
  ) {

    adminIngestionsBody.innerHTML = `
      <tr>

        <td
          colspan="7"
          class="admin-empty"
        >
          No ingestion records found.
        </td>

      </tr>
    `;


    return;
  }


  const html =
    ingestions
      .map(
        (
          ingestion,
          index
        ) => {

          const rowId =
            `admin-ingestion-detail-${index}`;


          return (
            createIngestionRow(
              ingestion,
              rowId
            ) +

            createIngestionDetailRow(
              ingestion,
              rowId
            )
          );
        }
      )
      .join(
        ""
      );


  adminIngestionsBody.innerHTML =
    html;


  adminIngestionsBody
    .querySelectorAll(
      ".admin-ingestion-toggle"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            toggleIngestionDetails(
              button
            )
        );
      }
    );


  window.lucide?.createIcons();
}


/**
 * Creates the visible summary row for one ingestion.
 */
function createIngestionRow(
  ingestion,
  rowId
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  const videoState =
    getVideoState(
      ingestion
    );


  const catalogueState =
    getCatalogueState(
      ingestion
    );


  const thumbnailState =
    getThumbnailState(
      ingestion
    );


  const createdAt =
    formatDateTime(
      ingestion.created_at
    );


  const filename =
    ingestion.canonical_filename ||
    ingestion.original_filename ||
    "—";


  const film =
    ingestion.film ||
    stripMp4Extension(
      filename
    ) ||
    "—";


  return `
    <tr>

      <td>

        <button
          type="button"
          class="admin-ingestion-toggle"
          data-target="${escapeHtml(
            rowId
          )}"
          aria-expanded="false"
          aria-label="Show ingestion details"
        >

          <i
            data-lucide="chevron-right"
            class="admin-ingestion-toggle-icon"
          ></i>

        </button>

      </td>


      <td>

        <strong>
          ${escapeHtml(
            film
          )}
        </strong>

        <div class="admin-ingestion-file">
          ${escapeHtml(
            filename
          )}
        </div>

      </td>


      <td>
        ${renderStatusBadge(
          status
        )}
      </td>


      <td>
        ${renderState(
          videoState
        )}
      </td>


      <td>
        ${renderState(
          catalogueState
        )}
      </td>


      <td>
        ${renderState(
          thumbnailState
        )}
      </td>


      <td>
        ${escapeHtml(
          createdAt
        )}
      </td>

    </tr>
  `;
}


/**
 * Creates the expandable diagnostic row for one ingestion.
 */
function createIngestionDetailRow(
  ingestion,
  rowId
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  const failedStage =
    ingestion.failed_stage ||
    "—";


  const errorMessage =
    ingestion.error_message ||
    "—";


  const publicUrl =
    ingestion.public_url ||
    "—";


  const backblazeFileId =
    ingestion.backblaze_file_id ||
    "—";


  const videoUid =
    ingestion.video_uid ??
    "—";


  const thumbnailStatus =
    ingestion.thumbnail_status ||
    "—";


  const filesize =
    formatBytes(
      ingestion.filesize_bytes
    );


  const createdAt =
    formatDateTime(
      ingestion.created_at
    );


  const updatedAt =
    formatDateTime(
      ingestion.updated_at
    );


  const completedAt =
    formatDateTime(
      ingestion.completed_at
    );


  const videoUploadedAt =
    formatDateTime(
      ingestion.video_uploaded_at
    );


  const cataloguedAt =
    formatDateTime(
      ingestion.catalogued_at
    );


  const thumbnailUploadedAt =
    formatDateTime(
      ingestion.thumbnail_uploaded_at
    );


  const fingerprint =
    ingestion.fingerprint ||
    "—";


  return `
    <tr
      id="${escapeHtml(
        rowId
      )}"
      class="admin-ingestion-detail-row"
      hidden
    >

      <td colspan="7">

        <div class="admin-ingestion-detail">

          <div class="admin-ingestion-detail-grid">

            ${detailItem(
              "Status",
              humaniseStatus(
                status
              )
            )}

            ${detailItem(
              "Video UID",
              videoUid
            )}

            ${detailItem(
              "Filesize",
              filesize
            )}

            ${detailItem(
              "Thumbnail status",
              humaniseStatus(
                thumbnailStatus
              )
            )}

            ${detailItem(
              "Failed stage",
              humaniseStatus(
                failedStage
              )
            )}

            ${detailItem(
              "Created",
              createdAt
            )}

            ${detailItem(
              "Updated",
              updatedAt
            )}

            ${detailItem(
              "Video uploaded",
              videoUploadedAt
            )}

            ${detailItem(
              "Catalogued",
              cataloguedAt
            )}

            ${detailItem(
              "Thumbnail uploaded",
              thumbnailUploadedAt
            )}

            ${detailItem(
              "Completed",
              completedAt
            )}

          </div>


          <div class="admin-ingestion-detail-block">

            <strong>
              Fingerprint
            </strong>

            <code>
              ${escapeHtml(
                fingerprint
              )}
            </code>

          </div>


          <div class="admin-ingestion-detail-block">

            <strong>
              Backblaze file ID
            </strong>

            <code>
              ${escapeHtml(
                backblazeFileId
              )}
            </code>

          </div>


          <div class="admin-ingestion-detail-block">

            <strong>
              Public URL
            </strong>

            <code>
              ${escapeHtml(
                publicUrl
              )}
            </code>

          </div>


          ${
            errorMessage !==
              "—"
              ? `
                <div
                  class="
                    admin-ingestion-detail-block
                    admin-ingestion-error
                  "
                >

                  <strong>
                    Error
                  </strong>

                  <div>
                    ${escapeHtml(
                      errorMessage
                    )}
                  </div>

                </div>
              `
              : ""
          }

        </div>

      </td>

    </tr>
  `;
}


/* =====================================================================
   03. INGESTION DETAILS TOGGLE
===================================================================== */

function toggleIngestionDetails(
  button
) {

  const targetId =
    button.dataset
      .target;


  if (
    !targetId
  ) {

    return;
  }


  const row =
    document.getElementById(
      targetId
    );


  if (
    !row
  ) {

    return;
  }


  const isOpen =
    !row.hidden;


  row.hidden =
    isOpen;


  button.setAttribute(
    "aria-expanded",
    String(
      !isOpen
    )
  );


  const icon =
    button.querySelector(
      ".admin-ingestion-toggle-icon"
    );


  if (
    icon
  ) {

    icon.setAttribute(
      "data-lucide",
      isOpen
        ? "chevron-right"
        : "chevron-down"
    );
  }


  window.lucide?.createIcons();
}


/* =====================================================================
   04. INGESTION COMPONENT STATES
===================================================================== */

/**
 * Returns the video-storage state for an ingestion.
 */
function getVideoState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  if (
    ingestion.video_uploaded_at ||
    ingestion.backblaze_file_id ||
    ingestion.public_url
  ) {

    return {
      label:
        "Uploaded",

      state:
        "success"
    };
  }


  if (
    status ===
      "failed" &&
    [
      "uploading",
      "video_upload"
    ].includes(
      normaliseStatus(
        ingestion.failed_stage
      )
    )
  ) {

    return {
      label:
        "Failed",

      state:
        "error"
    };
  }


  if (
    [
      "cancelled",
      "duplicate"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Not uploaded",

      state:
        "muted"
    };
  }


  if (
    [
      "pending",
      "analysing",
      "ready"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Waiting",

      state:
        "muted"
    };
  }


  if (
    status ===
      "uploading"
  ) {

    return {
      label:
        "Uploading",

      state:
        "warning"
    };
  }


  return {
    label:
      "Missing",

    state:
      "warning"
  };
}


/**
 * Returns the catalogue state for an ingestion.
 */
function getCatalogueState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  if (
    ingestion.catalogued_at ||
    ingestion.video_uid
  ) {

    return {
      label:
        "Catalogued",

      state:
        "success"
    };
  }


  if (
    status ===
      "failed" &&
    [
      "cataloguing",
      "catalogue",
      "finalize"
    ].includes(
      normaliseStatus(
        ingestion.failed_stage
      )
    )
  ) {

    return {
      label:
        "Failed",

      state:
        "error"
    };
  }


  if (
    [
      "pending",
      "analysing",
      "ready",
      "uploading",
      "video_uploaded"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Waiting",

      state:
        "muted"
    };
  }


  if (
    status ===
      "cataloguing"
  ) {

    return {
      label:
        "Cataloguing",

      state:
        "warning"
    };
  }


  if (
    [
      "cancelled",
      "duplicate"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Not catalogued",

      state:
        "muted"
    };
  }


  return {
    label:
      "Missing",

    state:
      "warning"
  };
}

/**
 * Returns the thumbnail state for an ingestion.
 */
function getThumbnailState(
  ingestion
) {

  const status =
    normaliseStatus(
      ingestion.status
    );


  const thumbnailStatus =
    normaliseStatus(
      ingestion.thumbnail_status
    );


  if (
    ingestion.thumbnail_uploaded_at ||
    thumbnailStatus ===
      "uploaded" ||
    thumbnailStatus ===
      "complete"
  ) {

    return {
      label:
        "Uploaded",

      state:
        "success"
    };
  }


  if (
    status ===
      "complete_without_thumbnail"
  ) {

    return {
      label:
        "Missing",

      state:
        "warning"
    };
  }


  if (
    status ===
      "failed" &&
    [
      "thumbnail_upload",
      "thumbnail_uploading",
      "thumbnail"
    ].includes(
      normaliseStatus(
        ingestion.failed_stage
      )
    )
  ) {

    return {
      label:
        "Failed",

      state:
        "error"
    };
  }


  if (
    [
      "pending",
      "analysing",
      "ready",
      "uploading",
      "video_uploaded",
      "cataloguing",
      "catalogued"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Waiting",

      state:
        "muted"
    };
  }


  if (
    status ===
      "thumbnail_uploading"
  ) {

    return {
      label:
        "Uploading",

      state:
        "warning"
    };
  }


  if (
    [
      "cancelled",
      "duplicate"
    ].includes(
      status
    )
  ) {

    return {
      label:
        "Not uploaded",

      state:
        "muted"
    };
  }


  if (
    status ===
      "complete"
  ) {

    return {
      label:
        "Uploaded",

      state:
        "success"
    };
  }


  return {
    label:
      "Missing",

    state:
      "warning"
  };
}


/* =====================================================================
   05. STATUS BADGES
===================================================================== */

/**
 * Creates the main ingestion status badge.
 */
function renderStatusBadge(
  status
) {

  const config =
    getStatusConfig(
      status
    );


  return `
    <span
      class="
        admin-status-badge
        ${escapeHtml(
          config.className
        )}
      "
    >
      ${escapeHtml(
        config.label
      )}
    </span>
  `;
}


/**
 * Maps ingestion statuses to display labels and CSS classes.
 */
function getStatusConfig(
  status
) {

  switch (
    status
  ) {

    case "complete":

      return {
        label:
          "Complete",

        className:
          "admin-status-complete"
      };


    case "complete_without_thumbnail":

      return {
        label:
          "No Thumbnail",

        className:
          "admin-status-warning"
      };


    case "failed":

      return {
        label:
          "Failed",

        className:
          "admin-status-failed"
      };


    case "cancelled":

      return {
        label:
          "Cancelled",

        className:
          "admin-status-cancelled"
      };


    case "duplicate":

      return {
        label:
          "Duplicate",

        className:
          "admin-status-duplicate"
      };


    case "pending":

      return {
        label:
          "Pending",

        className:
          "admin-status-pending"
      };


    case "analysing":

      return {
        label:
          "Analysing",

        className:
          "admin-status-active"
      };


    case "ready":

      return {
        label:
          "Ready",

        className:
          "admin-status-active"
      };


    case "uploading":

      return {
        label:
          "Uploading",

        className:
          "admin-status-active"
      };


    case "video_uploaded":

      return {
        label:
          "Video Uploaded",

        className:
          "admin-status-active"
      };


    case "cataloguing":

      return {
        label:
          "Cataloguing",

        className:
          "admin-status-active"
      };


    case "catalogued":

      return {
        label:
          "Catalogued",

        className:
          "admin-status-active"
      };


    case "thumbnail_uploading":

      return {
        label:
          "Thumbnail Upload",

        className:
          "admin-status-active"
      };


    default:

      return {
        label:
          humaniseStatus(
            status ||
            "unknown"
          ),

        className:
          "admin-status-pending"
      };
  }
}


/* =====================================================================
   06. COMPONENT STATE RENDERING
===================================================================== */

/**
 * Renders the small Video / Catalogue / Thumbnail state labels.
 */
function renderState(
  state
) {

  return `
    <span
      class="
        admin-state
        admin-state-${escapeHtml(
          state.state
        )}
      "
    >
      ${escapeHtml(
        state.label
      )}
    </span>
  `;
}


/* =====================================================================
   07. DETAIL ITEMS
===================================================================== */

function detailItem(
  label,
  value
) {

  return `
    <div class="admin-detail-item">

      <span>
        ${escapeHtml(
          label
        )}
      </span>

      <strong>
        ${escapeHtml(
          value
        )}
      </strong>

    </div>
  `;
}


/* =====================================================================
   08. TABLE ERROR
===================================================================== */

/**
 * Replaces the Recent Ingestions table with an error message.
 *
 * This remains separate from the main page-status message so a dashboard
 * request failure is also visible in the part of the page that would
 * normally contain ingestion history.
 */
function renderIngestionsError(
  error
) {

  if (
    !adminIngestionsBody
  ) {

    return;
  }


  adminIngestionsBody.innerHTML = `
    <tr>

      <td
        colspan="7"
        class="
          admin-empty
          admin-empty-error
        "
      >
        ${escapeHtml(
          error?.message ||
          "Could not load ingestion history."
        )}
      </td>

    </tr>
  `;
}


/* =====================================================================
   09. STRING NORMALISATION
===================================================================== */

function normaliseStatus(
  value
) {

  return String(
    value ||
    ""
  )
    .trim()
    .toLowerCase();
}


/**
 * Converts:
 *
 *     complete_without_thumbnail
 *
 * into:
 *
 *     Complete Without Thumbnail
 */
function humaniseStatus(
  value
) {

  const text =
    String(
      value ||
      ""
    )
      .trim();


  if (
    !text
  ) {

    return "—";
  }


  return text
    .replace(
      /[_-]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /\b\w/g,
      character =>
        character.toUpperCase()
    );
}


/**
 * Removes the final .mp4 extension from a filename.
 */
function stripMp4Extension(
  value
) {

  return String(
    value ||
    ""
  ).replace(
    /\.mp4$/i,
    ""
  );
}


/* =====================================================================
   10. DATE / TIME FORMATTING
===================================================================== */

function formatDateTime(
  value
) {

  if (
    !value
  ) {

    return "—";
  }


  const date =
    new Date(
      value
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "—";
  }


  return date.toLocaleString(
    [],
    {
      year:
        "numeric",

      month:
        "short",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit",

      second:
        "2-digit"
    }
  );
}


/* =====================================================================
   11. FILESIZE FORMATTING
===================================================================== */

function formatBytes(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return "—";
  }


  const bytes =
    Number(
      value
    );


  if (
    !Number.isFinite(
      bytes
    ) ||
    bytes < 0
  ) {

    return "—";
  }


  if (
    bytes === 0
  ) {

    return "0 B";
  }


  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
    "PB"
  ];


  const unitIndex =
    Math.min(
      Math.floor(
        Math.log(
          bytes
        ) /
        Math.log(
          1024
        )
      ),
      units.length -
      1
    );


  const size =
    bytes /
    Math.pow(
      1024,
      unitIndex
    );


  const decimals =
    unitIndex === 0
      ? 0
      : size >= 100
        ? 0
        : size >= 10
          ? 1
          : 2;


  return `${size.toFixed(
    decimals
  )} ${units[
    unitIndex
  ]}`;
}

/* =====================================================================
   12. HTML ESCAPING
===================================================================== */

/**
 * Escapes arbitrary values before inserting them into innerHTML.
 *
 * Ingestion filenames, film names, fingerprints, Backblaze IDs, URLs and
 * error messages originate outside this JavaScript source, so they must
 * be escaped before being inserted into HTML templates.
 */
function escapeHtml(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";
  }


  return String(
    value
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


/* =====================================================================
   13. PUBLIC API
===================================================================== */

/**
 * The parent Admin controller only needs two entry points:
 *
 *     renderRecentIngestions()
 *     renderIngestionsError()
 *
 * Everything else remains private to this module.
 */
export {
  renderRecentIngestions,
  renderIngestionsError
};


/* =====================================================================
   END OF ADMIN-INGESTIONS.JS
===================================================================== */
