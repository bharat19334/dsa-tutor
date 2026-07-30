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

const codeEditorTextarea = document.getElementById("codeEditor");
const codeLangSelect = document.getElementById("codeLangSelect");
const stdinInput = document.getElementById("stdinInput");
const runCodeBtn = document.getElementById("runCodeBtn");
const codeOutput = document.getElementById("codeOutput");
const outputStatus = document.getElementById("outputStatus");
const outputMeta = document.getElementById("outputMeta");
const outputStdout = document.getElementById("outputStdout");
const outputStderr = document.getElementById("outputStderr");
const errorBox = document.getElementById("errorBox");

// ---------- Editor setup (CodeMirror — VS Code-like editing experience) ----------
const CM_MODE_FOR = {
  Python: "python",
  "C++": "text/x-c++src",
  Java: "text/x-java",
  JavaScript: "javascript",
};

const BOILERPLATE_FOR = {
  Python: `print("Hello, DSA!")`,
  "C++": `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    cout << "Hello, DSA!" << endl;

    return 0;
}`,
  Java: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Hello, DSA!");
    }
}`,
  JavaScript: `console.log("Hello, DSA!");`,
};

const editor = CodeMirror.fromTextArea(codeEditorTextarea, {
  mode: CM_MODE_FOR[codeLangSelect.value] || "python",
  theme: "dracula",
  lineNumbers: true,
  indentUnit: 4,
  tabSize: 4,
  indentWithTabs: false,
  matchBrackets: true,
  autoCloseBrackets: true,
  extraKeys: {
    "Ctrl-Enter": () => runCode(),
    "Cmd-Enter": () => runCode(),
  },
});
editor.setSize("100%", "260px");

// Only auto-replace the editor's content on language switch if the person
// hasn't started editing yet (still showing some language's default
// boilerplate) — this avoids silently wiping code someone has written.
function isUnedited() {
  const current = editor.getValue().trim();
  return Object.values(BOILERPLATE_FOR).some((b) => b.trim() === current) || current === "";
}

codeLangSelect.addEventListener("change", () => {
  const lang = codeLangSelect.value;
  editor.setOption("mode", CM_MODE_FOR[lang] || "text/plain");
  if (isUnedited()) {
    editor.setValue(BOILERPLATE_FOR[lang] || "");
  }
});

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

async function runCode() {
  const code = editor.getValue();
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