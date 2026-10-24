import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { upload as uploadBlob } from '@vercel/blob/client'
import {
  createChart, AreaSeries, BarSeries, CandlestickSeries, LineSeries, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type SeriesType, type UTCTimestamp,
} from 'lightweight-charts'
import {
  Activity, AlarmClock, AreaChart, Bell, Camera, Check, ChevronDown, ChevronUp, CircleHelp, Crosshair, Download, Ellipsis,
  Eye, EyeOff, FileUp, FlaskConical, Info, LineChart, List, Lock, Magnet, Maximize, Minus, MousePointer2, Pause, Pencil,
  Play, Plus, Redo2, Rewind, Ruler, Search, Settings, SkipForward, Smile, StepForward, Trash2, TrendingDown, TrendingUp,
  Type, Undo2, Upload, X, ZoomIn, ZoomOut, Layers, type LucideIcon,
} from 'lucide-react'
import {
  SYMBOLS, TIMEFRAMES, aggregate, dateLabel, detectBaseSec, fmt, genDemo, indexByTime, inferDigits, parseCsvFile,
  runBacktest, smaLine, tfForBase, type Candle, type ClosedTrade, type Side, type SymbolInfo, type Trade,
} from './lib/market'

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif'
const DAY = 86400
const RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'All']
const RANGE_SEC: Record<string, number> = { '1D': DAY, '5D': 5 * DAY, '1M': 30 * DAY, '3M': 91 * DAY, '6M': 182 * DAY, '1Y': 365 * DAY }
const SPEEDS = [{ label: '10x', ms: 100 }, { label: '7x', ms: 143 }, { label: '5x', ms: 200 }, { label: '3x', ms: 333 }, { label: '1x', ms: 1000 }, { label: '0.5x', ms: 2000 }, { label: '0.3x', ms: 3333 }]
const QUICK_TF = ['5m', '15m', '1h', '4h', '1D']
type ChartType = 'candles' | 'bars' | 'line' | 'area'
type Replay = { active: boolean; selecting: boolean; playing: boolean; speed: number }
type SidePanel = 'watchlist' | 'alerts' | 'data' | null

const CandlesIcon = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 2v3M5 12v4M13 1v4M13 11v5"/><rect x="3" y="5" width="4" height="7" rx=".5"/><rect x="11" y="5" width="4" height="6" rx=".5"/></svg>
const BarsIcon = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 2v14M2.5 5H5M5 12h2.5M13 1v14M10.5 4H13M13 10h2.5"/></svg>
const CHART_TYPES: { id: ChartType; label: string; Icon: (p: { size?: number }) => ReactElement }[] = [
  { id: 'candles', label: 'Candles', Icon: CandlesIcon },
  { id: 'bars', label: 'Bars', Icon: BarsIcon },
  { id: 'line', label: 'Line', Icon: ({ size }) => <LineChart size={size} /> },
  { id: 'area', label: 'Area', Icon: ({ size }) => <AreaChart size={size} /> },
]

type ToolDef = { name: string; Icon: LucideIcon; impl?: boolean; action?: 'zoomIn' | 'zoomOut' | 'hide' }
const TOOL_GROUPS: ToolDef[][] = [
  [{ name: 'Crosshair', Icon: Crosshair, impl: true }, { name: 'Cursor', Icon: MousePointer2, impl: true }],
  [{ name: 'Trend line', Icon: TrendingUp }, { name: 'Horizontal line', Icon: Minus, impl: true }, { name: 'Fib retracement', Icon: Layers }],
  [{ name: 'Brush', Icon: Pencil }, { name: 'Text', Icon: Type }, { name: 'Icon', Icon: Smile }],
  [{ name: 'Measure', Icon: Ruler }, { name: 'Zoom in', Icon: ZoomIn, impl: true, action: 'zoomIn' }, { name: 'Zoom out', Icon: ZoomOut, impl: true, action: 'zoomOut' }],
  [{ name: 'Magnet mode', Icon: Magnet }, { name: 'Lock all drawings', Icon: Lock }, { name: 'Hide all drawings', Icon: Eye, impl: true, action: 'hide' }],
]

const dayStats = (arr: Candle[], endIdx: number, n: number) => {
  const lastC = arr[Math.max(0, endIdx)]
  const ref = arr[Math.max(0, endIdx - n)]
  if (!lastC || !ref) return { last: 0, chg: 0, pct: 0 }
  const chg = lastC.close - ref.close
  return { last: lastC.close, chg, pct: ref.close ? chg / ref.close * 100 : 0 }
}
const sgn = (n: number) => (n >= 0 ? '+' : '−')

