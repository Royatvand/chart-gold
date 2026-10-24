import { get } from '@vercel/blob'

declare const process: { env: Record<string, string | undefined> }

type Bar = { time: number; open: number; high: number; low: number; close: number; volume?: number }
type TradeRow = { id: number; side: 'LONG' | 'SHORT'; entry: number; stop: number; target: number; exit: number; result: 'WIN' | 'LOSS'; r: number; entryIndex: number; exitIndex: number; date: string }

function dateLabel(time: number): string {
  return new Date(time * 1000).toISOString().replace('T', ' ').slice(0, 16)
}

function parseTimestamp(dateText: string, timeText: string): number | null {
  const d = dateText.trim().replace(/^"|"$/g, '')
  const tm = timeText.trim().replace(/^"|"$/g, '')
  if (!d) return null
  if (/^\d{8}$/.test(d)) {
    const t = tm ? tm.replace(/[^\d]/g, '').padStart(6, '0') : '000000'
    const ms = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), Number(t.slice(0, 2)), Number(t.slice(2, 4)), Number(t.slice(4, 6)))
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }
  const n = Number(d)
  if (/^\d+(\.\d+)?$/.test(d) && Number.isFinite(n)) {
    if (n > 1e12) return Math.floor(n / 1000)
    if (n > 1e9) return Math.floor(n)
  }
  const parsed = Date.parse(tm ? `${d} ${tm}` : d)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

