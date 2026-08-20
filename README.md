# DSA Visual Tutor

```
Live :- https://dsa-tutor-woad.vercel.app/
```

A DSA (Data Structures & Algorithms) learning tool with:
- FastAPI backend powered by Groq (LLaMA-3 / GPT-OSS) for explanations, approach comparisons, and step-by-step dry-runs.
- Vanilla JS/HTML/CSS frontend with login/signup (JWT-based auth).

## Project structure
```
dsa-tutor/
├── backend/   # FastAPI app
└── frontend/  # Static site
```

## Pages
- `index.html` — public landing page
- `login.html` — login / signup
- `dashboard.html` — the main tool (explain / compare approaches / dry run)
- `practice.html`, `progress.html`, `history.html` — sidebar nav placeholders for upcoming features

## Local development

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env       # then paste your GROQ_API_KEY and a JWT_SECRET
uvicorn main:app --reload
```
Backend runs at `http://localhost:8000`.

### Frontend
Just open `frontend/login.html` in a browser, or serve the folder:
```bash
cd frontend
python -m http.server 5500
```

## Deployment

See below — backend on Render, frontend on Vercel.
