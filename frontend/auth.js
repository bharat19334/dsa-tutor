const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000"
    : "https://YOUR-BACKEND-URL.onrender.com"; // <-- replace after deploying backend on Render

const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authError = document.getElementById("authError");

// If already logged in, skip straight to the app
if (localStorage.getItem("dsa_token")) {
  window.location.href = "dashboard.html";
}

tabLogin.addEventListener("click", () => switchTab("login"));
tabSignup.addEventListener("click", () => switchTab("signup"));

// Open straight to the signup tab if linked here with #signup (e.g. from the landing page)
if (window.location.hash === "#signup") {
  switchTab("signup");
}

function switchTab(which) {
  hideError();
  if (which === "login") {
    tabLogin.classList.add("active");
    tabSignup.classList.remove("active");
    loginForm.classList.remove("hidden");
    signupForm.classList.add("hidden");
  } else {
    tabSignup.classList.add("active");
    tabLogin.classList.remove("active");
    signupForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
  }
}

function showError(msg) {
  authError.textContent = "! " + msg;
  authError.classList.remove("hidden");
}
function hideError() { authError.classList.add("hidden"); }

async function authRequest(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Something went wrong");
  return data;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  try {
    const data = await authRequest("/api/auth/login", { email, password });
    saveSessionAndRedirect(data);
  } catch (err) {
    showError(err.message);
  }
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  try {
    const data = await authRequest("/api/auth/signup", { name, email, password });
    saveSessionAndRedirect(data);
  } catch (err) {
    showError(err.message);
  }
});

function saveSessionAndRedirect(data) {
  localStorage.setItem("dsa_token", data.access_token);
  localStorage.setItem("dsa_user_name", data.name);
  localStorage.setItem("dsa_user_email", data.email);
  window.location.href = "dashboard.html";
}