export default async function handler(request: Request) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const expectedKey = process.env.CHART_GOLD_UPLOAD_KEY
  if (!expectedKey || request.headers.get('x-upload-key') !== expectedKey) {
    return Response.json({ error: 'Invalid upload key' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const pathname = typeof body.pathname === 'string' ? body.pathname : ''
  const timeframeSec = Number(body.timeframeSec)
  const fastPeriod = Number(body.fastPeriod)
  const slowPeriod = Number(body.slowPeriod)
  const rr = Number(body.rr)
  const riskPct = Number(body.riskPct)
  const commission = Number(body.commission)
  if (!pathname || pathname.length > 1024 || pathname.includes('..')) return Response.json({ error: 'A valid blob pathname is required' }, { status: 400 })
  if (![timeframeSec, fastPeriod, slowPeriod, rr, riskPct, commission].every(Number.isFinite)
    || timeframeSec < 60 || timeframeSec > 604800 || fastPeriod < 2 || fastPeriod >= slowPeriod || slowPeriod > 200
    || rr <= 0 || rr > 100 || riskPct <= 0 || riskPct > 100 || commission < 0 || commission > 100) {
    return Response.json({ error: 'Invalid timeframe or strategy settings' }, { status: 400 })
  }

  try {
    const blob = await get(pathname, { access: 'private' })
    if (!blob || blob.statusCode !== 200) return Response.json({ error: 'Private CSV not found' }, { status: 404 })
    const reader = blob.stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let header: string[] | null = null
    let delimiter = ','
    let dateIdx = -1, timeIdx = -1, oi = -1, hi = -1, li = -1, ci = -1, vi = -1
    let lastTimestamp = 0
    let rawCount = 0
    let barCount = 0
    let bucket = -1
    let aggregateBar: Bar | null = null
    const preview: Bar[] = []
    let previewCursor = 0
    let previewFull = false

    const fastBuf = new Array<number>(fastPeriod).fill(0)
    const slowBuf = new Array<number>(slowPeriod).fill(0)
    let fastCursor = 0, slowCursor = 0, fastCount = 0, slowCount = 0
    let fastSum = 0, slowSum = 0
    let previousFast = Number.NaN, previousSlow = Number.NaN
    let openTrade: Omit<TradeRow, 'exit' | 'result' | 'r' | 'exitIndex'> | null = null
    const tradeRows: TradeRow[] = []
    let tradeCursor = 0
    let totalTrades = 0, wins = 0, losses = 0, netR = 0, grossWin = 0, grossLoss = 0

    const closeTrade = (exit: number, index: number) => {
      if (!openTrade) return
      const rawR = (openTrade.side === 'LONG' ? exit - openTrade.entry : openTrade.entry - exit) / Math.abs(openTrade.entry - openTrade.stop)
      const r = rawR - commission
      const row: TradeRow = { ...openTrade, exit, result: r > 0 ? 'WIN' : 'LOSS', r, exitIndex: index }
      totalTrades++
      if (r > 0) { wins++; grossWin += r } else { losses++; grossLoss += Math.abs(r) }
      netR += r
      if (tradeRows.length < 1000) tradeRows.push(row)
      else { tradeRows[tradeCursor] = row; tradeCursor = (tradeCursor + 1) % 1000 }
      openTrade = null
    }

    const processBar = (bar: Bar) => {
      const index = barCount++
      if (preview.length < 5000) preview.push(bar)
      else { preview[previewCursor] = bar; previewCursor = (previewCursor + 1) % 5000; previewFull = true }

      if (openTrade) {
        const stopHit = openTrade.side === 'LONG' ? bar.low <= openTrade.stop : bar.high >= openTrade.stop
        const targetHit = openTrade.side === 'LONG' ? bar.high >= openTrade.target : bar.low <= openTrade.target
        if (stopHit || targetHit) closeTrade(stopHit ? openTrade.stop : openTrade.target, index)
      }

      const fastOld = fastCount >= fastPeriod ? fastSum / fastPeriod : Number.NaN
      const slowOld = slowCount >= slowPeriod ? slowSum / slowPeriod : Number.NaN
      fastSum -= fastBuf[fastCursor]
      fastBuf[fastCursor] = bar.close
      fastSum += bar.close
      fastCursor = (fastCursor + 1) % fastPeriod
      fastCount = Math.min(fastPeriod, fastCount + 1)
      slowSum -= slowBuf[slowCursor]
      slowBuf[slowCursor] = bar.close
      slowSum += bar.close
      slowCursor = (slowCursor + 1) % slowPeriod
      slowCount = Math.min(slowPeriod, slowCount + 1)
      const fastNow = fastCount >= fastPeriod ? fastSum / fastPeriod : Number.NaN
      const slowNow = slowCount >= slowPeriod ? slowSum / slowPeriod : Number.NaN

      if (openTrade) {
        previousFast = fastNow
        previousSlow = slowNow
        return
      }
      if (Number.isFinite(fastOld) && Number.isFinite(slowOld) && Number.isFinite(fastNow) && Number.isFinite(slowNow)) {
        const side = fastOld <= slowOld && fastNow > slowNow ? 'LONG'
          : fastOld >= slowOld && fastNow < slowNow ? 'SHORT' : null
        if (side) {
          const range = Math.max(bar.high - bar.low, Math.abs(bar.close - bar.open), bar.close * .0008)
          const entry = bar.close
          const stop = side === 'LONG' ? entry - range * 1.6 : entry + range * 1.6
          const target = side === 'LONG' ? entry + Math.abs(entry - stop) * rr : entry - Math.abs(entry - stop) * rr
          openTrade = { id: totalTrades + 1, side, entry, stop, target, entryIndex: index, date: dateLabel(bar.time) }
        }
      }
      previousFast = fastNow
      previousSlow = slowNow
    }

    const flushAggregate = () => {
      if (aggregateBar) processBar(aggregateBar)
      aggregateBar = null
    }

    const processLine = (rawLine: string) => {
      const line = rawLine.trim()
      if (!line) return
      if (!header) {
        const clean = line.replace(/^\uFEFF/, '')
        delimiter = [',', ';', '\t'].map(d => ({ d, n: clean.split(d).length })).sort((a, b) => b.n - a.n)[0].d
        header = clean.split(delimiter).map(x => x.trim().replace(/[<>"]/g, '').toUpperCase())
        const find = (...names: string[]) => header!.findIndex(h => names.includes(h))
        dateIdx = find('DTYYYYMMDD', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME')
        timeIdx = header.includes('TIME') && header[dateIdx] !== 'TIME' ? header.indexOf('TIME') : -1
        oi = find('OPEN'); hi = find('HIGH'); li = find('LOW'); ci = find('CLOSE')
        vi = find('VOL', 'VOLUME', 'TICKVOL', 'TICKVOLUME')
        if ([oi, hi, li, ci].some(i => i < 0) || dateIdx < 0) throw new Error('CSV headers must include DATE/TIME and OPEN, HIGH, LOW, CLOSE.')
        return
      }
      const cells = line.split(delimiter).map(x => x.trim().replace(/^"|"$/g, ''))
      const timestamp = parseTimestamp(cells[dateIdx] ?? '', timeIdx >= 0 ? (cells[timeIdx] ?? '') : '')
      const open = Number(cells[oi]), high = Number(cells[hi]), low = Number(cells[li]), close = Number(cells[ci])
      if (timestamp === null || timestamp <= 0 || ![open, high, low, close].every(Number.isFinite) || high < low || high < Math.max(open, close) || low > Math.min(open, close)) return
      if (timestamp < lastTimestamp) throw new Error('CSV rows are not chronological. Sort the file by date/time and upload it again.')
      lastTimestamp = timestamp
      rawCount++
      const volume = vi >= 0 ? Number(cells[vi]) : 0
      const candle: Bar = { time: timestamp, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 }
      const key = Math.floor(timestamp / timeframeSec)
      if (bucket !== key) {
        flushAggregate()
        bucket = key
        aggregateBar = { ...candle, time: key * timeframeSec }
      } else if (aggregateBar) {
        aggregateBar.high = Math.max(aggregateBar.high, candle.high)
        aggregateBar.low = Math.min(aggregateBar.low, candle.low)
        aggregateBar.close = candle.close
        aggregateBar.volume = (aggregateBar.volume ?? 0) + (candle.volume ?? 0)
      }
    }

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          processLine(buffer.slice(0, newline).replace(/\r$/, ''))
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) processLine(buffer)
      flushAggregate()
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }

    if (!header || rawCount === 0 || barCount === 0) return Response.json({ error: 'No valid OHLC candles found in this CSV.' }, { status: 422 })
    if (openTrade && barCount) closeTrade(aggregateBar?.close ?? preview[(preview.length - 1)].close, barCount - 1)

    const sortedTrades = previewFull ? [...tradeRows.slice(tradeCursor), ...tradeRows.slice(0, tradeCursor)] : tradeRows
    const chartBars = previewFull ? [...preview.slice(previewCursor), ...preview.slice(0, previewCursor)] : preview
    const grossLossSafe = grossLoss
    return Response.json({
      candles: chartBars,
      rawCandles: rawCount,
      chartBars: barCount,
      previewLimit: 5000,
      trades: sortedTrades,
      summary: {
        totalTrades, wins, losses, netR, grossWin, grossLoss: grossLossSafe,
        profitFactor: grossLossSafe ? grossWin / grossLossSafe : grossWin ? null : 0,
        winRate: totalTrades ? wins / totalTrades * 100 : 0,
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not process the private CSV'
    return Response.json({ error: message }, { status: 500 })
  }
}
