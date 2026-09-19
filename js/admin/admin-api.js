/* =====================================================================
   ADMIN-API.JS
   =====================================================================

   PURPOSE
   -------

   Centralises protected Admin API / Edge Function requests used by the
   PornFlix Admin dashboard.

   This module is responsible only for requesting and validating data.

   It does NOT:

       • render Admin UI
       • manage authentication redirects
       • coordinate dashboard refreshes
       • manipulate DOM elements

   Keeping API access separate from rendering makes the Admin controller
   smaller and provides a single location for future protected Admin
   requests.

   ===================================================================== */


import {
  supabase
} from "../supabaseClient.js";


/* =====================================================================
   01. ADMIN DASHBOARD
===================================================================== */

/**
 * Retrieves the primary Admin dashboard snapshot from the protected
 * zulu-admin-dashboard Edge Function.
 *
 * Expected response:
 *
 * {
 *   success: true,
 *   library: {...},
 *   health: {...},
 *   integrity: {...},
 *   recent_ingestions: [...],
 *   generated_at: "..."
 * }
 */
async function loadAdminDashboard() {

  const {
    data,
    error
  } =
    await supabase.functions.invoke(
      "zulu-admin-dashboard",
      {
        body: {}
      }
    );


  if (
    error
  ) {

    throw new Error(
      `Could not load Admin dashboard: ${
        error.message ||
        "Edge Function request failed"
      }`
    );
  }


  if (
    !data
  ) {

    throw new Error(
      "The Admin dashboard returned no data."
    );
  }


  if (
    data.success !== true
  ) {

    throw new Error(
      data.error ||
      "The Admin dashboard request was unsuccessful."
    );
  }


  if (
    !data.library ||
    !data.health ||
    !data.integrity
  ) {

    throw new Error(
      "The Admin dashboard returned an invalid response."
    );
  }


  return data;
}


/* =====================================================================
   02. PUBLIC API
===================================================================== */

export {
  loadAdminDashboard
};


/* =====================================================================
   END OF ADMIN-API.JS
===================================================================== */
