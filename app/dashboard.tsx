'use client'

import { useEffect, useMemo, useState } from 'react'

type Period = {
  startTime: string
  forecastPublishTime: string
  forecastMW: number
  actualMW: number
  errorMW: number
  absoluteErrorMW: number
}

type Analysis = {
  month: string
  decisionRule: { description: string; cutoffLocalTime: string; status: string }
  resolution: { forecast: string; actual: string; unit: string }
  summary: {
    expectedHours: number
    actualHalfHoursReturned: number
    matchedHours: number
    coveragePercent: number
    maeMW: number
    biasMW: number
    wapePercent: number | null
    duplicateForecastRowsIgnored: number
  }
  dataQuality: {
    missingActualHours: string[]
    invalidActualHours: string[]
    missingForecastHours: string[]
  }
  periods: Period[]
}

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${value}T12:00:00Z`))
}

function WindChart({ periods }: { periods: Period[] }) {
  const width = 1000
  const height = 300
  const pad = { left: 60, right: 18, top: 20, bottom: 36 }
  const values = periods.flatMap((period) => [period.forecastMW, period.actualMW])
  const min = Math.floor((Math.min(...values, 0) * 0.9) / 1000) * 1000
  const max = Math.ceil((Math.max(...values, 1) * 1.08) / 1000) * 1000
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const x = (index: number) => pad.left + (periods.length <= 1 ? 0 : (index / (periods.length - 1)) * innerWidth)
  const y = (value: number) => pad.top + ((max - value) / (max - min || 1)) * innerHeight
  const path = (key: 'forecastMW' | 'actualMW') =>
    periods.map((period, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(period[key])}`).join(' ')
  const ticks = 4

  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hourly forecast and actual wind generation chart">
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const value = min + ((max - min) / ticks) * index
          const yy = y(value)
          return (
            <g key={index}>
              <line x1={pad.left} x2={width - pad.right} y1={yy} y2={yy} className="chart-grid" />
              <text x={pad.left - 10} y={yy + 4} textAnchor="end" className="chart-axis">{number.format(value / 1000)}k</text>
            </g>
          )
        })}
        <path d={path('forecastMW')} className="chart-line forecast-line" />
        <path d={path('actualMW')} className="chart-line actual-line" />
        {periods.map((period, index) => (
          <g key={period.startTime} className="chart-point">
            <circle cx={x(index)} cy={y(period.forecastMW)} r="3.5" className="forecast-point" />
            <circle cx={x(index)} cy={y(period.actualMW)} r="3.5" className="actual-point" />
            <title>{timeLabel(period.startTime)} — forecast {number.format(period.forecastMW)} MW; actual {number.format(period.actualMW)} MW</title>
          </g>
        ))}
        {[0, 6, 12, 18, Math.max(0, periods.length - 1)].map((index) => periods[index] && (
          <text key={index} x={x(index)} y={height - 8} textAnchor="middle" className="chart-axis">{timeLabel(periods[index].startTime)}</text>
        ))}
      </svg>
    </div>
  )
}

