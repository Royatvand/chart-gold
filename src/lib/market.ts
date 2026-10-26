import type { UTCTimestamp } from 'lightweight-charts'

export type Candle = { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume?: number }
export type Side = 'LONG' | 'SHORT'
export type Trade = { id: number; side: Side; entry: number; stop: number; target: number; exit: number; result: 'WIN' | 'LOSS' | 'OPEN'; r: number; entryIndex: number; entryTime?: number; exitIndex?: number; date: string }
export type ClosedTrade = Trade & { result: 'WIN' | 'LOSS' }
export type SymbolInfo = { symbol: string; name: string; group: string; base: number; digits: number; seed: number; color: string }
export type Timeframe = { label: string; sec: number }

export const SYMBOLS: SymbolInfo[] = [
  { symbol: 'XAUUSD', name: 'Gold / U.S. Dollar', group: 'METALS', base: 3972, digits: 2, seed: 17, color: '#d4a72c' },
  { symbol: 'XAGUSD', name: 'Silver / U.S. Dollar', group: 'METALS', base: 32.5, digits: 3, seed: 31, color: '#9ca3af' },
  { symbol: 'EURUSD', name: 'Euro / U.S. Dollar', group: 'FOREX', base: 1.085, digits: 5, seed: 43, color: '#2962ff' },
  { symbol: 'GBPUSD', name: 'British Pound / U.S. Dollar', group: 'FOREX', base: 1.27, digits: 5, seed: 59, color: '#7c83ff' },
  { symbol: 'USDJPY', name: 'U.S. Dollar / Japanese Yen', group: 'FOREX', base: 149.5, digits: 3, seed: 71, color: '#ef5350' },
  { symbol: 'AUDUSD', name: 'Australian Dollar / U.S. Dollar', group: 'FOREX', base: 0.655, digits: 5, seed: 89, color: '#26a69a' },
  { symbol: 'BTCUSD', name: 'Bitcoin / U.S. Dollar', group: 'CRYPTO', base: 67420, digits: 2, seed: 101, color: '#f7931a' },
  { symbol: 'ETHUSD', name: 'Ethereum / U.S. Dollar', group: 'CRYPTO', base: 3520, digits: 2, seed: 113, color: '#8c9eff' },
  { symbol: 'BTCIRT', name: 'Bitcoin / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 127, color: '#f7931a' },
  { symbol: 'ETHIRT', name: 'Ethereum / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 131, color: '#8c9eff' },
  { symbol: 'USDTIRT', name: 'Tether / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 137, color: '#26a69a' },
  { symbol: 'LTCIRT', name: 'Litecoin / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 139, color: '#9ca3af' },
  { symbol: 'XRPIRT', name: 'XRP / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 149, color: '#78909c' },
  { symbol: 'DOGEIRT', name: 'Dogecoin / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 151, color: '#d4a72c' },
  { symbol: 'TRXIRT', name: 'TRON / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 157, color: '#ef5350' },
  { symbol: 'ADAIRT', name: 'Cardano / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 163, color: '#2962ff' },
  { symbol: 'BNBIRT', name: 'BNB / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 167, color: '#f0b90b' },
  { symbol: 'SOLIRT', name: 'Solana / Iranian Toman', group: 'NOBITEX', base: 0, digits: 0, seed: 173, color: '#8c9eff' },
  { symbol: 'BTCUSDT', name: 'Bitcoin / Tether', group: 'NOBITEX', base: 0, digits: 2, seed: 179, color: '#f7931a' },
  { symbol: 'ETHUSDT', name: 'Ethereum / Tether', group: 'NOBITEX', base: 0, digits: 2, seed: 181, color: '#8c9eff' },
  { symbol: 'USOIL', name: 'Crude Oil', group: 'ENERGIES', base: 72.18, digits: 2, seed: 127, color: '#78909c' },
  { symbol: 'NAS100', name: 'Nasdaq 100', group: 'INDICES', base: 19850, digits: 2, seed: 139, color: '#42a5f5' },
]

// These symbols use real OHLC candles from Nobitex instead of generated demo data.
export const NOBITEX_SYMBOLS: Record<string, string> = {
  BTCIRT: 'BTCIRT',
  ETHIRT: 'ETHIRT',
  USDTIRT: 'USDTIRT',
  LTCIRT: 'LTCIRT',
  XRPIRT: 'XRPIRT',
  DOGEIRT: 'DOGEIRT',
  TRXIRT: 'TRXIRT',
  ADAIRT: 'ADAIRT',
  BNBIRT: 'BNBIRT',
  SOLIRT: 'SOLIRT',
  BTCUSDT: 'BTCUSDT',
  ETHUSDT: 'ETHUSDT',
}

export const TIMEFRAMES: Timeframe[] = [
  { label: '1m', sec: 60 }, { label: '3m', sec: 180 }, { label: '5m', sec: 300 },
  { label: '15m', sec: 900 }, { label: '30m', sec: 1800 }, { label: '1h', sec: 3600 },
  { label: '2h', sec: 7200 }, { label: '4h', sec: 14400 }, { label: '1D', sec: 86400 },
  { label: '1W', sec: 604800 },
]

export const fmt = (n: number, digits = 2) => Number.isFinite(n)
  ? n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '—'

export const dateLabel = (t?: number) => t !== undefined && Number.isFinite(Number(t))
  ? new Date(Number(t) * 1000).toISOString().replace('T', ' ').slice(0, 16)
  : '—'

export function genDemo(info: SymbolInfo, baseSec = 900, length = 700): Candle[] {
  const now = Math.floor(Date.now() / 1000 / baseSec) * baseSec
  const start = now - (length - 1) * baseSec
  const phaseStep = baseSec / 900 // keep the waves identical in real time whatever the base timeframe is
  const result: Candle[] = []
  let previous = info.base
  for (let i = 0; i < length; i++) {
    const ph = i * phaseStep
    const wave = Math.sin((ph + info.seed) * 0.13) * info.base * 0.0018
      + Math.sin((ph + info.seed) * 0.037) * info.base * 0.0032
      + Math.sin((ph + info.seed) * 0.41) * info.base * 0.00045
    const drift = Math.sin((ph + info.seed) * 0.009) * info.base * 0.0015
    const hash = Math.sin(i * 12.9898 + info.seed) * 43758.5453
    const noise = baseSec < 900 ? (hash - Math.floor(hash) - 0.5) * info.base * 0.0005 * Math.sqrt(phaseStep) : 0
    const close = Math.max(info.base * 0.0001, info.base + wave + drift + noise)
    const open = previous
    const spread = Math.max(info.base * (info.digits >= 4 ? 0.00006 : 0.00045) * Math.sqrt(Math.min(1, phaseStep * 4)), Math.abs(close - open) * 0.65)
    const high = Math.max(open, close) + spread * (0.6 + Math.abs(Math.sin(i * 1.7)) * 0.8)
    const low = Math.min(open, close) - spread * (0.6 + Math.abs(Math.cos(i * 1.3)) * 0.8)
    const scale = 10 ** info.digits
    result.push({
      time: (start + i * baseSec) as UTCTimestamp,
      open: Math.round(open * scale) / scale,
      high: Math.round(high * scale) / scale,
      low: Math.round(low * scale) / scale,
      close: Math.round(close * scale) / scale,
      volume: Math.round(100 + Math.abs(Math.sin(i * 0.21)) * 2500),
    })
    previous = close
  }
  return result
}

export function detectBaseSec(candles: Candle[]): number {
  if (candles.length < 2) return 900
  const diffs: number[] = []
  const start = Math.max(1, candles.length - 1000)
  for (let i = start; i < candles.length; i++) {
    const d = Number(candles[i].time) - Number(candles[i - 1].time)
    if (d > 0 && d <= 31 * 86400) diffs.push(d)
  }
  if (!diffs.length) return 900
  diffs.sort((a, b) => a - b)
  return Math.max(1, diffs[Math.floor(diffs.length / 2)])
}

export function tfForBase(sec: number): string {
  if (sec <= 60) return '1m'
  if (sec <= 180) return '3m'
  if (sec <= 300) return '5m'
  if (sec <= 900) return '15m'
  if (sec <= 1800) return '30m'
  if (sec <= 3600) return '1h'
  if (sec <= 14400) return '4h'
  if (sec <= 86400) return '1D'
  return '1W'
}

export function inferDigits(candles: Candle[]): number {
  let max = 0
  const sampleStart = Math.max(0, candles.length - 5000)
  for (let i = sampleStart; i < candles.length; i++) {
    const n = candles[i].close
    if (!Number.isFinite(n)) continue
    const text = n.toString()
    const dot = text.indexOf('.')
    if (dot >= 0) max = Math.max(max, text.length - dot - 1)
    if (max >= 8) return 8
  }
  return Math.min(8, max)
}

export function aggregate(candles: Candle[], timeframeSec: number, baseSec: number): Candle[] {
  if (!candles.length) return []
  if (timeframeSec <= baseSec) return candles
  const out: Candle[] = []
  let bucket = -1
  let current: Candle | null = null
  for (const c of candles) {
    const key = Math.floor(Number(c.time) / timeframeSec)
    if (key !== bucket) {
      if (current) out.push(current)
      bucket = key
      current = { ...c, time: (key * timeframeSec) as UTCTimestamp }
    } else if (current) {
      current.high = Math.max(current.high, c.high)
      current.low = Math.min(current.low, c.low)
      current.close = c.close
      current.volume = (current.volume ?? 0) + (c.volume ?? 0)
    }
  }
  if (current) out.push(current)
  return out
}

export function indexByTime(candles: Candle[], time: number): number {
  let low = 0, high = candles.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    const t = Number(candles[mid].time)
    if (t === time) return mid
    if (t < time) low = mid + 1
    else high = mid - 1
  }
  return Math.max(0, Math.min(candles.length - 1, high))
}

export function smaLine(candles: Candle[], period: number): { time: UTCTimestamp; value: number }[] {
  const result: { time: UTCTimestamp; value: number }[] = []
  if (period < 1) return result
  let total = 0
  for (let i = 0; i < candles.length; i++) {
    total += candles[i].close
    if (i >= period) total -= candles[i - period].close
    if (i >= period - 1) result.push({ time: candles[i].time, value: total / period })
  }
  return result
}

function parseTimestamp(dateText: string, timeText: string): number | null {
  const d = dateText.trim().replace(/^"|"$/g, '')
  const tm = timeText.trim().replace(/^"|"$/g, '')
  if (!d) return null
  if (/^\d{8}$/.test(d)) {
    const normalizedTime = tm ? tm.replace(/[^\d]/g, '').padStart(6, '0') : '000000'
    const hh = Number(normalizedTime.slice(0, 2)), mm = Number(normalizedTime.slice(2, 4)), ss = Number(normalizedTime.slice(4, 6))
    const ms = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)), hh, mm, ss)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }
  const n = Number(d)
  if (/^\d+(\.\d+)?$/.test(d) && Number.isFinite(n)) {
    if (n > 1e12) return Math.floor(n / 1000)
    if (n > 1e9) return Math.floor(n)
  }
  const joined = tm ? `${d} ${tm}` : d
  const parsed = Date.parse(joined)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

export async function parseCsvFile(file: File, onProgress: (percent: number) => void): Promise<Candle[]> {
  if (!file.size) throw new Error('فایل خالی است.')
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  const result: Candle[] = []
  let buffer = ''
  let header: string[] | null = null
  let delimiter = ','
  let dateIdx = -1, timeIdx = -1, oi = -1, hi = -1, li = -1, ci = -1, vi = -1
  let bytesRead = 0
  let lastReported = -1
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
      if ([oi, hi, li, ci].some(i => i < 0) || dateIdx < 0) {
        throw new Error('ستون‌های DATE/TIME و OPEN, HIGH, LOW, CLOSE در فایل پیدا نشدند.')
      }
      return
    }
    const cells = line.split(delimiter).map(x => x.trim().replace(/^"|"$/g, ''))
    const timestamp = parseTimestamp(cells[dateIdx] ?? '', timeIdx >= 0 ? (cells[timeIdx] ?? '') : '')
    const open = Number(cells[oi]), high = Number(cells[hi]), low = Number(cells[li]), close = Number(cells[ci])
    if (timestamp === null || timestamp <= 0 || ![open, high, low, close].every(Number.isFinite) || high < low || high < Math.max(open, close) || low > Math.min(open, close)) return
    const volume = vi >= 0 ? Number(cells[vi]) : 0
    result.push({ time: Math.floor(timestamp) as UTCTimestamp, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 })
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        processLine(buffer.slice(0, newline).replace(/\r$/, ''))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
      const percent = Math.min(99, Math.floor(bytesRead / Math.max(file.size, 1) * 100))
      if (percent !== lastReported) { lastReported = percent; onProgress(percent) }
    }
    buffer += decoder.decode()
    if (buffer.trim()) processLine(buffer)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  if (!header) throw new Error('CSV باید سطر عنوان و حداقل یک کندل داشته باشد.')
  if (!result.length) throw new Error('هیچ کندل معتبر OHLC پیدا نشد.')
  let ordered = true
  for (let i = 1; i < result.length; i++) {
    if (Number(result[i].time) < Number(result[i - 1].time)) { ordered = false; break }
  }
  if (!ordered) result.sort((a, b) => Number(a.time) - Number(b.time))
  let write = 0
  for (let read = 0; read < result.length; read++) {
    if (write === 0 || result[read].time !== result[write - 1].time) result[write++] = result[read]
  }
  result.length = write
  onProgress(100)
  return result
}

function smaAt(values: number[], period: number, index: number): number {
  if (period < 1 || index + 1 < period) return Number.NaN
  let total = 0
  for (let i = index - period + 1; i <= index; i++) total += values[i]
  return total / period
}

export function runBacktest(candles: Candle[], fastPeriod: number, slowPeriod: number, rr: number, riskPct: number, commission: number): ClosedTrade[] {
  if (candles.length < Math.max(fastPeriod, slowPeriod) + 2) return []
  const trades: ClosedTrade[] = []
  const closes = candles.map(c => c.close)
  let open: Trade | null = null
  let id = 1
  for (let i = Math.max(slowPeriod, 2); i < candles.length; i++) {
    const c = candles[i]
    if (open) {
      const stopHit = open.side === 'LONG' ? c.low <= open.stop : c.high >= open.stop
      const targetHit = open.side === 'LONG' ? c.high >= open.target : c.low <= open.target
      if (stopHit || targetHit) {
        const exit = stopHit ? open.stop : open.target
        const rawR = (open.side === 'LONG' ? exit - open.entry : open.entry - exit) / Math.abs(open.entry - open.stop)
        const netR = rawR - Math.max(0, commission)
        trades.push({ ...open, exit, result: netR > 0 ? 'WIN' : 'LOSS', r: netR, exitIndex: i })
        open = null
      }
    }
    const fastNow = smaAt(closes, fastPeriod, i), slowNow = smaAt(closes, slowPeriod, i)
    const fastPrev = smaAt(closes, fastPeriod, i - 1), slowPrev = smaAt(closes, slowPeriod, i - 1)
    if (!open && Number.isFinite(fastPrev) && Number.isFinite(slowPrev)) {
      const side: Side | null = fastPrev <= slowPrev && fastNow > slowNow ? 'LONG'
        : fastPrev >= slowPrev && fastNow < slowNow ? 'SHORT' : null
      if (side) {
        const range = Math.max(c.high - c.low, Math.abs(c.close - c.open), c.close * .0008)
        const entry = c.close
        const stop = side === 'LONG' ? entry - range * 1.6 : entry + range * 1.6
        const target = side === 'LONG' ? entry + Math.abs(entry - stop) * rr : entry - Math.abs(entry - stop) * rr
        open = { id: id++, side, entry, stop, target, exit: entry, result: 'OPEN', r: 0, entryIndex: i, date: dateLabel(c.time) }
      }
    }
  }
  if (open) {
    const exit = candles[candles.length - 1].close
    const netR = (open.side === 'LONG' ? exit - open.entry : open.entry - exit) / Math.abs(open.entry - open.stop) - Math.max(0, commission)
    trades.push({ ...open, exit, result: netR > 0 ? 'WIN' : 'LOSS', r: netR, exitIndex: candles.length - 1 })
  }
  return trades
}
