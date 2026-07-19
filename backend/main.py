"""
DSA Visual Tutor - Backend
FastAPI + Groq (LLaMA-3) powered API for:
  1. /api/explain      -> plain-language explanation of a DSA question
  2. /api/approaches   -> list of approaches (brute -> optimal) with complexity + reasoning
  3. /api/dry-run      -> step-by-step JSON trace used by frontend to animate the array

Run:
  pip install -r requirements.txt
  cp .env.example .env   # then paste your GROQ_API_KEY
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
FILE_EXTENSIONS = {"python": "main.py", "cpp": "main.cpp", "java": "Main.java", "javascript": "main.js"}
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


class DryRunRequest(BaseModel):
    question: str
    approach: str


class RunCodeRequest(BaseModel):
    code: str
    language: str = "Python"
    stdin: Optional[str] = ""


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
    # grab the outermost {...} or [...] block as a fallback
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
    system_prompt = (
        "You are a friendly DSA tutor for Indian CS students preparing for placements. "
        "Explain the given problem in simple language: what it's asking, a real-world "
        "analogy, and constraints/edge cases to watch for. Keep it under 150 words. "
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
    system_prompt = (
        "You are a DSA visualizer engine. Given a problem and a chosen approach, "
        "simulate the algorithm on a SMALL sample input (max 7 elements) and return "
        "ONLY valid JSON (no markdown, no commentary) in this exact shape:\n"
        "{\n"
        '  "input": [ ... ],\n'
        '  "steps": [\n'
        "    {\n"
        '      "array": [ ... current state of the array ... ],\n'
        '      "highlight": [ indices being compared/touched this step ],\n'
        '      "pointers": { "i": 0, "j": 1 },\n'
        '      "action": "short human-readable description of this step",\n'
        '      "swapped": false\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "Rules: 'array' must reflect the state AFTER any change in that step. "
        "'pointers' can have any relevant named keys (i, j, low, high, mid, left, right etc) "
        "— omit keys that don't apply. Keep steps between 5 and 15. "
        "If the algorithm is not array/index based (e.g. graph/tree), still represent "
        "its core data structure as a flat array of values with pointers as indices, "
        "approximating the traversal order, so it stays visualizable as a linear sequence."
    )
    user_prompt = f"Problem: {req.question}\nApproach to simulate: {req.approach}"
    raw = call_llm(system_prompt, user_prompt)
    try:
        trace = extract_json(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON. Try again.")
    return trace


async def get_piston_version(language_id: str) -> str:
    """Piston needs an exact runtime version per language; fetch + cache it."""
    if language_id in _piston_runtime_cache:
        return _piston_runtime_cache[language_id]
    async with httpx.AsyncClient(timeout=10) as http_client:
        res = await http_client.get(f"{PISTON_URL}/runtimes")
        res.raise_for_status()
        runtimes = res.json()
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
    async with httpx.AsyncClient(timeout=20) as http_client:
        res = await http_client.post(f"{PISTON_URL}/execute", json=payload)
    if res.status_code != 200:
        raise HTTPException(status_code=502, detail="Code execution service error. Try again.")

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