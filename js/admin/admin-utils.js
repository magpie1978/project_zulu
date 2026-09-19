/* =====================================================================
   ADMIN-UTILS.JS
   =====================================================================

   PURPOSE
   -------

   Shared utility helpers used by the PornFlix Admin dashboard.

   This module contains small, reusable helpers that are not tied to a
   specific Admin subsystem.

   It does NOT:

       • retrieve data
       • call Edge Functions
       • manage authentication
       • coordinate dashboard refreshes
       • own subsystem-specific rendering

   ===================================================================== */


/* =====================================================================
   01. NUMBER DISPLAY
===================================================================== */

/**
 * Writes a locale-formatted number into a DOM element.
 *
 * Invalid or non-numeric values are displayed as an em dash.
 */
function setNumber(
  element,
  value
) {

  if (
    !element
  ) {

    return;
  }


  const number =
    Number(
      value
    );


  if (
    !Number.isFinite(
      number
    )
  ) {

    element.textContent =
      "—";


    return;
  }


  element.textContent =
    number.toLocaleString();
}


/* =====================================================================
   02. PUBLIC API
===================================================================== */

export {
  setNumber
};


/* =====================================================================
   END OF ADMIN-UTILS.JS
===================================================================== */
