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
