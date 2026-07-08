const USERNAME = "admin";
const PASSWORD = "pornflix";

document.getElementById("loginForm").addEventListener("submit", e => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    if (username === USERNAME && password === PASSWORD) {
        sessionStorage.setItem("loggedIn", "true");
        window.location.href = "pornflix.html";
    } else {
        document.getElementById("error").textContent =
            "Incorrect username or password.";
    }
});
