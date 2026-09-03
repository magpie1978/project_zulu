////////////////////////////////////////////
//////////   OLD LOGON SCRIPT //////////////
////////////////////////////////////////////

//import { supabase } from "./supabaseClient.js";

//const loginForm = document.getElementById("loginForm");
//const errorBox = document.getElementById("error");

//loginForm?.addEventListener("submit", async event => {
//  event.preventDefault();

//  errorBox.textContent = "";

//  const username = document.getElementById("username").value.trim();
//  const password = document.getElementById("password").value;

//  const { data, error } = await supabase.rpc("check_zulu_login", {
//    input_username: username,
//    input_password: password
//  });

//  if (error) {
//    console.error("Login error:", error);
//    errorBox.textContent = "Login failed. Please try again.";
//    return;
//  }

//  if (data === true) {
//    sessionStorage.setItem("loggedIn", "true");
//    window.location.href = "pornflix.html";
//  } else {
//    errorBox.textContent = "Incorrect username or password.";
//  }
//});


////////////////////////////////////////////
//////////   NEW LOGON SCRIPT //////////////
////////////////////////////////////////////

import { supabase } from "./supabaseClient.js";

const loginForm = document.getElementById("loginForm");
const errorBox = document.getElementById("error");

loginForm?.addEventListener("submit", async event => {
  event.preventDefault();

  errorBox.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error("Login error:", error);
    errorBox.textContent = "Incorrect email address or password.";
    return;
  }

  if (data.session) {
    window.location.href = "pornflix.html";
  }
});
