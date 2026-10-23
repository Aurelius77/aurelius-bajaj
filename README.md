# Northstar Wind Desk

A pilot dashboard for reviewing Elexon UK wind generation forecasts against actual generation for January 2026.

## Run with Docker

Prerequisite: Docker Desktop (or Docker Engine with the Compose plugin).

From the repository root, run:

```bash
docker compose up --build
```

Then open:

- Dashboard: <http://localhost:3000>
- API health: <http://localhost:8000/api/health>
- January analysis API: <http://localhost:8000/api/wind/analysis>
- Interactive API docs: <http://localhost:8000/docs>

The dashboard fetches the January 2026 FUELHH and WINDFOR records from Elexon through the Python API when it loads. Use **Refresh data** to request them again. The 11:00 UK-time forecast cutoff on the day before delivery is a documented pilot assumption.

Stop the containers with `Ctrl+C`, or run `docker compose down` in another terminal.

To rebuild after changing application code, run `docker compose up --build` again.

## Run without Docker

### Frontend

```bash
npm ci
npm run dev
```

### Backend

In a second terminal:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The frontend runs at <http://localhost:3000>; the backend runs at <http://localhost:8000>.

## Project structure

- `app/` — Next.js pages, dashboard UI, and visual styles.
- `backend/app/main.py` — FastAPI application and HTTP routes.
- `backend/app/elexon.py` — Elexon data retrieval, forecast selection, matching, and accuracy calculations.
- `backend/scripts/inspect_elexon_sample.py` — small script for inspecting one delivery day.
- `backend/requirements.txt` — Python dependencies.
- `Dockerfile` — production build for the Next.js frontend.
- `backend/Dockerfile` — Python API container.
- `docker-compose.yml` — starts the frontend and API together.

## Analysis notes

- Actual generation comes from FUELHH records filtered to `fuelType=WIND`.
- Forecasts come from WINDFOR records.
- WINDFOR is hourly in the inspected sample; FUELHH is half-hourly. The API averages the two actual half-hours in each hour before comparing values.
- Error is `forecast - actual`. The API reports MAE, signed bias, WAPE, and matched-period coverage.
- The supplied datasets do not contain demand, so this app does not calculate a complete amount of power to procure.

## AI tools

OpenAI Codex was used to help with implementation and documentation.
