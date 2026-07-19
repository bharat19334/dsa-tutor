// Lightweight script for pages that only need the auth guard + sidebar user info,
// not the full dashboard logic (that lives in script.js).

const AUTH_TOKEN = localStorage.getItem("dsa_token");
if (!AUTH_TOKEN) {
  window.location.href = "login.html";
}

const userGreeting = document.getElementById("userGreeting");
const logoutBtn = document.getElementById("logoutBtn");

if (userGreeting) {
  userGreeting.textContent = localStorage.getItem("dsa_user_name") || "";
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("dsa_token");
    localStorage.removeItem("dsa_user_name");
    localStorage.removeItem("dsa_user_email");
    window.location.href = "login.html";
  });
}
