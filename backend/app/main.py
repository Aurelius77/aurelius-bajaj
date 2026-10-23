from fastapi import FastAPI, HTTPException

from app.elexon import ElexonDataError, load_january_2026_analysis

app = FastAPI(title="UK Wind Forecast Analysis API")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/wind/analysis")
def wind_analysis():
    """Fetch and analyze Elexon wind actuals and forecasts for January 2026."""
    try:
        return load_january_2026_analysis()
    except ElexonDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
