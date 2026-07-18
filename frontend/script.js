const API_BASE = "http://localhost:8000";

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

const questionInput = document.getElementById("questionInput");
const runBtn = document.getElementById("runBtn");
const apiStatus = document.getElementById("apiStatus");

const explainPanel = document.getElementById("explainPanel");
const explanationText = document.getElementById("explanationText");

const approachesPanel = document.getElementById("approachesPanel");
const approachesList = document.getElementById("approachesList");

const dryrunPanel = document.getElementById("dryrunPanel");
const dryrunApproachName = document.getElementById("dryrunApproachName");
const arrayStage = document.getElementById("arrayStage");
const pointerRow = document.getElementById("pointerRow");
const actionLine = document.getElementById("actionLine");
const stepCounter = document.getElementById("stepCounter");
const prevStepBtn = document.getElementById("prevStep");
const nextStepBtn = document.getElementById("nextStep");
const playStepBtn = document.getElementById("playStep");
const speedSelect = document.getElementById("speedSelect");

const loader = document.getElementById("loader");
const loaderText = document.getElementById("loaderText");
const errorBox = document.getElementById("errorBox");

const listenBtn = document.getElementById("listenBtn");
const listenText = document.getElementById("listenText");
const narrateToggle = document.getElementById("narrateToggle");

let currentQuestion = "";
let currentSteps = [];
let currentStepIndex = 0;
let autoplayTimer = null;

// ---------- Text-to-speech (Web Speech API, free, browser built-in) ----------
const synth = window.speechSynthesis;

function speak(text, { onEnd } = {}) {
  if (!synth) return;
  synth.cancel(); // stop anything currently speaking
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  utter.onend = () => { if (onEnd) onEnd(); };
  synth.speak(utter);
}

function stopSpeaking() {
  if (synth) synth.cancel();
  listenBtn?.classList.remove("speaking");
  if (listenText) listenText.textContent = "listen";
}

if (listenBtn) {
  listenBtn.addEventListener("click", () => {
    if (!synth) {
      showError("Voice not supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (synth.speaking) {
      stopSpeaking();
      return;
    }
    listenBtn.classList.add("speaking");
    listenText.textContent = "stop";
    speak(explanationText.textContent, {
      onEnd: () => {
        listenBtn.classList.remove("speaking");
        listenText.textContent = "listen";
      },
    });
  });
}

function setStatus(live, label) {
  apiStatus.innerHTML = `<span class="dot ${live ? 'dot-live' : 'dot-idle'}"></span> ${label}`;
}

function showLoader(text) {
  loaderText.textContent = text;
  loader.classList.remove("hidden");
}
function hideLoader() { loader.classList.add("hidden"); }

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

runBtn.addEventListener("click", runTutor);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) runTutor();
});

async function runTutor() {
  const question = questionInput.value.trim();
  if (!question) return;
  currentQuestion = question;

  hideError();
  stopSpeaking();
  explainPanel.classList.add("hidden");
  approachesPanel.classList.add("hidden");
  dryrunPanel.classList.add("hidden");
  setStatus(true, "thinking...");

  try {
    showLoader("understanding the question...");
    const explainRes = await callApi("/api/explain", { question });
    explanationText.textContent = explainRes.explanation;
    explainPanel.classList.remove("hidden");
    hideLoader();

    showLoader("comparing approaches...");
    const approachRes = await callApi("/api/approaches", { question });
    renderApproaches(approachRes.approaches);
    approachesPanel.classList.remove("hidden");
    hideLoader();

    setStatus(false, "pick an approach to dry-run");
  } catch (err) {
    hideLoader();
    showError(err.message);
    setStatus(false, "error");
  }
}

function renderApproaches(approaches) {
  approachesList.innerHTML = "";
  approaches.forEach((a) => {
    const card = document.createElement("div");
    card.className = "approach-card" + (a.is_best ? " best" : "");
    card.innerHTML = `
      <div class="approach-top">
        <span class="approach-name">${a.name}</span>
        <span class="approach-badge ${a.is_best ? 'badge-best' : 'badge-normal'}">
          ${a.is_best ? "BEST FIT" : "ALTERNATIVE"}
        </span>
      </div>
      <div class="approach-complexity">time ${a.time_complexity} · space ${a.space_complexity}</div>
      <p class="approach-why">${a.why}</p>
    `;
    card.addEventListener("click", () => runDryRun(a.name));
    approachesList.appendChild(card);
  });
}

