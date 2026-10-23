export async function GET() {
  const backendBase =
    process.env.WIND_BACKEND_URL ??
    (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : undefined)

  if (!backendBase) {
    return Response.json(
      { detail: 'The wind analysis backend binding is not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const backendUrl = new URL('/api/wind/analysis', backendBase)
    const upstream = await fetch(backendUrl, { cache: 'no-store' })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return Response.json(
      { detail: 'Could not reach the wind analysis backend.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