export default function Dashboard() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  const [selectedDay, setSelectedDay] = useState('2026-01-13')
  const [refreshId, setRefreshId] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setError('')
    fetch(`${apiBase}/api/wind/analysis`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.detail ?? `The analysis service returned ${response.status}.`)
        }
        return response.json() as Promise<Analysis>
      })
      .then((data) => {
        setAnalysis(data)
        setUpdatedAt(new Date())
        setSelectedDay((current) =>
          data.periods.some((period) => period.startTime.slice(0, 10) === current)
            ? current
            : data.periods[0]?.startTime.slice(0, 10) ?? '',
        )
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== 'AbortError') setError(reason.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    return () => controller.abort()
  }, [refreshId])

  const days = useMemo(() => [...new Set(analysis?.periods.map((period) => period.startTime.slice(0, 10)) ?? [])], [analysis])
  const dayPeriods = useMemo(
    () => analysis?.periods.filter((period) => period.startTime.slice(0, 10) === selectedDay) ?? [],
    [analysis, selectedDay],
  )

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="Northstar Wind Desk home">
          <span className="brand-mark"><span /></span>
          <span className="brand-name">northstar<span> / wind desk</span></span>
        </a>
        <div className="topbar-right">
          <span className="data-source"><span className="live-dot" /> Elexon BMRS data</span>
          <span className="user-mark">UK</span>
        </div>
      </header>

      <div className="page-content" id="overview">
        <div className="eyebrow"><span className="eyebrow-line" /> PILOT ANALYSIS <span className="eyebrow-dot">·</span> JANUARY 2026</div>
        <div className="page-heading">
          <div>
            <h1>Wind forecast performance</h1>
            <p className="page-subtitle">See what the day-ahead forecast said, when it was published, and how it compared with actual generation.</p>
          </div>
          <div className="page-actions">
            <div className="month-pill"><span className="calendar-icon">▦</span> January 2026 <span className="chevron">⌄</span></div>
            <button className="refresh-button" onClick={() => setRefreshId((value) => value + 1)} disabled={isLoading}>
              <span className={isLoading ? 'refresh-symbol refresh-spinning' : 'refresh-symbol'}>↻</span>
              {isLoading ? 'Refreshing' : 'Refresh data'}
            </button>
            {updatedAt && <span className="updated-at">Updated {updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>

        {error && !analysis ? (
          <section className="state-card error-card">
            <div className="state-icon">!</div>
            <div><h2>Couldn’t load the analysis</h2><p>{error}</p><p className="state-hint">Make sure the Python API is running on port 8000, then refresh this page.</p></div>
          </section>
        ) : !analysis ? (
          <section className="loading-state"><span className="spinner" /> Loading January wind data…</section>
        ) : (
          <>
            {error && <div className="refresh-warning">Refresh failed: {error} Showing the last successfully loaded response.</div>}
            <section className="metric-grid" aria-label="January summary metrics">
              <article className="metric-card metric-primary">
                <div className="metric-topline"><span>Mean absolute error</span><span className="metric-icon">↕</span></div>
                <div className="metric-value">{number.format(analysis.summary.maeMW)} <small>MW</small></div>
                <div className="metric-foot"><span className="metric-caption">Average distance from actual generation</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-topline"><span>Forecast bias</span><span className="metric-icon pale">±</span></div>
                <div className="metric-value">{analysis.summary.biasMW > 0 ? '+' : ''}{number.format(analysis.summary.biasMW)} <small>MW</small></div>
                <div className="metric-foot"><span className="metric-caption">Positive means forecasts ran high</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-topline"><span>Matched coverage</span><span className="metric-icon pale">◷</span></div>
                <div className="metric-value">{decimal.format(analysis.summary.coveragePercent)}<small>%</small></div>
                <div className="metric-foot"><span className="metric-caption">{number.format(analysis.summary.matchedHours)} of {number.format(analysis.summary.expectedHours)} hourly periods</span></div>
              </article>
              <article className="metric-card">
                <div className="metric-topline"><span>Weighted error</span><span className="metric-icon pale">%</span></div>
                <div className="metric-value">{analysis.summary.wapePercent === null ? '—' : decimal.format(analysis.summary.wapePercent)}<small>{analysis.summary.wapePercent === null ? '' : '%'}</small></div>
                <div className="metric-foot"><span className="metric-caption">WAPE across matched periods</span></div>
              </article>
            </section>

            <section className="main-grid">
              <article className="panel chart-panel">
                <div className="panel-header">
                  <div><div className="section-kicker">GENERATION PROFILE</div><h2>Forecast vs actual</h2><p className="panel-description">Hourly average wind generation · MW</p></div>
                  <label className="select-wrap"><span className="sr-only">Choose delivery day</span><select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}>{days.map((day) => <option key={day} value={day}>{dayLabel(day)}</option>)}</select><span className="select-arrow">⌄</span></label>
                </div>
                <div className="chart-legend"><span><i className="legend-dot forecast-legend" /> Forecast</span><span><i className="legend-dot actual-legend" /> Actual</span><span className="chart-unit">MW</span></div>
                {dayPeriods.length ? <WindChart periods={dayPeriods} /> : <div className="empty-chart">No matched periods for this day.</div>}
                <div className="chart-footer"><span>{selectedDay ? dayLabel(selectedDay) : 'Selected day'}</span><span>{dayPeriods.length} matched hourly periods</span></div>
              </article>

              <aside className="panel decision-panel">
                <div className="section-kicker">FORECAST SELECTION</div>
                <div className="decision-heading"><span className="decision-icon">◷</span><h2>What was available</h2></div>
                <p className="decision-rule">{analysis.decisionRule.description}</p>
                <div className="cutoff-callout"><span className="cutoff-label">PILOT CUTOFF</span><strong>11:00</strong><span>UK local time · day before delivery</span></div>
                <div className="resolution-note"><strong>Resolution note</strong><span>Forecasts are hourly. Actual half-hour readings are averaged in pairs for comparison.</span></div>
              </aside>
            </section>

            <section className="panel table-panel">
              <div className="panel-header table-header">
                <div><div className="section-kicker">PERIOD DETAIL</div><h2>Delivery periods</h2><p className="panel-description">Selected day · forecast version available at the cutoff</p></div>
                <div className="table-count">{dayPeriods.length} periods</div>
              </div>
              <div className="table-scroll"><table>
                <thead><tr><th>Delivery time</th><th>Forecast issued</th><th>Forecast <small>MW</small></th><th>Actual <small>MW</small></th><th>Error <small>MW</small></th></tr></thead>
                <tbody>{dayPeriods.map((period) => <tr key={period.startTime}>
                  <td className="time-cell">{timeLabel(period.startTime)}</td>
                  <td className="publish-cell">{timeLabel(period.forecastPublishTime)} <span>UK</span></td>
                  <td>{number.format(period.forecastMW)}</td><td>{number.format(period.actualMW)}</td>
                  <td className={period.errorMW > 0 ? 'error-positive' : 'error-negative'}>{period.errorMW > 0 ? '+' : ''}{number.format(period.errorMW)}</td>
                </tr>)}</tbody>
              </table></div>
              <div className="table-footnote">Error = forecast − actual. Positive values mean the forecast was higher than observed generation.</div>
            </section>

            <footer className="page-footer"><span>Source: Elexon BMRS · FUELHH and WINDFOR</span><span>{analysis.summary.actualHalfHoursReturned} actual half-hour records · {analysis.summary.matchedHours} matched hours</span></footer>
          </>
        )}
      </div>
    </main>
  )
}
