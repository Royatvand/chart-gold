const ALLOWED_RESOLUTIONS = new Set(['1', '5', '15', '30', '60', '180', '240', '360', '720', 'D', '1D', '2D', '3D'])

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const query = req.query ?? {}
  const symbol = String(query.symbol ?? '').toUpperCase()
  const resolution = String(query.resolution ?? '')
  const to = Number(query.to)
  const countback = Math.min(500, Math.max(1, Math.floor(Number(query.countback) || 500)))

  if (!/^[A-Z0-9]{3,16}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid market symbol' })
  }
  if (!ALLOWED_RESOLUTIONS.has(resolution)) {
    return res.status(400).json({ error: 'Unsupported candle resolution' })
  }
  if (!Number.isFinite(to) || to <= 0) {
    return res.status(400).json({ error: 'A valid Unix timestamp is required in the to parameter' })
  }

  const upstreamUrl = new URL('https://apiv2.nobitex.ir/market/udf/history')
  upstreamUrl.searchParams.set('symbol', symbol)
  upstreamUrl.searchParams.set('resolution', resolution)
  upstreamUrl.searchParams.set('to', String(Math.floor(to)))
  upstreamUrl.searchParams.set('countback', String(countback))

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TraderBot/ChartGold-1.0.0',
      },
    })
    const payload = await upstream.json()
    res.setHeader('Cache-Control', 'no-store')
    return res.status(upstream.ok ? 200 : upstream.status).json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nobitex request failed'
    return res.status(502).json({ error: message })
  }
}
