"""
DSA Visual Tutor - Backend
FastAPI + Groq (LLaMA-3 / GPT-OSS) powered API for:
  1. /api/explain      -> plain-language explanation (English or Hinglish)
  2. /api/approaches   -> ranked solution approaches with complexity + reasoning
  3. /api/dry-run      -> step-by-step JSON trace (array OR tree/graph shape) for animation
  4. /api/translate    -> translate already-shown content into English / Hinglish / Hindi
  5. /api/run-code     -> execute user code via the sandboxed Piston API
  6. /api/auth/*        -> signup / login / current user

Run:
  pip install -r requirements.txt
  cp .env.example .env   # then paste your GROQ_API_KEY, JWT_SECRET
  uvicorn main:app --reload
"""

import os
import json
import re
from typing import List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from groq import Groq

import auth

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

PISTON_URL = "https://emkc.org/api/v2/piston"
LANGUAGE_MAP = {
    "Python": "python",
    "C++": "cpp",
    "Java": "java",
    "JavaScript": "javascript",
}
FILE_EXTENSIONS = {
    "python": "main.py",
    "cpp": "main.cpp",
    "java": "Main.java",
    "javascript": "main.js",
}
_piston_runtime_cache: dict = {}

app = FastAPI(title="DSA Visual Tutor API")

auth.init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Auth Endpoints ----------

@app.post("/api/auth/signup", response_model=auth.AuthResponse)
def signup(req: auth.SignupRequest):
    if auth.get_user_by_email(req.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    user = auth.create_user(req.name, req.email, req.password)
    token = auth.create_access_token({"sub": user["email"]})
    return auth.AuthResponse(access_token=token, name=user["name"], email=user["email"])


@app.post("/api/auth/login", response_model=auth.AuthResponse)
def login(req: auth.LoginRequest):
    user = auth.get_user_by_email(req.email)
    if not user or not auth.verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = auth.create_access_token({"sub": user["email"]})
    return auth.AuthResponse(access_token=token, name=user["name"], email=user["email"])


@app.get("/api/auth/me")
def me(current_user: dict = Depends(auth.get_current_user)):
    return current_user


# ---------- Request Models ----------

class QuestionRequest(BaseModel):
    question: str
    explain_language: Optional[str] = "english"  # "english" or "hinglish"


class DryRunRequest(BaseModel):
    question: str
    approach: str
    narrate_language: Optional[str] = "english"  # "english" or "hinglish"


class RunCodeRequest(BaseModel):
    code: str
    language: str = "Python"
    stdin: Optional[str] = ""


class TranslateRequest(BaseModel):
    text: str
    target: str = "english"  # "english", "hinglish", or "hindi"


# ---------- Helper: call Groq & force clean JSON ----------

def call_llm(system_prompt: str, user_prompt: str) -> str:
    if client is None:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY not set. Add it to backend/.env"
        )
    response = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
    )
    return response.choices[0].message.content


def extract_json(raw_text: str):
    """LLMs sometimes wrap JSON in ```json fences or add stray text. Strip it."""
    cleaned = re.sub(r"```json|```", "", raw_text).strip()
    match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
    if match:
        cleaned = match.group(1)
    return json.loads(cleaned)


# ---------- Endpoints ----------

@app.get("/")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/api/explain")
def explain_question(req: QuestionRequest, current_user: dict = Depends(auth.get_current_user)):
    if req.explain_language == "hinglish":
        language_instruction = (
            "Respond in natural Hinglish (Hindi-English mix, written in Roman/English script "
            "— NOT Devanagari), the way an Indian CS student casually explains things to a "
            "friend. Keep technical terms (array, pointer, time complexity, etc.) in English "
            "since that's how students actually say them; mix in Hindi for the explanatory "
            "and connecting words. Keep it natural, not forced."
        )
    else:
        language_instruction = "Respond in clear, simple English."

    system_prompt = (
        "You are a friendly DSA tutor for Indian CS students preparing for placements. "
        "Explain the given problem in simple language: what it's asking, a real-world "
        "analogy, and constraints/edge cases to watch for. Keep it under 150 words. "
        f"{language_instruction} "
        "Respond in plain text, no markdown headers."
    )
    text = call_llm(system_prompt, req.question)
    return {"explanation": text}


