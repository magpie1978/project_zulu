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
       3. Prevent duplicate authentication requests while login is running.
       4. Authenticate the credentials using Supabase Auth.
       5. Display a generic error message if authentication fails.
       6. Recover cleanly from unexpected/network authentication failures.
       7. Redirect authenticated users to:

              pornflix.html


   AUTHENTICATION
   --------------

   Login is performed using:

       supabase.auth.signInWithPassword()

   Supabase manages the authenticated session after a successful login.

   zulu-main.js checks for that session when pornflix.html loads and
   redirects unauthenticated visitors back to the login page.


   LOGIN BUTTON STATE
   ------------------

   While authentication is running, the submit button is:

       - disabled;
       - changed from "Sign In" to "Signing in…".

   This prevents double-clicks or repeated form submissions from creating
   multiple simultaneous authentication requests.

   If authentication fails, the button is restored so the user can try
   again.

   If authentication succeeds, the button deliberately remains disabled
   because the browser immediately navigates to pornflix.html.

   ===================================================================== */


/* =====================================================================
   01. DOM REFERENCES
   =====================================================================

   Cache the elements used by the login workflow.

   The submit button is located within the form rather than relying on a
   separate HTML ID. This keeps login.js compatible with the existing
   login-page markup.
===================================================================== */

const loginForm =
  document.getElementById(
    "loginForm"
  );


const errorBox =
  document.getElementById(
    "error"
  );


const loginButton =
  loginForm?.querySelector(
    'button[type="submit"]'
  );


/* =====================================================================
   02. LOGIN BUTTON STATE
   ===================================================================== */

/**
 * Places the login button into its authentication-in-progress state.
 *
 * The button is disabled immediately before contacting Supabase.
 *
 * This prevents:
 *
 *     - accidental double-clicks;
 *     - repeated Enter-key submissions;
 *     - multiple simultaneous signInWithPassword() requests.
 */
function disableLoginButton() {

  if (!loginButton) {
    return;
  }


  loginButton.disabled =
    true;


  loginButton.textContent =
    "Signing in…";
}


/**
 * Restores the login button after an unsuccessful authentication attempt.
 *
 * This is called when:
 *
 *     - Supabase returns an authentication error;
 *     - the authentication request throws unexpectedly;
 *     - a network/browser problem prevents the request completing;
 *     - Supabase returns successfully but no session is created.
 *
 * It is deliberately NOT called after a successful login because the
 * browser immediately redirects to pornflix.html.
 */
function enableLoginButton() {

  if (!loginButton) {
    return;
  }


  loginButton.disabled =
    false;


  loginButton.textContent =
    "Sign In";
}


/* =====================================================================
   03. LOGIN ERROR DISPLAY
   ===================================================================== */

/**
 * Displays the standard public-facing authentication error.
 *
 * The message is deliberately generic.
 *
 * We do not reveal whether:
 *
 *     - the email address exists;
 *     - the email address was incorrect;
 *     - only the password was incorrect.
 *
 * Keeping these cases indistinguishable avoids exposing information
 * about registered accounts.
 */
function showLoginError() {

  if (!errorBox) {
    return;
  }


  errorBox.textContent =
    "Incorrect email address or password.";
}


/**
 * Displays an error for an unexpected authentication failure.
 *
 * This is intended for failures such as:
 *
 *     - temporary network problems;
 *     - Supabase being unreachable;
 *     - an unexpected JavaScript/runtime error.
 *
 * Unlike a normal authentication rejection, this does not tell the user
 * that their credentials were necessarily incorrect.
 */
function showUnexpectedLoginError() {

  if (!errorBox) {
    return;
  }


  errorBox.textContent =
    "Could not sign in. Please try again.";
}


/* =====================================================================
   04. LOGIN FORM
   ===================================================================== */

/**
 * Handles submission of the login form.
 *
 * Workflow:
 *
 *     Prevent normal form submission
 *             ↓
 *     Disable login button
 *             ↓
 *     Clear previous error
 *             ↓
 *     Read email + password
 *             ↓
 *     Authenticate with Supabase
 *             ↓
 *       ┌──── authentication failure
 *       │          ↓
 *       │     display generic error
 *       │          ↓
 *       │     restore login button
 *       │
 *       ├──── unexpected/network failure
 *       │          ↓
 *       │     display temporary error
 *       │          ↓
 *       │     restore login button
 *       │
 *       └──── success
 *                  ↓
 *             pornflix.html
 *
 * The successful path deliberately leaves the button disabled while
 * navigation takes place.
 */