function App() {
  const rootRef = useRef<HTMLElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const indicatorRefs = useRef<ISeriesApi<'Line'>[]>([])
  const fitRef = useRef<Candle[] | null>(null)
  const demos = useMemo(() => Object.fromEntries(SYMBOLS.map(s => [s.symbol, genDemo(s)])) as Record<string, Candle[]>, [])

  const [candles, setCandles] = useState<Candle[]>(demos['XAUUSD'])
  const [fileName, setFileName] = useState('')
  const [symbol, setSymbol] = useState('XAUUSD')
  const [timeframe, setTimeframe] = useState('15m')
  const [chartType, setChartType] = useState<ChartType>('candles')
  const [visibleCount, setVisibleCount] = useState(candles.length)
  const [replay, setReplay] = useState<Replay>({ active: false, selecting: false, playing: false, speed: 4 })
  const [menu, setMenu] = useState<string | null>(null)
  const [symbolDialog, setSymbolDialog] = useState(false)
  const [query, setQuery] = useState('')
  const [tool, setTool] = useState('Crosshair')
  const [drawings, setDrawings] = useState<number[]>([])
  const [redo, setRedo] = useState<number[]>([])
  const [hideDrawings, setHideDrawings] = useState(false)
  const [indicators, setIndicators] = useState({ fast: false, slow: false })
  const [indicatorSearch, setIndicatorSearch] = useState('')
  const [seriesVersion, setSeriesVersion] = useState(0)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [panel, setPanel] = useState<SidePanel>('watchlist')
  const [bottomOpen, setBottomOpen] = useState(false)
  const [bottomTab, setBottomTab] = useState<'tester' | 'trading'>('tester')
  const [testerTab, setTesterTab] = useState<'overview' | 'trades' | 'settings'>('overview')
  const [notice, setNotice] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importProgress, setImportProgress] = useState<number | null>(null)
  const [blobUploadProgress, setBlobUploadProgress] = useState<number | null>(null)
  const [uploadKey, setUploadKey] = useState('')
  const [storedBlob, setStoredBlob] = useState<{ pathname: string; size: number; url: string } | null>(null)
  const [cloudProcessing, setCloudProcessing] = useState(false)
  const [cloudSummary, setCloudSummary] = useState<{ totalTrades: number; wins: number; losses: number; netR: number; grossWin: number; grossLoss: number; profitFactor: number | null; winRate: number } | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [fastPeriod, setFastPeriod] = useState('9')
  const [slowPeriod, setSlowPeriod] = useState('21')
  const [rr, setRr] = useState('2')
  const [riskPct, setRiskPct] = useState('1')
  const [commission, setCommission] = useState('0')
  const [testResults, setTestResults] = useState<ClosedTrade[] | null>(null)

  const isDemo = fileName === ''
  const info: SymbolInfo = SYMBOLS.find(s => s.symbol === symbol) ?? { symbol, name: symbol, group: 'CUSTOM', base: 0, digits: 2, seed: 0, color: '#2962ff' }
  const digits = useMemo(() => (isDemo ? info.digits : inferDigits(candles)), [isDemo, info.digits, candles])
  const baseSec = useMemo(() => detectBaseSec(candles), [candles])
  const tfSec = TIMEFRAMES.find(t => t.label === timeframe)?.sec ?? 900
  const data = useMemo(() => aggregate(candles, tfSec, baseSec), [candles, tfSec, baseSec])
  // Keep chart rendering bounded: only the most recent 5,000 bars up to the replay cursor are sent to the chart.
  const shown = useMemo(() => {
    const end = Math.max(1, Math.min(visibleCount, data.length))
    return data.slice(Math.max(0, end - 5000), end)
  }, [data, visibleCount])
  const legendIdx = hoverIdx !== null && hoverIdx < shown.length ? hoverIdx : shown.length - 1
  const bar = shown[legendIdx]
  const barPrev = shown[legendIdx - 1]
  const barChg = bar && barPrev ? bar.close - barPrev.close : 0
  const barPct = barPrev?.close ? barChg / barPrev.close * 100 : 0
  const barUp = bar ? bar.close >= bar.open : true
  const last = shown[shown.length - 1]
  const dayN = Math.max(1, Math.round(DAY / Math.max(tfSec, baseSec)))
  const activeStats = dayStats(shown, shown.length - 1, dayN)

  const closed = testResults ?? (trades.filter(t => t.result !== 'OPEN') as ClosedTrade[])
  const wins = cloudSummary?.wins ?? closed.filter(t => t.r > 0).length
  const losses = cloudSummary?.losses ?? Math.max(0, closed.length - closed.filter(t => t.r > 0).length)
  const netR = cloudSummary?.netR ?? closed.reduce((sum, t) => sum + t.r, 0)
  const grossWin = cloudSummary?.grossWin ?? closed.filter(t => t.r > 0).reduce((sum, t) => sum + t.r, 0)
  const grossLoss = cloudSummary?.grossLoss ?? Math.abs(closed.filter(t => t.r < 0).reduce((sum, t) => sum + t.r, 0))
  const totalTrades = cloudSummary?.totalTrades ?? closed.length
  const profitFactor = cloudSummary ? (cloudSummary.profitFactor === null ? Infinity : cloudSummary.profitFactor) : grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0

  // Refs mirror state for chart event handlers that are subscribed once.
  const toolRef = useRef(tool); toolRef.current = tool
  const selectingRef = useRef(replay.selecting); selectingRef.current = replay.selecting
  const dataRef = useRef(data); dataRef.current = data
  const shownRef = useRef(shown); shownRef.current = shown

  /* ---------- chart lifecycle ---------- */
  useEffect(() => {
    if (!host.current) return
    const axisFont = { fontFamily: FONT, fontSize: 12 }
    const chart = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#b2b5be', ...axisFont },
      grid: { vertLines: { color: '#1f2330' }, horzLines: { color: '#1f2330' } },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: .08, bottom: .08 } },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 8, minBarSpacing: .4 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#9598a1', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#363a45' },
        horzLine: { color: '#9598a1', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#363a45' },
      },
    })
    chartRef.current = chart
    fitRef.current = null
    chart.subscribeCrosshairMove(param => {
      if (param.time === undefined) { setHoverIdx(null); return }
      const idx = indexByTime(shownRef.current, Number(param.time))
      setHoverIdx(prev => (prev === idx ? prev : idx >= 0 ? idx : null))
    })
    chart.subscribeClick(param => {
      if (!param.point || param.time === undefined) return
      if (selectingRef.current) {
        const idx = indexByTime(dataRef.current, Number(param.time))
        if (idx >= 0) { setVisibleCount(idx + 1); setReplay(r => ({ ...r, selecting: false })) }
        return
      }
      if (toolRef.current === 'Horizontal line' && seriesRef.current) {
        const price = seriesRef.current.coordinateToPrice(param.point.y)
        if (price !== null) { setDrawings(d => [...d, Number(price)]); setRedo([]) }
      }
    })
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; indicatorRefs.current = [] }
  }, [])

  // (Re)create the main series when the chart type or price precision changes.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const priceFormat = { type: 'price' as const, precision: digits, minMove: 1 / 10 ** digits }
    let s: ISeriesApi<SeriesType>
    if (chartType === 'bars') s = chart.addSeries(BarSeries, { upColor: '#089981', downColor: '#f23645', priceFormat })
    else if (chartType === 'line') s = chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, priceFormat })
    else if (chartType === 'area') s = chart.addSeries(AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,.28)', bottomColor: 'rgba(41,98,255,0)', lineWidth: 2, priceFormat })
    else s = chart.addSeries(CandlestickSeries, { upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645', priceFormat })
    seriesRef.current = s
    setSeriesVersion(v => v + 1)
    return () => {
      if (chartRef.current === chart) { try { chart.removeSeries(s) } catch { /* chart already disposed */ } }
      seriesRef.current = null
    }
  }, [chartType, digits])

  useEffect(() => {
    const s = seriesRef.current, chart = chartRef.current
    if (!s || !chart) return
    if (chartType === 'line' || chartType === 'area') (s as ISeriesApi<'Line'>).setData(shown.map(c => ({ time: c.time, value: c.close })))
    else (s as ISeriesApi<'Candlestick'>).setData(shown)
    if (fitRef.current !== data) { fitRef.current = data; chart.timeScale().fitContent() }
    else if (replay.playing) chart.timeScale().scrollToRealTime()
  }, [shown, chartType, seriesVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // SMA overlays driven by the Indicators menu.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const made: ISeriesApi<'Line'>[] = []
    const add = (period: number, color: string) => {
      const l = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
      l.setData(smaLine(shown, period)); made.push(l)
    }
    if (indicators.fast) add(Number(fastPeriod) || 9, '#2962ff')
    if (indicators.slow) add(Number(slowPeriod) || 21, '#ff9800')
    indicatorRefs.current = made
    return () => { if (chartRef.current === chart) made.forEach(l => { try { chart.removeSeries(l) } catch { /* disposed */ } }) }
  }, [indicators, fastPeriod, slowPeriod, shown, seriesVersion])

  // Horizontal-line drawings.
  useEffect(() => {
    const s = seriesRef.current
    if (!s || hideDrawings) return
    const lines: IPriceLine[] = drawings.map(price => s.createPriceLine({ price, color: '#2962ff', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }))
    return () => lines.forEach(l => { try { s.removePriceLine(l) } catch { /* series gone */ } })
  }, [drawings, hideDrawings, seriesVersion])

  /* ---------- data / replay lifecycle ---------- */
  useEffect(() => {
    setVisibleCount(data.length)
    setReplay(r => (r.active ? { ...r, active: false, selecting: false, playing: false } : r))
  }, [data])
  useEffect(() => {
    if (!replay.playing) return
    const id = window.setInterval(() => setVisibleCount(v => Math.min(v + 1, data.length)), SPEEDS[replay.speed].ms)
    return () => window.clearInterval(id)
  }, [replay.playing, replay.speed, data.length])
  useEffect(() => {
    if (replay.playing && visibleCount >= data.length) setReplay(r => ({ ...r, playing: false }))
  }, [replay.playing, visibleCount, data.length])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-menu]')) setMenu(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  /* ---------- actions ---------- */
  const toggleMenu = (id: string) => setMenu(m => (m === id ? null : id))
  const selectSymbol = (sym: string) => {
    setSymbol(sym); setSymbolDialog(false); setQuery(''); setMenu(null)
    if (isDemo && demos[sym]) { setCandles(demos[sym]); setDrawings([]); setRedo([]) }
  }
  const submitSymbolQuery = () => {
    const q = query.trim().toUpperCase()
    if (!q) return
    const exact = SYMBOLS.find(s => s.symbol === q)
    if (exact) return selectSymbol(exact.symbol)
    if (!isDemo) { setSymbol(q.slice(0, 12)); setSymbolDialog(false); setQuery('') }
    else setNotice('این نماد در دیتای نمونه وجود ندارد. یک فایل CSV وارد کن تا برچسب دلخواه استفاده شود.')
  }
  const toggleReplay = () => {
    if (replay.active) { setReplay(r => ({ ...r, active: false, selecting: false, playing: false })); setVisibleCount(data.length) }
    else setReplay({ active: true, selecting: true, playing: false, speed: 4 })
  }
  const replayPlay = () => {
    if (replay.selecting) { setReplay(r => ({ ...r, selecting: false })) }
    if (visibleCount >= data.length) { setNotice('برای شروع Replay، روی «Select bar» بزن و یک کندل قدیمی‌تر را انتخاب کن.'); return }
    setReplay(r => ({ ...r, selecting: false, playing: !r.playing }))
  }
  const replayStep = () => { setReplay(r => ({ ...r, playing: false, selecting: false })); setVisibleCount(v => Math.min(v + 1, data.length)) }
  const zoom = (factor: number) => {
    const ts = chartRef.current?.timeScale(); const r = ts?.getVisibleLogicalRange()
    if (ts && r) ts.setVisibleLogicalRange({ from: r.to - (r.to - r.from) * factor, to: r.to })
  }
  const setRange = (key: string) => {
    const chart = chartRef.current
    if (!chart || !shown.length) return
    if (key === 'All') { chart.timeScale().fitContent(); return }
    const lastT = Number(shown[shown.length - 1].time), firstT = Number(shown[0].time)
    const secs = key === 'YTD' ? lastT - Date.UTC(new Date(lastT * 1000).getUTCFullYear(), 0, 1) / 1000 : RANGE_SEC[key]
    try { chart.timeScale().setVisibleRange({ from: Math.max(firstT, lastT - secs) as UTCTimestamp, to: lastT as UTCTimestamp }) } catch { chart.timeScale().fitContent() }
  }
  const pickTool = (t: ToolDef) => {
    if (t.action === 'zoomIn') return zoom(.7)
    if (t.action === 'zoomOut') return zoom(1.4)
    if (t.action === 'hide') { setHideDrawings(v => !v); return }
    if (!t.impl) { setNotice(`ابزار «${t.name}» هنوز پیاده‌سازی نشده است؛ فعلاً Crosshair، Cursor و Horizontal line فعال‌اند.`); return }
    setTool(t.name)
  }
  const undo = () => setDrawings(d => { if (!d.length) return d; setRedo(r => [...r, d[d.length - 1]]); return d.slice(0, -1) })
  const redoDraw = () => setRedo(r => { if (!r.length) return r; setDrawings(d => [...d, r[r.length - 1]]); return r.slice(0, -1) })
  const screenshot = () => {
    const canvas = chartRef.current?.takeScreenshot()
    canvas?.toBlob(b => { if (!b) return; const url = URL.createObjectURL(b); const a = document.createElement('a'); a.href = url; a.download = `${symbol}-${timeframe}.png`; a.click(); URL.revokeObjectURL(url) })
  }
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void rootRef.current?.requestFullscreen?.() }

  const uploadFileToBlob = useCallback(async (file?: File) => {
    if (!file) return
    if (!uploadKey.trim()) { setNotice('برای آپلود خصوصی، کلید آپلود را وارد کن.'); return }
    setBlobUploadProgress(0)
    try {
      const blob = await uploadBlob(file.name, file, {
        access: 'private', handleUploadUrl: '/api/blob-upload', clientPayload: uploadKey.trim(), multipart: true,
        contentType: file.type || 'application/octet-stream',
        onUploadProgress: ({ percentage }) => setBlobUploadProgress(Math.round(percentage)),
      })
      const uploaded = { pathname: blob.pathname, size: file.size, url: blob.url }
      setStoredBlob(uploaded)
      setCloudSummary(null); setTestResults(null)
      setCloudProcessing(true)
      try {
        const response = await fetch('/api/blob-process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-upload-key': uploadKey.trim() },
          body: JSON.stringify({ pathname: uploaded.pathname, timeframeSec: tfSec, fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod), rr: Number(rr), riskPct: Number(riskPct), commission: Number(commission) }),
        })
        const payload = await response.json() as { error?: string; candles?: Candle[]; rawCandles?: number; chartBars?: number; trades?: ClosedTrade[]; summary?: { totalTrades: number; wins: number; losses: number; netR: number; grossWin: number; grossLoss: number; profitFactor: number | null; winRate: number } }
        if (!response.ok || !payload.candles || !payload.summary || !payload.trades) throw new Error(payload.error || 'Cloud CSV processing failed')
        setCandles(payload.candles)
        setFileName(file.name)
        setVisibleCount(payload.candles.length)
        setCloudSummary(payload.summary)
        setTestResults(payload.trades)
        setTrades([])
        setDrawings([])
        setRedo([])
        setTesterTab('overview')
        setBottomOpen(true)
        setBottomTab('tester')
        setShowImport(false)
        setNotice(`متصل شد: ${payload.rawCandles?.toLocaleString()} کندل از فایل ${file.name} خوانده شد؛ ${payload.chartBars?.toLocaleString()} کندل در تایم‌فریم انتخابی ساخته شد.`)
      } catch (e) {
        setNotice(`فایل آپلود شد، اما اتصال به چارت/پردازش ناموفق بود: ${e instanceof Error ? e.message : 'خطای ناشناخته'}`)
      } finally {
        setCloudProcessing(false)
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'آپلود فایل ناموفق بود.')
    } finally { setBlobUploadProgress(null) }
  }, [uploadKey, tfSec, fastPeriod, slowPeriod, rr, riskPct, commission])
  const importFile = useCallback(async (file?: File) => {
    if (!file) return
    setImportProgress(0)
    try {
      const parsed = await parseCsvFile(file, setImportProgress)
      setTimeframe(tfForBase(detectBaseSec(parsed)))
      setCandles(parsed); setFileName(file.name); setStoredBlob(null); setCloudSummary(null); setTestResults(null); setTrades([]); setDrawings([]); setRedo([])
      setShowImport(false); setNotice(`${parsed.length.toLocaleString()} کندل وارد شد.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'خطا در خواندن CSV')
    } finally { setImportProgress(null) }
  }, [])
  const resetSample = () => {
    setCandles(demos['XAUUSD']); setFileName(''); setStoredBlob(null); setCloudSummary(null); setSymbol('XAUUSD'); setTimeframe('15m'); setTrades([]); setTestResults(null)
    setDrawings([]); setRedo([]); setMenu(null); setNotice('دیتای نمونه بازنشانی شد.')
  }
  const recordTrade = (side: Side) => {
    if (!last) return
    const entry = last.close
    const distance = Math.max((last.high - last.low) * 1.5, entry * .001)
    const stop = side === 'LONG' ? entry - distance : entry + distance
    const target = side === 'LONG' ? entry + distance * Number(rr) : entry - distance * Number(rr)
    setTrades(p => [{ id: Date.now(), side, entry, stop, target, exit: entry, result: 'OPEN', r: 0, entryIndex: visibleCount - 1, date: dateLabel(last.time) }, ...p])
    setBottomOpen(true); setBottomTab('tester'); setTesterTab('trades')
    setNotice(`معامله ${side === 'LONG' ? 'خرید' : 'فروش'} ثبت شد؛ خروجی خودکار برای این معامله هنوز فعال نیست.`)
  }
  const connectExistingBlob = useCallback(async () => {
    if (!uploadKey.trim()) { setNotice('کلید آپلود را وارد کن؛ برای فایل خصوصی لازم است.'); return }
    setCloudProcessing(true)
    setNotice('در حال پیدا کردن XAUUSD.csv ذخیره‌شده در Blob…')
    try {
      const response = await fetch('/api/blob-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-upload-key': uploadKey.trim() },
        body: JSON.stringify({ timeframeSec: tfSec, fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod), rr: Number(rr), riskPct: Number(riskPct), commission: Number(commission) }),
      })
      const payload = await response.json() as { error?: string; pathname?: string; rawCandles?: number; chartBars?: number; candles?: Candle[]; trades?: ClosedTrade[]; summary?: { totalTrades: number; wins: number; losses: number; netR: number; grossWin: number; grossLoss: number; profitFactor: number | null; winRate: number } }
      if (!response.ok || !payload.candles || !payload.summary || !payload.trades) throw new Error(payload.error || 'Could not connect existing Blob CSV')
      const name = (payload.pathname || 'XAUUSD.csv').split('/').pop() || 'XAUUSD.csv'
      setCandles(payload.candles); setFileName(name); setVisibleCount(payload.candles.length)
      setStoredBlob({ pathname: payload.pathname || name, size: 0, url: '' })
      setCloudSummary(payload.summary); setTestResults(payload.trades); setTrades([]); setDrawings([]); setRedo([])
      setTesterTab('overview'); setBottomOpen(true); setBottomTab('tester'); setShowImport(false)
      setNotice(`اتصال موفق: ${(payload.rawCandles?.toLocaleString() || '—')} کندل خام به ${(payload.chartBars?.toLocaleString() || '—')} کندل ${timeframe} تجمیع شد. برای سرعت، چارت آخرین ${Math.min(5000, payload.candles.length).toLocaleString()} کندل را نشان می‌دهد؛ آمار بک‌تست روی کل دیتاست محاسبه شده است.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'اتصال به دیتای ذخیره‌شده ناموفق بود.')
    } finally { setCloudProcessing(false) }
  }, [uploadKey, tfSec, fastPeriod, slowPeriod, rr, riskPct, commission])

  const runTest = async () => {
    if (Number(fastPeriod) < 2 || Number(slowPeriod) <= Number(fastPeriod) || Number(slowPeriod) > 200) { setNotice('میانگین سریع باید حداقل ۲ و کوچک‌تر از میانگین کند باشد (حداکثر ۲۰۰).'); return }
    if (storedBlob) {
      if (!uploadKey.trim()) { setNotice('برای پردازش فایل خصوصی، کلید آپلود را دوباره وارد کن.'); return }
      setCloudProcessing(true)
      try {
        const response = await fetch('/api/blob-process', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upload-key': uploadKey.trim() }, body: JSON.stringify({ pathname: storedBlob.pathname, timeframeSec: tfSec, fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod), rr: Number(rr), riskPct: Number(riskPct), commission: Number(commission) }) })
        const payload = await response.json() as { error?: string; candles?: Candle[]; rawCandles?: number; chartBars?: number; trades?: ClosedTrade[]; summary?: { totalTrades: number; wins: number; losses: number; netR: number; grossWin: number; grossLoss: number; profitFactor: number | null; winRate: number } }
        if (!response.ok || !payload.candles || !payload.summary || !payload.trades) throw new Error(payload.error || 'Cloud CSV processing failed')
        setCandles(payload.candles); setFileName(storedBlob.pathname.split('/').pop() || 'cloud-data.csv'); setVisibleCount(payload.candles.length)
        setCloudSummary(payload.summary); setTestResults(payload.trades); setTrades([]); setDrawings([]); setRedo([])
        setTesterTab('overview'); setBottomOpen(true); setBottomTab('tester')
        setNotice(`پردازش ابری تمام شد: ${payload.rawCandles?.toLocaleString()} کندل ورودی، ${payload.chartBars?.toLocaleString()} کندل تایم‌فریم؛ چارت آخرین ۵٬۰۰۰ کندل را نشان می‌دهد.`)
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'پردازش ابری ناموفق بود.')
      } finally { setCloudProcessing(false) }
      return
    }
    const result = runBacktest(data, Number(fastPeriod), Number(slowPeriod), Number(rr), Number(riskPct), Number(commission))
    setCloudSummary(null); setTestResults(result); setTesterTab('overview'); setBottomOpen(true); setBottomTab('tester')
    setNotice(`بک‌تست تمام شد؛ ${result.length} معامله بررسی شد.`)
  }
  const exportTrades = () => {
    const rows = testResults ?? trades
    if (!rows.length) { setNotice('هنوز معامله‌ای برای خروجی گرفتن وجود ندارد.'); return }
    const csv = ['id,side,entry,stop,target,exit,result,r,date', ...rows.map(t => [t.id, t.side, t.entry, t.stop, t.target, t.exit, t.result, t.r, t.date].join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'chartgold-trades.csv'; a.click(); URL.revokeObjectURL(url)
  }

  /* ---------- derived UI data ---------- */
  const tfButtons = QUICK_TF.includes(timeframe) ? QUICK_TF : [timeframe, ...QUICK_TF]
  const ActiveTypeIcon = CHART_TYPES.find(c => c.id === chartType)!.Icon
  const filtered = SYMBOLS.filter(s => !query.trim() || s.symbol.includes(query.trim().toUpperCase()) || s.name.toUpperCase().includes(query.trim().toUpperCase()))
  const groups = Array.from(new Set(SYMBOLS.map(s => s.group)))
  const tradeRows = testResults ?? trades
  const sp = SPEEDS[replay.speed]

  return <main className="tv-app" ref={rootRef}>
    {/* ===== TOP TOOLBAR ===== */}
    <header className="tv-top">
      <button className="tv-logo" title="ChartGold" aria-label="ChartGold"><Activity size={18}/></button>
      <i className="tv-sep"/>
      <button className="tv-btn tv-symbol" onClick={() => setSymbolDialog(true)} title="Symbol Search"><Search size={16}/><b>{symbol}</b></button>
      <button className="tv-btn" title="Compare or Add Symbol" onClick={() => setNotice('مقایسه‌ی نمادها هنوز اضافه نشده است.')}><Plus size={18}/></button>
      <i className="tv-sep"/>
      {tfButtons.map(tf => {
        const sec = TIMEFRAMES.find(t => t.label === tf)?.sec ?? 0
        return <button key={tf} className={'tv-btn tv-tf' + (timeframe === tf ? ' sel' : '')} disabled={sec < baseSec} title={sec < baseSec ? 'Finer than source data' : tf} onClick={() => setTimeframe(tf)}>{tf}</button>
      })}
      <div className="tv-menu-wrap" data-menu>
        <button className="tv-btn tv-narrow" title="Timeframes" onClick={() => toggleMenu('tf')}><ChevronDown size={14}/></button>
        {menu === 'tf' && <div className="tv-menu">{TIMEFRAMES.map(t => <button key={t.label} className={'tv-item' + (timeframe === t.label ? ' sel' : '')} disabled={t.sec < baseSec} onClick={() => { setTimeframe(t.label); setMenu(null) }}><span>{t.label}</span>{timeframe === t.label && <Check size={14}/>}</button>)}</div>}
      </div>
      <i className="tv-sep"/>
      <div className="tv-menu-wrap" data-menu>
        <button className="tv-btn" title="Chart type" onClick={() => toggleMenu('type')}><ActiveTypeIcon size={18}/><ChevronDown size={12}/></button>
        {menu === 'type' && <div className="tv-menu">{CHART_TYPES.map(({ id, label, Icon }) => <button key={id} className={'tv-item' + (chartType === id ? ' sel' : '')} onClick={() => { setChartType(id); setMenu(null) }}><Icon size={16}/><span>{label}</span></button>)}</div>}
      </div>
      <i className="tv-sep"/>
      <div className="tv-menu-wrap" data-menu>
        <button className={'tv-btn' + (menu === 'ind' ? ' sel' : '')} title="Indicators" aria-haspopup="dialog" aria-expanded={menu === 'ind'} onClick={() => toggleMenu('ind')}><Activity size={18}/><span className="tv-label">Indicators</span></button>
        {menu === 'ind' && <div className="tv-menu wide indicator-popover" role="dialog" aria-label="Indicators">
          <div className="indicator-popover-head"><div><strong>Indicators</strong><small>افزودن اندیکاتور به چارت</small></div><button className="indicator-close" aria-label="بستن" onClick={() => setMenu(null)}><X size={16}/></button></div>
          <label className="indicator-search"><Search size={15}/><input autoFocus placeholder="جست‌وجوی اندیکاتور…" value={indicatorSearch} onChange={e => setIndicatorSearch(e.target.value)} /></label>
          <div className="indicator-category">TREND</div>
          {(!indicatorSearch.trim() || 'sma simple moving average میانگین متحرک'.includes(indicatorSearch.toLowerCase())) && <>
            <button className={'tv-item indicator-option' + (indicators.fast ? ' sel' : '')} onClick={() => setIndicators(v => ({ ...v, fast: !v.fast }))}><i className="dot" style={{ background: '#2962ff' }}/><span><b>Simple Moving Average</b><small>SMA · دوره سریع ({fastPeriod})</small></span>{indicators.fast ? <Check size={15}/> : <Plus size={15}/>}</button>
            <button className={'tv-item indicator-option' + (indicators.slow ? ' sel' : '')} onClick={() => setIndicators(v => ({ ...v, slow: !v.slow }))}><i className="dot" style={{ background: '#ff9800' }}/><span><b>Simple Moving Average</b><small>SMA · دوره کند ({slowPeriod})</small></span>{indicators.slow ? <Check size={15}/> : <Plus size={15}/>}</button>
          </>}
          {indicatorSearch.trim() && !'sma simple moving average میانگین متحرک'.includes(indicatorSearch.toLowerCase()) && <div className="indicator-empty">فعلاً فقط SMA پیاده‌سازی شده است.</div>}
          <div className="tv-menu-note">دوره‌ها از تنظیمات Strategy Tester خوانده می‌شوند. برای حذف اندیکاتور، دوباره روی آن بزن.</div>
        </div>}
      </div>
      <button className="tv-btn" title="Create Alert" onClick={() => { setPanel('alerts'); setNotice('هشدار قیمت هنوز اضافه نشده است.') }}><AlarmClock size={18}/><span className="tv-label">Alert</span></button>
      <button className={'tv-btn tv-replay' + (replay.active ? ' on' : '')} title="Bar Replay" onClick={toggleReplay}><Rewind size={18} fill="currentColor"/><span>Replay</span></button>
      <i className="tv-sep"/>
      <button className="tv-btn" title="Undo" disabled={!drawings.length} onClick={undo}><Undo2 size={18}/></button>
      <button className="tv-btn" title="Redo" disabled={!redo.length} onClick={redoDraw}><Redo2 size={18}/></button>
      <div className="tv-spacer"/>
      <div className="tv-menu-wrap" data-menu>
        <button className="tv-btn" title="Settings" onClick={() => toggleMenu('settings')}><Settings size={18}/></button>
        {menu === 'settings' && <div className="tv-menu right"><div className="tv-menu-title">Chart settings</div>
          <div className="tv-menu-info">{symbol} · {timeframe} · {candles.length.toLocaleString()} bars{fileName ? ` · ${fileName}` : ' · sample'}</div>
          <button className="tv-item" onClick={() => { setShowImport(true); setMenu(null) }}><Upload size={15}/><span>Import historical data…</span></button>
          <button className="tv-item" onClick={resetSample}><Trash2 size={15}/><span>Reset to sample data</span></button></div>}
      </div>
      <button className="tv-btn" title="Fullscreen" onClick={fullscreen}><Maximize size={18}/></button>
      <button className="tv-btn" title="Take a snapshot" onClick={screenshot}><Camera size={18}/></button>
      <button className="tv-primary" onClick={() => setShowImport(true)}><Upload size={14}/><span className="tv-label">Import</span></button>
    </header>

    <div className="tv-body">
      {/* ===== LEFT DRAWING TOOLBAR ===== */}
      <aside className="tv-left" aria-label="Drawing tools">
        {TOOL_GROUPS.map((g, gi) => <div key={gi} className="tv-tool-group">{g.map(t => {
          const selected = t.action === 'hide' ? hideDrawings : tool === t.name
          const Icon = t.action === 'hide' && hideDrawings ? EyeOff : t.Icon
          return <button key={t.name} title={t.name} aria-label={t.name} className={'tv-tool' + (selected ? ' sel' : '') + (t.impl ? '' : ' soft')} onClick={() => pickTool(t)}><Icon size={20} strokeWidth={1.6}/></button>
        })}</div>)}
        <div className="tv-spacer"/>
        <div className="tv-tool-group"><button className="tv-tool" title="Remove drawings" aria-label="Remove drawings" onClick={() => { setDrawings([]); setRedo([]) }}><Trash2 size={20} strokeWidth={1.6}/></button></div>
      </aside>

      {/* ===== CHART + BOTTOM ===== */}
      <section className="tv-center">
        <div className="tv-chart-wrap">
          <div ref={host} className="tv-chart"/>
          <div className="tv-legend">
            <div className="tv-legend-title"><b>{info.name}</b><span>·</span><span>{timeframe}</span><span>·</span><span>{isDemo ? 'SAMPLE' : fileName}</span></div>
            {bar && <div className="tv-legend-ohlc">
              {(['O', 'H', 'L', 'C'] as const).map(k => { const v = { O: bar.open, H: bar.high, L: bar.low, C: bar.close }[k]; return <span key={k} className={barUp ? 'up' : 'down'}><em>{k}</em>{fmt(v, digits)}</span> })}
              <span className={barChg >= 0 ? 'up' : 'down'}>{sgn(barChg)}{fmt(Math.abs(barChg), digits)} ({sgn(barPct)}{Math.abs(barPct).toFixed(2)}%)</span>
            </div>}
            {indicators.fast && <div className="tv-legend-ind"><span style={{ color: '#2962ff' }}>SMA {fastPeriod}</span></div>}
            {indicators.slow && <div className="tv-legend-ind"><span style={{ color: '#ff9800' }}>SMA {slowPeriod}</span></div>}
          </div>

          {replay.active && <div className="tv-replay-bar" role="toolbar" aria-label="Bar replay">
            <button className={'tv-rbtn' + (replay.selecting ? ' sel' : '')} onClick={() => setReplay(r => ({ ...r, selecting: !r.selecting, playing: false }))}><Rewind size={15}/><span>Select bar</span></button>
            <i className="tv-sep"/>
            <button className="tv-rbtn icon" title={replay.playing ? 'Pause' : 'Play'} onClick={replayPlay}>{replay.playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}</button>
            <button className="tv-rbtn icon" title="Forward one bar" onClick={replayStep}><StepForward size={17} fill="currentColor"/></button>
            <div className="tv-menu-wrap" data-menu>
              <button className="tv-rbtn" title="Replay speed" onClick={() => toggleMenu('speed')}><span>{sp.label}</span><ChevronDown size={12}/></button>
              {menu === 'speed' && <div className="tv-menu up">{SPEEDS.map((s, i) => <button key={s.label} className={'tv-item' + (i === replay.speed ? ' sel' : '')} onClick={() => { setReplay(r => ({ ...r, speed: i })); setMenu(null) }}><span>{s.label}</span>{i === replay.speed && <Check size={14}/>}</button>)}</div>}
            </div>
            <button className="tv-rbtn icon" title="Jump to realtime" onClick={() => { setReplay(r => ({ ...r, playing: false, selecting: false })); setVisibleCount(data.length) }}><SkipForward size={17} fill="currentColor"/></button>
            <i className="tv-sep"/>
            <span className="tv-rcount">{visibleCount.toLocaleString()} / {data.length.toLocaleString()}</span>
            <button className="tv-rbtn icon" title="Exit replay" onClick={toggleReplay}><X size={16}/></button>
            {replay.selecting && <div className="tv-rhint">Click a bar on the chart to start replay</div>}
          </div>}
        </div>

        <div className="tv-timebar">
          {RANGES.map(r => <button key={r} className="tv-range" onClick={() => setRange(r)}>{r}</button>)}
          <i className="tv-sep"/>
          <span className="tv-timeinfo">{dateLabel(bar?.time)} UTC</span>
          <div className="tv-spacer"/>
          <span className="tv-timeinfo">{candles.length.toLocaleString()} bars{shown.length < data.length ? ` · ${data.length.toLocaleString()} @ ${timeframe}` : ''}</span>
        </div>

        <div className={'tv-bottom' + (bottomOpen ? ' open' : '')}>
          <div className="tv-bottom-tabs">
            <button className={'tv-btab' + (bottomOpen && bottomTab === 'tester' ? ' sel' : '')} onClick={() => { setBottomTab('tester'); setBottomOpen(o => (bottomTab === 'tester' ? !o : true)) }}>Strategy Tester</button>
            <button className={'tv-btab' + (bottomOpen && bottomTab === 'trading' ? ' sel' : '')} onClick={() => { setBottomTab('trading'); setBottomOpen(o => (bottomTab === 'trading' ? !o : true)) }}>Trading Panel</button>
            <div className="tv-spacer"/>
            <button className="tv-btn tv-narrow" title={bottomOpen ? 'Minimize panel' : 'Maximize panel'} onClick={() => setBottomOpen(o => !o)}>{bottomOpen ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}</button>
          </div>
          {bottomOpen && bottomTab === 'tester' && <div className="tv-bottom-body">
            <div className="tv-subtabs">
              {([['overview', 'Overview'], ['trades', 'List of Trades'], ['settings', 'Inputs']] as const).map(([id, label]) => <button key={id} className={'tv-stab' + (testerTab === id ? ' sel' : '')} onClick={() => setTesterTab(id)}>{label}</button>)}
              <div className="tv-spacer"/>
              <button className="tv-ghost" onClick={exportTrades}><Download size={14}/> Export CSV</button>
              <button className="tv-primary" onClick={runTest}><Play size={13} fill="currentColor"/> Run backtest</button>
            </div>
            {testerTab === 'settings' && <div className="tv-fields">
              <label>Fast SMA<input type="number" min="2" max="199" value={fastPeriod} onChange={e => setFastPeriod(e.target.value)}/></label>
              <label>Slow SMA<input type="number" min="3" max="200" value={slowPeriod} onChange={e => setSlowPeriod(e.target.value)}/></label>
              <label>Risk / trade %<select value={riskPct} onChange={e => setRiskPct(e.target.value)}><option value="0.25">0.25%</option><option value="0.5">0.5%</option><option value="1">1%</option><option value="2">2%</option></select></label>
              <label>Risk / Reward<select value={rr} onChange={e => setRr(e.target.value)}><option value="1">1 : 1</option><option value="1.5">1 : 1.5</option><option value="2">1 : 2</option><option value="3">1 : 3</option><option value="4">1 : 4</option><option value="5">1 : 5</option></select></label>
              <label>Commission (R)<input type="number" min="0" step=".01" value={commission} onChange={e => setCommission(e.target.value)}/></label>
              <div className="tv-fields-note"><FlaskConical size={14}/> Moving Average Crossover — شبیه‌سازی تاریخی روی همین تایم‌فریم ({timeframe}).</div>
            </div>}
            {testerTab === 'overview' && <div className="tv-metrics">
              <div><span>Net profit (R)</span><strong className={netR >= 0 ? 'up' : 'down'}>{sgn(netR)}{Math.abs(netR).toFixed(2)}R</strong></div>
              <div><span>Total trades</span><strong>{totalTrades.toLocaleString()}</strong></div>
              <div><span>Win rate</span><strong>{(cloudSummary?.winRate ?? (totalTrades ? wins / totalTrades * 100 : 0)).toFixed(1)}%</strong></div>
              <div><span>Profit factor</span><strong>{profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}</strong></div>
              <div><span>Wins / Losses</span><strong><span className="up">{wins}</span> / <span className="down">{losses}</span></strong></div>
              <div><span>Data</span><strong className="small">{isDemo ? 'Sample' : 'Imported CSV'}</strong></div>
            </div>}
            {testerTab === 'trades' && <div className="tv-table-wrap">{tradeRows.length ? <table className="tv-table"><thead><tr><th>#</th><th>Type</th><th>Entry date</th><th>Entry</th><th>Stop</th><th>Target</th><th>Exit</th><th>Result</th><th>R multiple</th></tr></thead><tbody>{tradeRows.map(t => <tr key={t.id}><td>{t.id}</td><td className={t.side === 'LONG' ? 'up' : 'down'}>{t.side}</td><td>{t.date}</td><td>{fmt(t.entry, digits)}</td><td>{fmt(t.stop, digits)}</td><td>{fmt(t.target, digits)}</td><td>{fmt(t.exit, digits)}</td><td><span className={t.r > 0 ? 'pill win' : t.result === 'OPEN' ? 'pill open' : 'pill loss'}>{t.result}</span></td><td className={t.r > 0 ? 'up' : 'down'}>{t.r.toFixed(2)}R</td></tr>)}</tbody></table> : <div className="tv-empty"><List size={20}/><strong>No trades yet</strong><span>Run a backtest or add a practice trade from the Trading Panel.</span></div>}</div>}
          </div>}
          {bottomOpen && bottomTab === 'trading' && <div className="tv-bottom-body tv-trading">
            <div><strong>Practice order</strong><p>ثبت معامله‌ی آزمایشی روی آخرین کندل قابل مشاهده ({symbol} @ {fmt(last?.close ?? 0, digits)}).</p></div>
            <div className="tv-order"><button className="sell" onClick={() => recordTrade('SHORT')}><TrendingDown size={15}/> Sell {fmt(last?.close ?? 0, digits)}</button><button className="buy" onClick={() => recordTrade('LONG')}><TrendingUp size={15}/> Buy {fmt(last?.close ?? 0, digits)}</button></div>
            <button className="tv-ghost" onClick={() => { setBottomTab('tester'); setTesterTab('trades') }}>Open trade log ({trades.length})</button>
          </div>}
        </div>
      </section>

      {/* ===== RIGHT SIDEBAR ===== */}
      <aside className="tv-right">
        {panel && <section className="tv-panel">
          {panel === 'watchlist' && <>
            <div className="tv-panel-head"><button className="tv-panel-title">Watchlist <ChevronDown size={14}/></button><div className="tv-spacer"/><button className="tv-btn tv-narrow" title="Add symbol" onClick={() => setSymbolDialog(true)}><Plus size={17}/></button><button className="tv-btn tv-narrow" title="More" onClick={() => setNotice('گزینه‌های بیشتر لیست پیگیری هنوز اضافه نشده است.')}><Ellipsis size={17}/></button></div>
            <div className="tv-wl-cols"><span>Symbol</span><span>Last</span><span>Chg</span><span>Chg%</span></div>
            <div className="tv-wl-list">{groups.map(g => <div key={g}><div className="tv-wl-group"><ChevronDown size={12}/>{g}</div>
              {SYMBOLS.filter(s => s.group === g).map(s => {
                const active = s.symbol === symbol
                const st = active ? activeStats : dayStats(demos[s.symbol], demos[s.symbol].length - 1, 96)
                const cls = st.chg >= 0 ? 'up' : 'down'
                return <button key={s.symbol} className={'tv-wl-row' + (active ? ' active' : '')} onClick={() => selectSymbol(s.symbol)}>
                  <span className="tv-wl-sym"><i style={{ background: s.color }}>{s.symbol[0]}</i><b>{s.symbol}</b></span>
                  <span>{fmt(st.last, s.digits)}</span><span className={cls}>{sgn(st.chg)}{fmt(Math.abs(st.chg), s.digits)}</span><span className={cls}>{sgn(st.pct)}{Math.abs(st.pct).toFixed(2)}%</span></button>
              })}</div>)}</div>
            <div className="tv-wl-detail">
              <div className="tv-wl-detail-head"><i style={{ background: info.color }}>{symbol[0]}</i><div><b>{symbol}</b><small>{info.name}</small></div></div>
              <div className="tv-wl-price"><strong>{fmt(activeStats.last, digits)}</strong><span className={activeStats.chg >= 0 ? 'up' : 'down'}>{sgn(activeStats.chg)}{fmt(Math.abs(activeStats.chg), digits)} {sgn(activeStats.pct)}{Math.abs(activeStats.pct).toFixed(2)}%</span></div>
              <div className="tv-wl-stats">
                <div><span>Open</span><b>{fmt(bar?.open ?? 0, digits)}</b></div><div><span>High</span><b>{fmt(bar?.high ?? 0, digits)}</b></div>
                <div><span>Low</span><b>{fmt(bar?.low ?? 0, digits)}</b></div><div><span>Prev close</span><b>{fmt(barPrev?.close ?? bar?.open ?? 0, digits)}</b></div>
              </div>
              <p className="tv-wl-note">قیمت‌ها نمونه‌اند مگر اینکه CSV خودت را وارد کنی.</p>
            </div>
          </>}
          {panel === 'alerts' && <><div className="tv-panel-head"><span className="tv-panel-title">Alerts</span><div className="tv-spacer"/><button className="tv-btn tv-narrow" onClick={() => setNotice('هشدار قیمت هنوز اضافه نشده است.')}><Plus size={17}/></button></div>
            <div className="tv-empty tall"><Bell size={26}/><strong>No alerts yet</strong><span>Price alerts will appear here.</span><button className="tv-primary" onClick={() => setNotice('هشدار قیمت هنوز اضافه نشده است.')}>Create alert</button></div></>}
          {panel === 'data' && <><div className="tv-panel-head"><span className="tv-panel-title">Data Window</span></div>
            <div className="tv-dw"><b>{symbol} · {timeframe}</b><small>{dateLabel(bar?.time)} UTC</small>
              {bar && [['Open', bar.open], ['High', bar.high], ['Low', bar.low], ['Close', bar.close]].map(([k, v]) => <div key={k as string}><span>{k as string}</span><b className={barUp ? 'up' : 'down'}>{fmt(v as number, digits)}</b></div>)}
              <div><span>Change</span><b className={barChg >= 0 ? 'up' : 'down'}>{sgn(barChg)}{fmt(Math.abs(barChg), digits)} ({sgn(barPct)}{Math.abs(barPct).toFixed(2)}%)</b></div>
              {bar?.volume ? <div><span>Volume</span><b>{bar.volume.toLocaleString()}</b></div> : null}</div></>}
        </section>}
        <nav className="tv-rail" aria-label="Right sidebar">
          <button className={'tv-rail-btn' + (panel === 'watchlist' ? ' sel' : '')} title="Watchlist" onClick={() => setPanel(p => (p === 'watchlist' ? null : 'watchlist'))}><List size={20}/></button>
          <button className={'tv-rail-btn' + (panel === 'alerts' ? ' sel' : '')} title="Alerts" onClick={() => setPanel(p => (p === 'alerts' ? null : 'alerts'))}><AlarmClock size={20}/></button>
          <button className={'tv-rail-btn' + (panel === 'data' ? ' sel' : '')} title="Data Window" onClick={() => setPanel(p => (p === 'data' ? null : 'data'))}><Info size={20}/></button>
          <div className="tv-spacer"/>
          <button className="tv-rail-btn" title="Help" onClick={() => setNotice('ChartGold Backtest Lab — فقط داده‌ی تاریخی؛ این یک نمونه‌ی اولیه است.')}><CircleHelp size={20}/></button>
        </nav>
      </aside>
    </div>

    {/* ===== SYMBOL SEARCH ===== */}
    {symbolDialog && <div className="modal-backdrop" onClick={() => setSymbolDialog(false)}><section className="tv-dialog" role="dialog" aria-modal="true" aria-label="Symbol Search" onClick={e => e.stopPropagation()}>
      <div className="tv-dialog-head"><strong>Symbol Search</strong><button className="tv-btn tv-narrow" onClick={() => setSymbolDialog(false)} aria-label="Close"><X size={18}/></button></div>
      <div className="tv-dialog-search"><Search size={18}/><input autoFocus value={query} placeholder="Search" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitSymbolQuery(); if (e.key === 'Escape') setSymbolDialog(false) }}/></div>
      <div className="tv-dialog-list">{filtered.map(s => <button key={s.symbol} className={'tv-dialog-row' + (s.symbol === symbol ? ' sel' : '')} onClick={() => selectSymbol(s.symbol)}><i style={{ background: s.color }}>{s.symbol[0]}</i><b>{s.symbol}</b><span>{s.name}</span><em>{s.group}</em></button>)}
        {!filtered.length && <div className="tv-empty"><strong>No symbols match</strong><span>{isDemo ? 'Only sample symbols are available until you import a CSV.' : 'Press Enter to use this as a custom label.'}</span></div>}</div>
    </section></div>}

    {notice && <div className="toast" role="status"><Bell size={16}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}

    {showImport && <div className="modal-backdrop" onClick={() => setShowImport(false)}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><strong id="import-title">Import historical data</strong><span>CSV · OHLC candles</span></div><button className="tv-btn tv-narrow" onClick={() => setShowImport(false)} aria-label="Close"><X size={18}/></button></div><label className="file-drop"><FileUp size={28}/><strong>Choose a CSV file</strong><span>Required: DATE / DTYYYYMMDD, OPEN, HIGH, LOW, CLOSE. Optional: TIME, VOL.</span>{importProgress !== null && <div className="import-progress"><div className="import-progress-label"><span>Streaming CSV locally…</span><strong>{importProgress}%</strong></div><div className="import-progress-track"><div className="import-progress-fill" style={{ width: `${importProgress}%` }} /></div></div>}<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => importFile(e.target.files?.[0])}/></label>
      <div className="modal-tip">Local import draws the chart immediately, but very large files can still use substantial browser memory.</div>
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <button className="tv-primary" onClick={connectExistingBlob} disabled={cloudProcessing || blobUploadProgress !== null}>{cloudProcessing ? 'Finding and processing saved CSV…' : 'Connect existing private CSV (no re-upload)'}</button>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--muted)' }}>Private Blob upload key<input type="password" autoComplete="off" value={uploadKey} onChange={e => setUploadKey(e.target.value)} placeholder="Enter your private upload key" style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)' }} /></label>
        <label className="file-drop"><Upload size={25}/><strong>Upload a large CSV to private cloud storage</strong><span>Multipart upload with progress · maximum 1 GB</span>{blobUploadProgress !== null && <div className="import-progress"><div className="import-progress-label"><span>Uploading to Blob…</span><strong>{blobUploadProgress}%</strong></div><div className="import-progress-track"><div className="import-progress-fill" style={{ width: `${blobUploadProgress}%` }} /></div></div>}<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => uploadFileToBlob(e.target.files?.[0])}/></label>
        {storedBlob && <div className="modal-tip">Stored privately: {storedBlob.pathname} · {(storedBlob.size / (1024 * 1024)).toFixed(1)} MB</div>}
        {storedBlob && <button className="tv-primary" onClick={runTest} disabled={cloudProcessing || blobUploadProgress !== null}>{cloudProcessing ? 'Processing cloud CSV…' : 'Analyze full cloud CSV'}</button>}
        <div className="modal-tip">Cloud analysis streams the private CSV on the server and returns the last 5,000 chart bars plus full-dataset backtest statistics. Very large files may exceed the serverless function time limit; this is not a persistent background job.</div>
      </div></section></div>}
  </main>
}

export default App
