import { supabase } from "./supabaseClient.js";


/* =====================================================================
   LOGIN.JS
   =====================================================================

   PURPOSE
   -------

   Handles authentication for the Zulu Videos / Pornflix login page.

   Responsibilities:

       1. Listen for submission of the login form.
       2. Read the supplied email address and password.
       3. Authenticate the credentials using Supabase Auth.
       4. Display a generic error message if authentication fails.
       5. Redirect authenticated users to:

              pornflix.html


   AUTHENTICATION
   --------------

   Login is performed using:

       supabase.auth.signInWithPassword()

   Supabase manages the authenticated session after a successful login.

   zulu-main.js checks for that session when pornflix.html loads and
   redirects unauthenticated visitors back to the login page.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
===================================================================== */

const loginForm =
  document.getElementById(
    "loginForm"
  );

const errorBox =
  document.getElementById(
    "error"
  );


/* =====================================================================
   02. LOGIN FORM
===================================================================== */

/**
 * Handles submission of the login form.
 *
 * Workflow:
 *
 *     Prevent normal form submission
 *             ↓
 *     Clear previous error
 *             ↓
 *     Read email + password
 *             ↓
 *     Authenticate with Supabase
 *             ↓
 *       ┌──── failure ────→ display login error
 *       │
 *       └──── success ────→ pornflix.html
 */
loginForm?.addEventListener(
  "submit",
  async event => {

    /* -----------------------------------------------------------------
       PREVENT NORMAL FORM SUBMISSION
    ----------------------------------------------------------------- */

    event.preventDefault();


    /* -----------------------------------------------------------------
       CLEAR PREVIOUS ERROR
    ----------------------------------------------------------------- */

    if (errorBox) {

      errorBox.textContent =
        "";
    }


    /* -----------------------------------------------------------------
       READ LOGIN CREDENTIALS
    ----------------------------------------------------------------- */

    const email =
      document
        .getElementById(
          "email"
        )
        ?.value
        .trim() ||
      "";


    const password =
      document
        .getElementById(
          "password"
        )
        ?.value ||
      "";


    /* -----------------------------------------------------------------
       AUTHENTICATE WITH SUPABASE
    ----------------------------------------------------------------- */

    const {
      data,
      error
    } =
      await supabase.auth
        .signInWithPassword({
          email,
          password
        });


    /* -----------------------------------------------------------------
       LOGIN FAILED
    -----------------------------------------------------------------

       Keep the message deliberately generic.

       It should not reveal whether:

           - the email address exists;
           - the password alone was incorrect.
    ----------------------------------------------------------------- */

    if (error) {

      console.error(
        "Login error:",
        error
      );


      if (errorBox) {

        errorBox.textContent =
          "Incorrect email address or password.";
      }


      return;
    }


    /* -----------------------------------------------------------------
       LOGIN SUCCESSFUL
    ----------------------------------------------------------------- */

    if (
      data.session
    ) {

      window.location.href =
        "pornflix.html";
    }
  }
);