@app.post("/api/approaches")
def get_approaches(req: QuestionRequest, current_user: dict = Depends(auth.get_current_user)):
    system_prompt = (
        "You are a DSA tutor. Given a problem, return ONLY valid JSON (no markdown, "
        "no commentary) — an array of approach objects, ordered from brute force to "
        "most optimal. Each object must have exactly these keys: "
        '"name" (string), "time_complexity" (string), "space_complexity" (string), '
        '"is_best" (boolean), "why" (1-2 sentence reasoning for why this is/isn\'t optimal). '
        "Include 2 to 4 approaches."
    )
    raw = call_llm(system_prompt, req.question)
    try:
        approaches = extract_json(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON. Try again.")
    return {"approaches": approaches}


@app.post("/api/dry-run")
def dry_run(req: DryRunRequest, current_user: dict = Depends(auth.get_current_user)):
    if req.narrate_language == "hinglish":
        action_language_instruction = (
            "Write every 'action' description in natural Hinglish (Hindi-English mix, "
            "Roman script — NOT Devanagari), the way an Indian CS student casually narrates "
            "what's happening. Keep technical terms (pointer, node, index, visited, etc.) in "
            "English since that's how students actually say them."
        )
    else:
        action_language_instruction = "Write every 'action' description in clear, proper English."

    system_prompt = (
        "You are a DSA visualizer engine for a student-facing learning tool. Given a problem "
        "and a chosen approach, simulate the algorithm on a SMALL sample input and return "
        "ONLY valid JSON (no markdown, no commentary, no code fences).\n\n"
        "STEP 1 — Decide the structure_type:\n"
        "- \"array\" for array/string/two-pointer/sliding-window/sorting/searching problems.\n"
        "- \"tree\" for binary tree / BST problems.\n"
        "- \"graph\" for graph traversal / shortest-path / connectivity problems.\n\n"
        "STEP 2 — Return JSON in ONE of these two shapes, matching structure_type:\n\n"
        "=== SHAPE A (structure_type = \"array\") ===\n"
        "{\n"
        '  "structure_type": "array",\n'
        '  "input": [ ... ],\n'
        '  "steps": [\n'
        "    {\n"
        '      "array": [ ... state AFTER this step\'s change, if any ... ],\n'
        '      "highlight": [ indices touched this step ],\n'
        '      "pointers": { "i": 0, "j": 1 },\n'
        '      "action": "2-3 full sentences explaining, in proper student-friendly language: '
        'which pointer(s) are involved, what values they are looking at right now, what '
        'comparison or operation is happening, WHY it happens, and how the pointer(s) will '
        'move next. This should read like a tutor narrating the algorithm, not a terse log line.",\n'
        '      "swapped": false\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "=== SHAPE B (structure_type = \"tree\" or \"graph\") ===\n"
        "{\n"
        '  "structure_type": "tree" | "graph",\n'
        '  "nodes": [ { "id": "A", "value": 5, "x": 0-700, "y": 0-320 } ... up to 10 nodes, '
        "laid out with sensible non-overlapping coordinates — a top-down hierarchy for trees, "
        "a roughly circular/force-like spread for graphs ],\n"
        '  "edges": [ { "from": "A", "to": "B" } ... ],\n'
        '  "steps": [\n'
        "    {\n"
        '      "current": "A",\n'
        '      "visited": [ "A", "B" ],\n'
        '      "frontier": [ "C", "D" ],\n'
        '      "active_edge": { "from": "A", "to": "B" } | null,\n'
        '      "pointers": { "queue_front": "C" },\n'
        '      "action": "2-3 full sentences explaining what node is being visited, why it was '
        'chosen next (e.g. from the front of the queue / top of the stack / smallest distance), '
        'what its neighbours are, and what happens as a result — written like a tutor narrating, '
        'not a terse log line."\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "General rules: keep steps between 5 and 15. Use a small sample (max 7 array elements, "
        "or max 10 tree/graph nodes) so it stays easy to follow. "
        f"{action_language_instruction} "
        "Pick exactly one shape based on structure_type and do not mix fields from the other shape."
    )
    user_prompt = f"Problem: {req.question}\nApproach to simulate: {req.approach}"
    raw = call_llm(system_prompt, user_prompt)
    try:
        trace = extract_json(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON. Try again.")
    return trace


@app.post("/api/translate")
def translate_text(req: TranslateRequest, current_user: dict = Depends(auth.get_current_user)):
    if req.target == "hinglish":
        instruction = (
            "Translate/rewrite the following text into natural Hinglish (Hindi-English mix, "
            "Roman script — NOT Devanagari), the way an Indian CS student casually explains "
            "things. Keep technical terms (array, pointer, complexity, etc.) in English; mix "
            "Hindi for the connecting and explanatory words. Keep the same meaning and length."
        )
    elif req.target == "hindi":
        instruction = (
            "Translate the following text into clear, simple Hindi using Devanagari script. "
            "You may keep well-established technical/programming terms (array, pointer, "
            "complexity, function names, code snippets) in English/Roman script since that is "
            "standard practice, but translate all explanatory sentences fully into Hindi."
        )
    else:
        instruction = "Translate/rewrite the following text into clear, simple English."

    system_prompt = (
        f"{instruction} Return ONLY the translated text, no preamble, no quotes, "
        "no markdown formatting."
    )
    translated = call_llm(system_prompt, req.text)
    return {"text": translated}


# ---------- Compiler (Piston API) ----------

async def get_piston_version(language_id: str) -> str:
    """Piston needs an exact runtime version per language; fetch + cache it."""
    if language_id in _piston_runtime_cache:
        return _piston_runtime_cache[language_id]
    try:
        async with httpx.AsyncClient(timeout=15) as http_client:
            res = await http_client.get(f"{PISTON_URL}/runtimes")
            res.raise_for_status()
            runtimes = res.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach code execution service: {e}")

    for rt in runtimes:
        if rt["language"] == language_id:
            _piston_runtime_cache[language_id] = rt["version"]
            return rt["version"]
    raise HTTPException(status_code=400, detail=f"Unsupported language: {language_id}")


@app.post("/api/run-code")
async def run_code(req: RunCodeRequest, current_user: dict = Depends(auth.get_current_user)):
    language_id = LANGUAGE_MAP.get(req.language, "python")
    version = await get_piston_version(language_id)

    payload = {
        "language": language_id,
        "version": version,
        "files": [{"name": FILE_EXTENSIONS.get(language_id, "main.txt"), "content": req.code}],
        "stdin": req.stdin or "",
    }

    try:
        async with httpx.AsyncClient(timeout=25) as http_client:
            res = await http_client.post(f"{PISTON_URL}/execute", json=payload)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach code execution service: {e}")

    if res.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Code execution service returned {res.status_code}: {res.text[:300]}",
        )

    result = res.json()
    run = result.get("run", {})
    compile_step = result.get("compile", {})
    return {
        "stdout": run.get("stdout", ""),
        "stderr": run.get("stderr", ""),
        "compile_output": compile_step.get("stderr", "") if compile_step else "",
        "exit_code": run.get("code"),
        "language": language_id,
        "version": version,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)