loginForm?.addEventListener(
  "submit",
  async event => {

    /* -----------------------------------------------------------------
       PREVENT NORMAL FORM SUBMISSION
    -----------------------------------------------------------------

       The form is handled entirely through JavaScript/Supabase rather
       than allowing the browser to perform a conventional form POST.
    ----------------------------------------------------------------- */

    event.preventDefault();


    /* -----------------------------------------------------------------
       PREVENT DUPLICATE LOGIN REQUESTS
    -----------------------------------------------------------------

       Disable the button before doing any asynchronous work.

       This means another click or Enter-key submission cannot start a
       second authentication request while the first one is running.
    ----------------------------------------------------------------- */

    disableLoginButton();


    /* -----------------------------------------------------------------
       CLEAR PREVIOUS ERROR
    -----------------------------------------------------------------

       Remove any message left over from an earlier unsuccessful attempt.
    ----------------------------------------------------------------- */

    if (errorBox) {

      errorBox.textContent =
        "";
    }


    /* -----------------------------------------------------------------
       READ LOGIN CREDENTIALS
    -----------------------------------------------------------------

       Email addresses are trimmed to avoid accidental leading/trailing
       whitespace.

       Passwords are NOT trimmed because spaces may legitimately form
       part of a user's password.
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
    -----------------------------------------------------------------

       The authentication request is wrapped in try/catch.

       Normally Supabase reports invalid credentials through the returned
       "error" value.

       However, the Promise itself could also reject because of:

           - a network failure;
           - an unexpected Supabase/client problem;
           - another browser/runtime exception.

       Without this outer try/catch, such a failure could leave the login
       button permanently disabled on "Signing in…".
    ----------------------------------------------------------------- */

    try {

      const {
        data,
        error
      } =
        await supabase.auth
          .signInWithPassword({
            email,
            password
          });


      /* ---------------------------------------------------------------
         AUTHENTICATION REJECTED
      ---------------------------------------------------------------

         Supabase successfully processed the authentication request but
         rejected the supplied credentials.

         Keep the public-facing message generic and restore the button so
         the user can correct the credentials and try again.
      --------------------------------------------------------------- */

      if (error) {

        console.error(
          "Login error:",
          error
        );


        showLoginError();


        enableLoginButton();


        return;
      }


      /* ---------------------------------------------------------------
         LOGIN SUCCESSFUL
      ---------------------------------------------------------------

         A successful authentication should provide an active Supabase
         session.

         Leave the button disabled while the browser navigates away.
      --------------------------------------------------------------- */

      if (
        data?.session
      ) {

        window.location.href =
          "pornflix.html";


        return;
      }


      /* ---------------------------------------------------------------
         SUCCESS RESPONSE WITHOUT SESSION
      ---------------------------------------------------------------

         This would be unusual for the current email/password login flow,
         but handling it defensively prevents the interface becoming stuck
         if Supabase ever returns without an error and without a session.

         Treat it as an unsuccessful login attempt and restore the UI.
      --------------------------------------------------------------- */

      console.error(
        "Login completed without creating a session:",
        data
      );


      showUnexpectedLoginError();


      enableLoginButton();


    } catch (error) {

      /* ---------------------------------------------------------------
         UNEXPECTED / NETWORK FAILURE
      ---------------------------------------------------------------

         This catches failures where the authentication Promise itself
         rejects rather than Supabase returning a normal "error" value.

         Examples could include:

             - loss of network connectivity;
             - Supabase being temporarily unreachable;
             - an unexpected client/runtime failure.

         Log the detailed error for debugging but display only a simple
         user-facing message.
      --------------------------------------------------------------- */

      console.error(
        "Unexpected login failure:",
        error
      );


      showUnexpectedLoginError();


      /*
       * Authentication did not complete successfully, so restore the
       * button and allow another attempt.
       */
      enableLoginButton();
    }
  }
);
