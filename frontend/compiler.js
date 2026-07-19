const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000"
    : "https://YOUR-BACKEND-URL.onrender.com"; // <-- replace after deploying backend on Render

// ---------- Auth guard ----------
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

const codeEditor = document.getElementById("codeEditor");
const codeLangSelect = document.getElementById("codeLangSelect");
const stdinInput = document.getElementById("stdinInput");
const runCodeBtn = document.getElementById("runCodeBtn");
const codeOutput = document.getElementById("codeOutput");
const outputStatus = document.getElementById("outputStatus");
const outputMeta = document.getElementById("outputMeta");
const outputStdout = document.getElementById("outputStdout");
const outputStderr = document.getElementById("outputStderr");
const errorBox = document.getElementById("errorBox");

function showError(msg) {
  errorBox.textContent = "! " + msg;
  errorBox.classList.remove("hidden");
}
function hideError() { errorBox.classList.add("hidden"); }

async function callApi(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    localStorage.removeItem("dsa_token");
    window.location.href = "login.html";
    return;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

runCodeBtn.addEventListener("click", runCode);
codeEditor.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) runCode();
});

async function runCode() {
  const code = codeEditor.value;
  if (!code.trim()) return;

  hideError();
  runCodeBtn.disabled = true;
  const originalLabel = runCodeBtn.querySelector(".btn-run-text").textContent;
  runCodeBtn.querySelector(".btn-run-text").textContent = "running...";

  try {
    const result = await callApi("/api/run-code", {
      code,
      language: codeLangSelect.value,
      stdin: stdinInput.value,
    });
    renderCodeOutput(result);
  } catch (err) {
    showError(err.message);
  } finally {
    runCodeBtn.disabled = false;
    runCodeBtn.querySelector(".btn-run-text").textContent = originalLabel;
  }
}

function renderCodeOutput(result) {
  codeOutput.classList.remove("hidden");

  const hasError = result.exit_code !== 0 || result.stderr || result.compile_output;
  outputStatus.textContent = hasError ? "✗ ERROR" : "✓ RAN SUCCESSFULLY";
  outputStatus.className = "output-status " + (hasError ? "fail" : "success");
  outputMeta.textContent = `${result.language} ${result.version}`;

  outputStdout.textContent = result.stdout || "(no output)";

  const errorText = result.compile_output || result.stderr || "";
  if (errorText.trim()) {
    outputStderr.textContent = errorText;
    outputStderr.classList.remove("hidden");
  } else {
    outputStderr.classList.add("hidden");
  }

  codeOutput.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