async function runDryRun(approachName) {
  hideError();
  stopAutoplay();
  stopSpeaking();
  setStatus(true, "building dry run...");
  showLoader("simulating step-by-step trace...");
  try {
    const trace = await callApi("/api/dry-run", {
      question: currentQuestion,
      approach: approachName,
    });
    currentSteps = trace.steps || [];
    currentStepIndex = 0;
    dryrunApproachName.textContent = approachName;
    dryrunPanel.classList.remove("hidden");
    renderStep();
    dryrunPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus(false, "dry run ready");
  } catch (err) {
    showError(err.message);
    setStatus(false, "error");
  } finally {
    hideLoader();
  }
}

function renderStep() {
  if (!currentSteps.length) return;
  const step = currentSteps[currentStepIndex];
  const maxVal = Math.max(...step.array.map((v) => Math.abs(v)), 1);

  // FLIP step 1: record current bar positions before we change anything
  const oldBars = Array.from(arrayStage.children);
  const oldRects = new Map();
  oldBars.forEach((bar) => oldRects.set(bar.dataset.slot, bar.getBoundingClientRect()));

  arrayStage.innerHTML = "";
  step.array.forEach((val, idx) => {
    const bar = document.createElement("div");
    const heightPct = 30 + (Math.abs(val) / maxVal) * 60;
    bar.className = "array-bar";
    bar.style.height = `${heightPct}%`;
    bar.textContent = val;
    bar.dataset.slot = `${val}`; // used to match same value across steps for FLIP
    if (step.highlight && step.highlight.includes(idx)) {
      bar.classList.add(step.swapped ? "swapped" : "highlight");
    }
    arrayStage.appendChild(bar);
  });

  // FLIP step 2: for bars that existed before, slide them from old position to new
  const newBars = Array.from(arrayStage.children);
  newBars.forEach((bar) => {
    const oldRect = oldRects.get(bar.dataset.slot);
    if (!oldRect) return;
    const newRect = bar.getBoundingClientRect();
    const deltaX = oldRect.left - newRect.left;
    if (Math.abs(deltaX) > 2) {
      bar.style.transition = "none";
      bar.style.transform = `translateX(${deltaX}px)`;
      requestAnimationFrame(() => {
        bar.style.transition = "transform 0.35s ease, height 0.25s ease, background 0.25s ease, border-color 0.25s ease";
        bar.style.transform = "translateX(0)";
      });
    }
  });

  pointerRow.innerHTML = "";
  if (step.pointers) {
    Object.entries(step.pointers).forEach(([name, idx]) => {
      const tag = document.createElement("div");
      tag.className = "pointer-tag";
      tag.innerHTML = `<span class="name">${name}</span>=${idx}`;
      pointerRow.appendChild(tag);
    });
  }

  actionLine.textContent = "// " + (step.action || "");
  stepCounter.textContent = `${currentStepIndex + 1} / ${currentSteps.length}`;

  if (narrateToggle && narrateToggle.checked && step.action) {
    speak(step.action);
  }
}

prevStepBtn.addEventListener("click", () => {
  stopAutoplay();
  if (currentStepIndex > 0) {
    currentStepIndex--;
    renderStep();
  }
});

nextStepBtn.addEventListener("click", () => {
  stopAutoplay();
  if (currentStepIndex < currentSteps.length - 1) {
    currentStepIndex++;
    renderStep();
  }
});

playStepBtn.addEventListener("click", () => {
  if (autoplayTimer) {
    stopAutoplay();
    return;
  }
  playStepBtn.textContent = "⏸ pause";
  const speed = parseInt(speedSelect.value, 10) || 1100;
  autoplayTimer = setInterval(() => {
    if (currentStepIndex < currentSteps.length - 1) {
      currentStepIndex++;
      renderStep();
    } else {
      stopAutoplay();
    }
  }, speed);
});

// restart autoplay with new speed if user changes it mid-play
speedSelect.addEventListener("change", () => {
  if (autoplayTimer) {
    stopAutoplay();
    playStepBtn.click();
  }
});

function stopAutoplay() {
  if (autoplayTimer) {
    clearInterval(autoplayTimer);
    autoplayTimer = null;
    playStepBtn.textContent = "▶ auto";
  }
}