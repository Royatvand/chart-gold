import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { upload as uploadBlob } from '@vercel/blob/client'
import { RSI } from 'technicalindicators'
import {
  createChart, AreaSeries, BarSeries, CandlestickSeries, LineSeries, ColorType, CrosshairMode, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type SeriesType, type UTCTimestamp,
} from 'lightweight-charts'
import {
  Activity, AlarmClock, AreaChart, Bell, Brush, Camera, Check, ChevronDown, ChevronUp, CircleHelp, Crosshair, Download, Ellipsis,
  Eye, EyeOff, FileUp, FlaskConical, Info, LineChart, List, Lock, Magnet, Maximize, Minus, MousePointer2, NotebookPen, Pause,
  Play, Plus, Redo2, Rewind, Ruler, Search, Settings, Shapes, SkipForward, StepForward, StickyNote, Trash2, TrendingDown, TrendingUp,
  Type, Undo2, Unlock, Upload, X, ZoomIn, ZoomOut, Layers, type LucideIcon,
} from 'lucide-react'
import {
  SYMBOLS, TIMEFRAMES, aggregate, dateLabel, detectBaseSec, fmt, genDemo, indexByTime, inferDigits, parseCsvFile,
  runBacktest, smaLine, tfForBase, NOBITEX_SYMBOLS, type Candle, type ClosedTrade, type Side, type SymbolInfo, type Trade,
} from './lib/market'

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif'
const DAY = 86400
const RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', 'All']
const RANGE_SEC: Record<string, number> = { '1D': DAY, '5D': 5 * DAY, '1M': 30 * DAY, '3M': 91 * DAY, '6M': 182 * DAY, '1Y': 365 * DAY }
const SPEEDS = [{ label: '10x', ms: 100 }, { label: '7x', ms: 143 }, { label: '5x', ms: 200 }, { label: '3x', ms: 333 }, { label: '1x', ms: 1000 }, { label: '0.5x', ms: 2000 }, { label: '0.3x', ms: 3333 }]
const QUICK_TF = ['5m', '15m', '1h', '4h', '1D']
type ChartType = 'candles' | 'bars' | 'line' | 'area'
type Replay = { active: boolean; selecting: boolean; playing: boolean; speed: number }
type Anchor = { time: number; price: number }
type AnchorPair = { a: Anchor; b: Anchor }
type ChartText = Anchor & { id: number; text: string }
type ChartIcon = Anchor & { id: number; icon: string }
type DrawingHistoryEntry =
  | { kind: 'horizontal'; value: number }
  | { kind: 'trend' | 'fib' | 'measure'; value: AnchorPair }
  | { kind: 'brush'; value: Anchor[] }
  | { kind: 'text'; value: ChartText }
  | { kind: 'icon'; value: ChartIcon }
type SidePanel = 'watchlist' | 'alerts' | 'data' | 'notes' | null
type PriceAlert = { id: number; symbol: string; price: number; direction: 'above' | 'below'; active: boolean }

const CandlesIcon = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 2v3M5 12v4M13 1v4M13 11v5"/><rect x="3" y="5" width="4" height="7" rx=".5"/><rect x="11" y="5" width="4" height="6" rx=".5"/></svg>
const BarsIcon = ({ size = 18 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 2v14M2.5 5H5M5 12h2.5M13 1v14M10.5 4H13M13 10h2.5"/></svg>
const CHART_TYPES: { id: ChartType; label: string; Icon: (p: { size?: number }) => ReactElement }[] = [
  { id: 'candles', label: 'Candles', Icon: CandlesIcon },
  { id: 'bars', label: 'Bars', Icon: BarsIcon },
  { id: 'line', label: 'Line', Icon: ({ size }) => <LineChart size={size} /> },
  { id: 'area', label: 'Area', Icon: ({ size }) => <AreaChart size={size} /> },
]

type ToolDef = { name: string; Icon: LucideIcon; impl?: boolean; action?: 'zoomIn' | 'zoomOut' | 'hide' | 'magnet' | 'lock' }
const TOOL_GROUPS: ToolDef[][] = [
  [{ name: 'Crosshair', Icon: Crosshair, impl: true }, { name: 'Cursor', Icon: MousePointer2, impl: true }],
  [{ name: 'Trend line', Icon: TrendingUp, impl: true }, { name: 'Horizontal line', Icon: Minus, impl: true }, { name: 'Fib retracement', Icon: Layers, impl: true }],
  [{ name: 'Brush', Icon: Brush, impl: true }, { name: 'Text', Icon: Type, impl: true }, { name: 'Icon', Icon: Shapes, impl: true }],
  [{ name: 'Measure', Icon: Ruler, impl: true }, { name: 'Zoom in', Icon: ZoomIn, impl: true, action: 'zoomIn' }, { name: 'Zoom out', Icon: ZoomOut, impl: true, action: 'zoomOut' }],
  [{ name: 'Magnet mode', Icon: Magnet, impl: true, action: 'magnet' }, { name: 'Lock all drawings', Icon: Lock, impl: true, action: 'lock' }, { name: 'Hide all drawings', Icon: Eye, impl: true, action: 'hide' }],
]

// Sample data is built at 1-minute resolution (30k bars ≈ 3 weeks) so every timeframe from 1m to 1W is usable.
const sampleCache: Record<string, Candle[]> = {}
const sampleFor = (sym: string): Candle[] => (sampleCache[sym] ??= genDemo(SYMBOLS.find(s => s.symbol === sym) ?? SYMBOLS[0], 60, 30000))

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
  const rsiHost = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const rsiChartRef = useRef<IChartApi | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiBoundsSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiSyncRef = useRef(false)
  const indicatorRefs = useRef<ISeriesApi<'Line'>[]>([])
  const fitRef = useRef<Candle[] | null>(null)
  const demos = useMemo(() => Object.fromEntries(SYMBOLS.map(s => [s.symbol, genDemo(s)])) as Record<string, Candle[]>, [])

  const [candles, setCandles] = useState<Candle[]>(() => sampleFor('XAUUSD'))
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveConnected, setLiveConnected] = useState(false)
  const [fileName, setFileName] = useState('')
  const [compareSymbol, setCompareSymbol] = useState<string | null>(null)
  const [wlSort, setWlSort] = useState<'default' | 'symbol' | 'change'>('default')
  const [symbol, setSymbol] = useState('XAUUSD')
  const activeSymbolRef = useRef(symbol); activeSymbolRef.current = symbol
  const [timeframe, setTimeframe] = useState('15m')
  const [chartType, setChartType] = useState<ChartType>('candles')
  const [visibleCount, setVisibleCount] = useState(candles.length)
  const [replay, setReplay] = useState<Replay>({ active: false, selecting: false, playing: false, speed: 4 })
  const [menu, setMenu] = useState<string | null>(null)
  const [symbolDialog, setSymbolDialog] = useState(false)
  const [query, setQuery] = useState('')
  const [tool, setTool] = useState('Crosshair')
  const [drawings, setDrawings] = useState<number[]>([])
  const [trendLines, setTrendLines] = useState<AnchorPair[]>([])
  const [fibDrawings, setFibDrawings] = useState<AnchorPair[]>([])
  const [brushPaths, setBrushPaths] = useState<Anchor[][]>([])
  const [activeBrushPath, setActiveBrushPath] = useState<Anchor[]>([])
  const brushPathRef = useRef<Anchor[]>([])
  const [chartTexts, setChartTexts] = useState<ChartText[]>([])
  const [chartIcons, setChartIcons] = useState<ChartIcon[]>([])
  const [measurements, setMeasurements] = useState<AnchorPair[]>([])
  const [measureAnchor, setMeasureAnchor] = useState<Anchor | null>(null)
  const measureAnchorRef = useRef<Anchor | null>(null)
  measureAnchorRef.current = measureAnchor
  const [lockedDrawings, setLockedDrawings] = useState(false)
  const [magnetMode, setMagnetMode] = useState(false)
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null)
  const [, setDrawingRenderVersion] = useState(0)
  const [undoHistory, setUndoHistory] = useState<DrawingHistoryEntry[]>([])
  const [redo, setRedo] = useState<DrawingHistoryEntry[]>([])
  const [hideDrawings, setHideDrawings] = useState(false)
  const [textAnchor, setTextAnchor] = useState<Anchor | null>(null)
  const [textValue, setTextValue] = useState('')
  const [showTextDialog, setShowTextDialog] = useState(false)
  const [iconAnchor, setIconAnchor] = useState<Anchor | null>(null)
  const [showIconDialog, setShowIconDialog] = useState(false)
  const [noteDraft, setNoteDraft] = useState(() => {
    try { return window.localStorage.getItem('chartgold-notes') ?? '' } catch { return '' }
  })
  const [indicators, setIndicators] = useState({ fast: false, slow: false, rsi: false })
  const [indicatorSearch, setIndicatorSearch] = useState('')
  const [seriesVersion, setSeriesVersion] = useState(0)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [panel, setPanel] = useState<SidePanel>('watchlist')
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([])
  const [showAlertDialog, setShowAlertDialog] = useState(false)
  const [alertPrice, setAlertPrice] = useState('')
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above')
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false)
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

  const isDemo = fileName === '' && !NOBITEX_SYMBOLS[symbol]
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
  const pendingAnchorRef = useRef<Anchor | null>(null)
  pendingAnchorRef.current = pendingAnchor
  const selectingRef = useRef(replay.selecting); selectingRef.current = replay.selecting
  const dataRef = useRef(data); dataRef.current = data
  const shownRef = useRef(shown); shownRef.current = shown
  const magnetRef = useRef(magnetMode); magnetRef.current = magnetMode
  const lockedRef = useRef(lockedDrawings); lockedRef.current = lockedDrawings

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
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => setDrawingRenderVersion(v => v + 1))
    chart.subscribeClick(param => {
      if (!param.point || param.time === undefined) return
      if (selectingRef.current) {
        const idx = indexByTime(dataRef.current, Number(param.time))
        if (idx >= 0) { setVisibleCount(idx + 1); setReplay(r => ({ ...r, selecting: false })) }
        return
      }
      const activeTool = toolRef.current
      if (lockedRef.current) return
      const price = seriesRef.current?.coordinateToPrice(param.point.y)
      if (price === null || price === undefined) return
      let anchor: Anchor = { time: Number(param.time), price: Number(price) }
      if (magnetRef.current) {
        const idx = indexByTime(shownRef.current, anchor.time)
        const candle = shownRef.current[idx]
        if (candle) {
          const levels = [candle.open, candle.high, candle.low, candle.close]
          anchor = { time: Number(candle.time), price: levels.reduce((best, value) => Math.abs(value - anchor.price) < Math.abs(best - anchor.price) ? value : best, levels[0]) }
        }
      }
      if (activeTool === 'Horizontal line') {
        setDrawings(items => [...items, anchor.price])
        setUndoHistory(history => [...history, { kind: 'horizontal', value: anchor.price }]); setRedo([])
        return
      }
      if (activeTool === 'Text') { setTextAnchor(anchor); setTextValue(''); setShowTextDialog(true); return }
      if (activeTool === 'Icon') { setIconAnchor(anchor); setShowIconDialog(true); return }
      if (activeTool === 'Measure') {
        if (!measureAnchorRef.current) {
          measureAnchorRef.current = anchor; setMeasureAnchor(anchor)
          setNotice('نقطه اول اندازه‌گیری ثبت شد؛ برای تکمیل روی نقطه دوم کلیک کن.')
        } else {
          const shape = { a: measureAnchorRef.current, b: anchor }
          setMeasurements(items => [...items, shape])
          setUndoHistory(history => [...history, { kind: 'measure', value: shape }]); setRedo([])
          measureAnchorRef.current = null; setMeasureAnchor(null); setNotice('اندازه‌گیری به چارت اضافه شد.')
        }
        return
      }
      if (activeTool === 'Trend line' || activeTool === 'Fib retracement') {
        if (!pendingAnchorRef.current) { pendingAnchorRef.current = anchor; setPendingAnchor(anchor); setNotice(`نقطه اول ${activeTool === 'Trend line' ? 'خط روند' : 'فیبوناچی'} ثبت شد؛ روی نقطه دوم چارت کلیک کن.`); return }
        const shape = { a: pendingAnchorRef.current, b: anchor }
        if (activeTool === 'Trend line') {
          setTrendLines(lines => [...lines, shape])
          setUndoHistory(history => [...history, { kind: 'trend', value: shape }])
        } else {
          setFibDrawings(lines => [...lines, shape])
          setUndoHistory(history => [...history, { kind: 'fib', value: shape }])
        }
        pendingAnchorRef.current = null; setPendingAnchor(null); setRedo([]); setNotice('ابزار رسم اضافه شد.')
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
    // Fit only once the visible slice covers the new dataset; otherwise a stale (smaller) visibleCount
    // makes fitContent() run on a handful of bars and the chart stays zoomed in after a timeframe change.
    if (fitRef.current !== data) { if (visibleCount >= data.length) { fitRef.current = data; chart.timeScale().fitContent() } }
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


  // RSI (14) lives in its own synchronized lower pane, calculated from the visible OHLC history.
  useEffect(() => {
    if (!indicators.rsi) return
    const mainChart = chartRef.current
    const container = rsiHost.current
    if (!mainChart || !container) return

    const oscillator = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#9598a1', fontFamily: FONT, fontSize: 10 },
      grid: { vertLines: { color: '#1f2330' }, horzLines: { color: '#1f2330' } },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: .03, bottom: .03 } },
      timeScale: { borderColor: '#2a2e39', timeVisible: false, secondsVisible: false, rightOffset: 10, barSpacing: 8, minBarSpacing: .4, visible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#9598a1', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#363a45' },
        horzLine: { color: '#9598a1', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#363a45' },
      },
    })
    const rsiLine = oscillator.addSeries(LineSeries, {
      color: '#a78bfa', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 2, minMove: .01 },
    })
    // Transparent bounds hold the oscillator scale at 0–100 rather than autoscaling to each local swing.
    const bounds = oscillator.addSeries(LineSeries, {
      color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
    })
    const levels: IPriceLine[] = [
      rsiLine.createPriceLine({ price: 70, color: '#f23645', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' }),
      rsiLine.createPriceLine({ price: 30, color: '#089981', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' }),
    ]
    rsiChartRef.current = oscillator
    rsiSeriesRef.current = rsiLine
    rsiBoundsSeriesRef.current = bounds

    const syncRange = (target: IChartApi, range: { from: number; to: number } | null) => {
      if (!range || rsiSyncRef.current) return
      const current = target.timeScale().getVisibleLogicalRange()
      if (current && Math.abs(current.from - range.from) < .01 && Math.abs(current.to - range.to) < .01) return
      rsiSyncRef.current = true
      try { target.timeScale().setVisibleLogicalRange(range) } catch { /* range can be briefly unavailable during resize */ }
      finally { rsiSyncRef.current = false }
    }
    const syncMainToRsi = (range: { from: number; to: number } | null) => syncRange(oscillator, range)
    const syncRsiToMain = (range: { from: number; to: number } | null) => syncRange(mainChart, range)
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncMainToRsi)
    oscillator.timeScale().subscribeVisibleLogicalRangeChange(syncRsiToMain)
    const initialRange = mainChart.timeScale().getVisibleLogicalRange()
    if (initialRange) syncRange(oscillator, initialRange)

    return () => {
      mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMainToRsi)
      oscillator.timeScale().unsubscribeVisibleLogicalRangeChange(syncRsiToMain)
      levels.forEach(line => { try { rsiLine.removePriceLine(line) } catch { /* chart is being disposed */ } })
      oscillator.remove()
      if (rsiChartRef.current === oscillator) {
        rsiChartRef.current = null
        rsiSeriesRef.current = null
        rsiBoundsSeriesRef.current = null
      }
    }
  }, [indicators.rsi])

  useEffect(() => {
    if (!indicators.rsi) return
    const chart = rsiChartRef.current
    const line = rsiSeriesRef.current
    const bounds = rsiBoundsSeriesRef.current
    if (!chart || !line || !bounds || !shown.length) return
    const period = 14
    const values = RSI.calculate({ period, values: shown.map(candle => candle.close) })
    // The library emits the first RSI after 14 price changes; leading whitespace keeps x-coordinates aligned.
    const points = shown.map((candle, index) => {
      const value = index >= period ? values[index - period] : undefined
      return value === undefined ? { time: candle.time } : { time: candle.time, value }
    })
    line.setData(points)
    bounds.setData(shown.length > 1
      ? [{ time: shown[0].time, value: 0 }, { time: shown[shown.length - 1].time, value: 100 }]
      : [])
    const range = chartRef.current?.timeScale().getVisibleLogicalRange()
    if (range) {
      rsiSyncRef.current = true
      try { chart.timeScale().setVisibleLogicalRange(range) } catch { /* range may be unavailable during initial render */ }
      finally { rsiSyncRef.current = false }
    }
  }, [shown, indicators.rsi])

  // Horizontal-line drawings.
  useEffect(() => {
    const s = seriesRef.current
    if (!s || hideDrawings) return
    const lines: IPriceLine[] = drawings.map(price => s.createPriceLine({ price, color: '#2962ff', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }))
    return () => lines.forEach(l => { try { s.removePriceLine(l) } catch { /* series gone */ } })
  }, [drawings, hideDrawings, seriesVersion])

  // Compare overlay: another sample symbol, rebased to the main symbol's first visible price so both share one scale.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !compareSymbol || !isDemo || compareSymbol === symbol || !shown.length) return
    const other = aggregate(sampleFor(compareSymbol), tfSec, baseSec)
    const byTime = new Map(other.map(c => [Number(c.time), c.close]))
    const firstOther = byTime.get(Number(shown[0].time))
    if (!firstOther) return
    const factor = shown[0].close / firstOther
    const points = shown.flatMap(c => { const v = byTime.get(Number(c.time)); return v === undefined ? [] : [{ time: c.time, value: v * factor }] })
    const color = SYMBOLS.find(s => s.symbol === compareSymbol)?.color ?? '#ff9800'
    const line = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
    line.setData(points)
    return () => { if (chartRef.current === chart) { try { chart.removeSeries(line) } catch { /* disposed */ } } }
  }, [compareSymbol, symbol, isDemo, shown, tfSec, baseSec, seriesVersion])

  // Practice trades close themselves when a later bar touches the stop or the target (stop wins if both are touched).
  useEffect(() => {
    if (!shown.length) return
    setTrades(list => {
      let changed = false
      const next = list.map(t => {
        if (t.result !== 'OPEN' || !t.entryTime) return t
        const start = shown.findIndex(c => Number(c.time) > t.entryTime!)
        if (start < 0) return t
        for (let i = start; i < shown.length; i++) {
          const c = shown[i]
          const stopHit = t.side === 'LONG' ? c.low <= t.stop : c.high >= t.stop
          const targetHit = t.side === 'LONG' ? c.high >= t.target : c.low <= t.target
          if (!stopHit && !targetHit) continue
          const exit = stopHit ? t.stop : t.target
          const risk = Math.abs(t.entry - t.stop) || 1
          const r = (t.side === 'LONG' ? exit - t.entry : t.entry - exit) / risk - (Number(commission) || 0)
          changed = true
          return { ...t, exit, r, result: r > 0 ? 'WIN' as const : 'LOSS' as const }
        }
        return t
      })
      return changed ? next : list
    })
  }, [shown, commission])

  // Toasts used to stay forever and covered the bottom panel buttons; dismiss them automatically.
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(id)
  }, [notice])

  // Load and refresh real Nobitex OHLC candles for supported crypto markets.
  // Poll at most once per minute to stay within the public API's 60 requests/minute limit.
  useEffect(() => {
    const marketSymbol = NOBITEX_SYMBOLS[symbol]
    if (!marketSymbol) return
    let active = true
    let firstLoad = true
    let requestInFlight = false

    const resolutionFor = (label: string) => {
      if (label === '1m' || label === '3m') return '1'
      if (label === '5m') return '5'
      if (label === '15m') return '15'
      if (label === '30m') return '30'
      if (label === '1h' || label === '2h') return '60'
      if (label === '4h') return '240'
      if (label === '1D' || label === '1W') return 'D'
      return '15'
    }

    const loadLiveCandles = async () => {
      if (requestInFlight) return
      requestInFlight = true
      if (firstLoad) setLiveLoading(true)
      try {
        const resolution = resolutionFor(timeframe)
        const params = new URLSearchParams({
          symbol: marketSymbol,
          resolution,
          to: String(Math.floor(Date.now() / 1000)),
          countback: '500',
        })
        const response = await fetch(`/api/nobitex-history?${params.toString()}`, { headers: { Accept: 'application/json' } })
        const payload = await response.json() as {
          s?: string
          t?: number[]
          o?: number[]
          h?: number[]
          l?: number[]
          c?: number[]
          v?: number[]
          errmsg?: string
          error?: string
        }
        if (!response.ok) throw new Error(payload.error || payload.errmsg || 'دریافت داده از نوبیتکس ناموفق بود.')
        if (payload.s !== 'ok' || !payload.t?.length || !payload.o || !payload.h || !payload.l || !payload.c) {
          throw new Error(payload.errmsg || 'برای این نماد در این تایم‌فریم داده‌ای پیدا نشد.')
        }
        const nextCandles: Candle[] = payload.t.flatMap((time, index) => {
          const open = payload.o?.[index], high = payload.h?.[index], low = payload.l?.[index], close = payload.c?.[index]
          if (![time, open, high, low, close].every(Number.isFinite) || high! < low!) return []
          return [{
            time: Math.floor(time) as Candle['time'],
            open: open!,
            high: high!,
            low: low!,
            close: close!,
            volume: Number.isFinite(payload.v?.[index]) ? payload.v![index] : 0,
          }]
        })
        if (!nextCandles.length) throw new Error('داده‌های دریافتی معتبر نیستند.')
        if (!active) return
        setCandles(nextCandles)
        setVisibleCount(nextCandles.length)
        setLiveConnected(true)
        setFileName('')
        setStoredBlob(null)
        setCloudSummary(null)
        setTestResults(null)
        if (firstLoad) setNotice(`داده زنده ${marketSymbol} از نوبیتکس دریافت شد؛ ${nextCandles.length} کندل بارگذاری شد.`)
      } catch (error) {
        if (active) setLiveConnected(false)
        if (active && firstLoad) setNotice(error instanceof Error ? error.message : 'اتصال به نوبیتکس ناموفق بود.')
      } finally {
        if (active) setLiveLoading(false)
        firstLoad = false
        requestInFlight = false
      }
    }

    void loadLiveCandles()
    const intervalId = window.setInterval(() => { void loadLiveCandles() }, 60_000)
    return () => { active = false; window.clearInterval(intervalId) }
  }, [symbol, timeframe])

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
    const current = shown[shown.length - 1]?.close
    const previous = shown[shown.length - 2]?.close
    if (current === undefined || previous === undefined || current === previous) return
    setPriceAlerts(existing => existing.map(alert => {
      if (!alert.active || alert.symbol !== symbol) return alert
      const crossed = alert.direction === 'above' ? previous < alert.price && current >= alert.price : previous > alert.price && current <= alert.price
      if (crossed) { setNotice(`هشدار قیمت ${alert.symbol}: قیمت به ${fmt(alert.price, digits)} رسید.`); return { ...alert, active: false } }
      return alert
    }))
  }, [shown, symbol, digits])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-menu]')) setMenu(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])
  useEffect(() => {
    try { window.localStorage.setItem('chartgold-notes', noteDraft) } catch { /* storage may be disabled */ }
  }, [noteDraft])

  /* ---------- actions ---------- */
  const toggleMenu = (id: string) => setMenu(m => (m === id ? null : id))
  const selectSymbol = (sym: string) => {
    setSymbol(sym); setSymbolDialog(false); setQuery(''); setMenu(null); setMobilePanelOpen(false)
    if (NOBITEX_SYMBOLS[sym]) {
      setCandles([]); setFileName(''); setStoredBlob(null); setCloudSummary(null); setTestResults(null); setTrades([])
      setLiveConnected(false)
      setCompareSymbol(null); setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setChartTexts([]); setChartIcons([]); setMeasurements([]); setUndoHistory([]); setRedo([])
    } else if (fileName === '' && demos[sym]) {
      setCandles(sampleFor(sym)); setCompareSymbol(c => (c === sym ? null : c)); setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setChartTexts([]); setChartIcons([]); setMeasurements([]); setUndoHistory([]); setRedo([])
    }
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
    if (t.action === 'magnet') { const enabled = !magnetMode; setMagnetMode(enabled); setNotice(enabled ? 'Magnet mode روشن شد؛ نقاط رسم به قیمت‌های کندل می‌چسبند.' : 'Magnet mode خاموش شد.'); return }
    if (t.action === 'lock') { const locked = !lockedDrawings; setLockedDrawings(locked); setNotice(locked ? 'ترسیم‌ها قفل شدند؛ رسم جدید موقتاً غیرفعال است.' : 'ترسیم‌ها آزاد شدند.'); return }
    if (!t.impl) { setNotice(`ابزار «${t.name}» هنوز پیاده‌سازی نشده است.`); return }
    if (lockedDrawings) { setNotice('برای رسم جدید ابتدا قفل ترسیم‌ها را باز کن.'); return }
    pendingAnchorRef.current = null; setPendingAnchor(null)
    measureAnchorRef.current = null; setMeasureAnchor(null)
    setTool(t.name)
    if (t.name === 'Trend line' || t.name === 'Fib retracement' || t.name === 'Measure') setNotice(`ابزار ${t.name} فعال شد؛ برای رسم، دو نقطه روی چارت انتخاب کن.`)
    else if (t.name === 'Brush') setNotice('قلم آزاد فعال شد؛ روی چارت بکش.')
    else if (t.name === 'Text' || t.name === 'Icon') setNotice(`ابزار ${t.name} فعال شد؛ روی چارت کلیک کن.`)
  }
  const undo = () => {
    const entry = undoHistory[undoHistory.length - 1]
    if (!entry) return
    switch (entry.kind) {
      case 'horizontal': setDrawings(items => items.slice(0, -1)); break
      case 'trend': setTrendLines(items => items.slice(0, -1)); break
      case 'fib': setFibDrawings(items => items.slice(0, -1)); break
      case 'brush': setBrushPaths(items => items.slice(0, -1)); break
      case 'text': setChartTexts(items => items.slice(0, -1)); break
      case 'icon': setChartIcons(items => items.slice(0, -1)); break
      case 'measure': setMeasurements(items => items.slice(0, -1)); break
    }
    setUndoHistory(items => items.slice(0, -1))
    setRedo(items => [...items, entry])
  }
  const redoDraw = () => {
    const entry = redo[redo.length - 1]
    if (!entry) return
    switch (entry.kind) {
      case 'horizontal': setDrawings(items => [...items, entry.value]); break
      case 'trend': setTrendLines(items => [...items, entry.value]); break
      case 'fib': setFibDrawings(items => [...items, entry.value]); break
      case 'brush': setBrushPaths(items => [...items, entry.value]); break
      case 'text': setChartTexts(items => [...items, entry.value]); break
      case 'icon': setChartIcons(items => [...items, entry.value]); break
      case 'measure': setMeasurements(items => [...items, entry.value]); break
    }
    setUndoHistory(items => [...items, entry])
    setRedo(items => items.slice(0, -1))
  }
  const drawingPointFromPointer = (clientX: number, clientY: number): Anchor | null => {
    const bounds = host.current?.getBoundingClientRect()
    const chart = chartRef.current
    const series = seriesRef.current
    if (!bounds || !chart || !series) return null
    const time = chart.timeScale().coordinateToTime(clientX - bounds.left)
    const price = series.coordinateToPrice(clientY - bounds.top)
    if (time === null || time === undefined || price === null) return null
    let point: Anchor = { time: Number(time), price: Number(price) }
    if (magnetMode && shown.length) {
      const candle = shown[indexByTime(shown, point.time)]
      if (candle) {
        const levels = [candle.open, candle.high, candle.low, candle.close]
        point = { time: Number(candle.time), price: levels.reduce((best, value) => Math.abs(value - point.price) < Math.abs(best - point.price) ? value : best, levels[0]) }
      }
    }
    return point
  }
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
        setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setChartTexts([]); setChartIcons([]); setMeasurements([]); setUndoHistory([]); setRedo([])
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
      setCandles(parsed); setFileName(file.name); setStoredBlob(null); setCloudSummary(null); setTestResults(null); setTrades([]); setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setChartTexts([]); setChartIcons([]); setMeasurements([]); setUndoHistory([]); setRedo([])
      setShowImport(false); setNotice(`${parsed.length.toLocaleString()} کندل وارد شد.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'خطا در خواندن CSV')
    } finally { setImportProgress(null) }
  }, [])
  const keyHeaders = (): Record<string, string> => (uploadKey.trim() ? { 'x-upload-key': uploadKey.trim() } : {})
  const resetSample = () => {
    setCandles(sampleFor('XAUUSD')); setFileName(''); setCompareSymbol(null); setStoredBlob(null); setCloudSummary(null); setSymbol('XAUUSD'); setTimeframe('15m'); setTrades([]); setTestResults(null)
    setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setChartTexts([]); setChartIcons([]); setMeasurements([]); setUndoHistory([]); setRedo([]); setMenu(null); setNotice('دیتای نمونه بازنشانی شد.')
  }
  const recordTrade = (side: Side) => {
    if (!last) return
    const entry = last.close
    const distance = Math.max((last.high - last.low) * 1.5, entry * .001)
    const stop = side === 'LONG' ? entry - distance : entry + distance
    const target = side === 'LONG' ? entry + distance * Number(rr) : entry - distance * Number(rr)
    setTrades(p => [{ id: Date.now(), side, entry, stop, target, exit: entry, result: 'OPEN', r: 0, entryIndex: visibleCount - 1, entryTime: Number(last.time), date: dateLabel(last.time) }, ...p])
    setBottomOpen(true)
    setNotice(`معامله ${side === 'LONG' ? 'خرید' : 'فروش'} ثبت شد؛ با رسیدن قیمت به حد ضرر یا حد سود (مثلاً با اجرای Replay) خودکار بسته می‌شود.`)
  }
  const closeOpenTrades = (onlyId?: number) => {
    if (!last) return
    let count = 0
    setTrades(list => list.map(t => {
      if (t.result !== 'OPEN' || (onlyId !== undefined && t.id !== onlyId)) return t
      count++
      const risk = Math.abs(t.entry - t.stop) || 1
      const r = (t.side === 'LONG' ? last.close - t.entry : t.entry - last.close) / risk - (Number(commission) || 0)
      return { ...t, exit: last.close, r, result: r > 0 ? 'WIN' as const : 'LOSS' as const }
    }))
    setNotice(count ? 'معاملات باز با آخرین قیمت بسته شدند.' : 'معامله‌ی بازی برای بستن وجود ندارد.')
  }
  // Cloud-backed data is aggregated on the server, so a new timeframe means a new request (any timeframe is allowed).
  const changeTimeframe = async (tf: string) => {
    if (tf === timeframe) return
    const previous = timeframe
    setTimeframe(tf)
    setMenu(null)
    if (!storedBlob) return
    const sec = TIMEFRAMES.find(t => t.label === tf)?.sec ?? 900
    setCloudProcessing(true)
    setNotice(`در حال ساخت کندل‌های ${tf} از دیتای ابری…`)
    try {
      const response = await fetch('/api/blob-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...keyHeaders() },
        body: JSON.stringify({ pathname: storedBlob.pathname, timeframeSec: sec, fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod), rr: Number(rr), riskPct: Number(riskPct), commission: Number(commission) }),
      })
      const payload = await response.json() as { error?: string; candles?: Candle[]; trades?: ClosedTrade[]; summary?: NonNullable<typeof cloudSummary> }
      if (!response.ok || !payload.candles || !payload.summary || !payload.trades) throw new Error(payload.error || 'Cloud processing failed')
      setCandles(payload.candles); setVisibleCount(payload.candles.length)
      setCloudSummary(payload.summary); setTestResults(payload.trades)
      setNotice(`تایم‌فریم ${tf} آماده شد.`)
    } catch (e) {
      setTimeframe(previous)
      setNotice(e instanceof Error ? e.message : 'تغییر تایم‌فریم ناموفق بود.')
    } finally { setCloudProcessing(false) }
  }
  const connectExistingBlob = useCallback(async (silent = false) => {
    setCloudProcessing(true)
    if (!silent) setNotice('در حال بارگذاری دیتای ذخیره‌شده…')
    try {
      const response = await fetch('/api/blob-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...keyHeaders() },
        body: JSON.stringify({ timeframeSec: tfSec, fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod), rr: Number(rr), riskPct: Number(riskPct), commission: Number(commission) }),
      })
      const payload = await response.json() as { error?: string; pathname?: string; rawCandles?: number; chartBars?: number; candles?: Candle[]; trades?: ClosedTrade[]; summary?: { totalTrades: number; wins: number; losses: number; netR: number; grossWin: number; grossLoss: number; profitFactor: number | null; winRate: number } }
      if (!response.ok || !payload.candles || !payload.summary || !payload.trades) throw new Error(payload.error || 'Could not connect existing Blob CSV')
      if (NOBITEX_SYMBOLS[activeSymbolRef.current]) return
      const name = (payload.pathname || 'XAUUSD.csv').split('/').pop() || 'XAUUSD.csv'
      setCandles(payload.candles); setFileName(name); setVisibleCount(payload.candles.length)
      setStoredBlob({ pathname: payload.pathname || name, size: 0, url: '' })
      setCloudSummary(payload.summary); setTestResults(payload.trades); setTrades([]); setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setChartTexts([]); setChartIcons([]); setMeasurements([]); setUndoHistory([]); setRedo([])
      setTesterTab('overview'); setShowImport(false)
      if (!silent) { setBottomOpen(true); setBottomTab('tester') }
      if (!silent) setNotice(`اتصال موفق: ${(payload.rawCandles?.toLocaleString() || '—')} کندل خام به ${(payload.chartBars?.toLocaleString() || '—')} کندل ${timeframe} تجمیع شد. برای سرعت، چارت آخرین ${Math.min(5000, payload.candles.length).toLocaleString()} کندل را نشان می‌دهد؛ آمار بک‌تست روی کل دیتاست محاسبه شده است.`)
    } catch (e) {
      if (!silent) setNotice(e instanceof Error ? e.message : 'اتصال به دیتای ذخیره‌شده ناموفق بود.')
    } finally { setCloudProcessing(false) }
  }, [uploadKey, tfSec, fastPeriod, slowPeriod, rr, riskPct, commission])

  // Visitors get the hosted dataset automatically; no key needed. Falls back to the sample data if none is stored.
  const autoLoaded = useRef(false)
  useEffect(() => {
    if (autoLoaded.current) return
    autoLoaded.current = true
    void connectExistingBlob(true)
  }, [connectExistingBlob])

  const runTest = async () => {
    if (Number(fastPeriod) < 2 || Number(slowPeriod) <= Number(fastPeriod) || Number(slowPeriod) > 200) { setNotice('میانگین سریع باید حداقل ۲ و کوچک‌تر از میانگین کند باشد (حداکثر ۲۰۰).'); return }
    if (storedBlob) {
      setCloudProcessing(true)
      try {
        const response = await fetch('/api/blob-process', { method: 'POST', headers: { 'Content-Type': 'application/json', ...keyHeaders() }, body: JSON.stringify({ pathname: storedBlob.pathname, timeframeSec: tfSec, fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod), rr: Number(rr), riskPct: Number(riskPct), commission: Number(commission) }) })
        const payload = await response.json() as { error?: string; candles?: Candle[]; rawCandles?: number; chartBars?: number; trades?: ClosedTrade[]; summary?: { totalTrades: number; wins: number; losses: number; netR: number; grossWin: number; grossLoss: number; profitFactor: number | null; winRate: number } }
        if (!response.ok || !payload.candles || !payload.summary || !payload.trades) throw new Error(payload.error || 'Cloud CSV processing failed')
        setCandles(payload.candles); setFileName(storedBlob.pathname.split('/').pop() || 'cloud-data.csv'); setVisibleCount(payload.candles.length)
        setCloudSummary(payload.summary); setTestResults(payload.trades); setTrades([]); setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setChartTexts([]); setChartIcons([]); setMeasurements([]); setUndoHistory([]); setRedo([])
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
    const rows = [...trades, ...(testResults ?? [])]
    if (!rows.length) { setNotice('هنوز معامله‌ای برای خروجی گرفتن وجود ندارد.'); return }
    const csv = ['id,side,entry,stop,target,exit,result,r,date', ...rows.map(t => [t.id, t.side, t.entry, t.stop, t.target, t.exit, t.result, t.r, t.date].join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'chartgold-trades.csv'; a.click(); URL.revokeObjectURL(url)
  }

  /* ---------- derived UI data ---------- */
  const tfButtons = QUICK_TF.includes(timeframe) ? QUICK_TF : [timeframe, ...QUICK_TF]
  const ActiveTypeIcon = CHART_TYPES.find(c => c.id === chartType)!.Icon
  const filtered = SYMBOLS.filter(s => !query.trim() || s.symbol.includes(query.trim().toUpperCase()) || s.name.toUpperCase().includes(query.trim().toUpperCase()))
  const groups = Array.from(new Set(SYMBOLS.map(s => s.group))).sort((a, b) => a === 'NOBITEX' ? -1 : b === 'NOBITEX' ? 1 : 0)
  const tradeRows = [...trades, ...(testResults ?? [])]
  const sp = SPEEDS[replay.speed]

  return <main className="tv-app" ref={rootRef}>
    {/* ===== TOP TOOLBAR ===== */}
    <header className="tv-top">
      <button className="tv-logo" title="ChartGold" aria-label="ChartGold"><Activity size={18}/></button>
      <i className="tv-sep"/>
      <button className="tv-btn tv-symbol" onClick={() => setSymbolDialog(true)} title={NOBITEX_SYMBOLS[symbol] ? "Nobitex live OHLC" : "Symbol Search"}><Search size={16}/><b>{symbol}{NOBITEX_SYMBOLS[symbol] ? (liveLoading ? " · loading" : liveConnected ? " · LIVE" : " · offline") : ""}</b></button>
      <button className="tv-btn mobile-sidebar-toggle" title="Open panels" aria-label="Open watchlist and panels" aria-expanded={mobilePanelOpen} onClick={() => { setPanel(p => p ?? 'watchlist'); setMobilePanelOpen(v => !v) }}><List size={17}/></button>
      <div className="tv-menu-wrap" data-menu>
        <button className={'tv-btn' + (compareSymbol ? ' sel' : '')} title="Compare or Add Symbol" aria-haspopup="menu" onClick={() => { if (!isDemo) { setNotice('مقایسه فقط روی نمادهای نمونه کار می‌کند؛ از Settings گزینه‌ی Reset to sample data را بزن.'); return } toggleMenu('compare') }}><Plus size={18}/></button>
        {menu === 'compare' && <div className="tv-menu wide" role="menu"><div className="tv-menu-title">Compare symbol</div>
          {SYMBOLS.filter(x => x.symbol !== symbol).map(x => <button key={x.symbol} role="menuitem" className={'tv-item' + (compareSymbol === x.symbol ? ' sel' : '')} onClick={() => { setCompareSymbol(x.symbol); setMenu(null); setNotice(`${x.symbol} روی چارت اضافه شد (هم‌مقیاس با ${symbol}).`) }}><i className="dot" style={{ background: x.color }}/><span>{x.symbol} · {x.name}</span>{compareSymbol === x.symbol && <Check size={14}/>}</button>)}
          {compareSymbol && <button role="menuitem" className="tv-item" onClick={() => { setCompareSymbol(null); setMenu(null) }}><X size={14}/><span>Remove comparison</span></button>}
          <div className="tv-menu-note">نماد انتخابی از اولین کندل قابل‌مشاهده هم‌قیمت با نماد اصلی رسم می‌شود تا حرکت‌ها قابل مقایسه باشند.</div></div>}
      </div>
      <i className="tv-sep"/>
      {tfButtons.map(tf => {
        const sec = TIMEFRAMES.find(t => t.label === tf)?.sec ?? 0
        return <button key={tf} className={'tv-btn tv-tf' + (timeframe === tf ? ' sel' : '')} disabled={cloudProcessing || (!storedBlob && sec < baseSec)} title={!storedBlob && sec < baseSec ? 'Finer than source data' : tf} onClick={() => void changeTimeframe(tf)}>{tf}</button>
      })}
      <div className="tv-menu-wrap" data-menu>
        <button className="tv-btn tv-narrow" title="Timeframes" onClick={() => toggleMenu('tf')}><ChevronDown size={14}/></button>
        {menu === 'tf' && <div className="tv-menu">{TIMEFRAMES.map(t => <button key={t.label} className={'tv-item' + (timeframe === t.label ? ' sel' : '')} disabled={cloudProcessing || (!storedBlob && t.sec < baseSec)} onClick={() => void changeTimeframe(t.label)}><span>{t.label}</span>{timeframe === t.label && <Check size={14}/>}</button>)}</div>}
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
          <div className="indicator-category">OSCILLATORS</div>
          {(!indicatorSearch.trim() || 'rsi relative strength index شاخص قدرت نسبی oscillator'.includes(indicatorSearch.toLowerCase())) &&
            <button className={'tv-item indicator-option' + (indicators.rsi ? ' sel' : '')} onClick={() => setIndicators(v => ({ ...v, rsi: !v.rsi }))}><i className="dot" style={{ background: '#a78bfa' }}/><span><b>Relative Strength Index</b><small>RSI · دوره 14 · پنل جداگانه</small></span>{indicators.rsi ? <Check size={15}/> : <Plus size={15}/>}</button>}
          {indicatorSearch.trim() && !'sma simple moving average میانگین متحرک rsi relative strength index شاخص قدرت نسبی oscillator'.includes(indicatorSearch.toLowerCase()) && <div className="indicator-empty">برای این جست‌وجو اندیکاتوری پیدا نشد.</div>}
          <div className="tv-menu-note">برای نمایش یا حذف اندیکاتور، روی نام آن بزن. SMA روی قیمت و RSI در پنل جداگانه نمایش داده می‌شود.</div>
        </div>}
      </div>
      <button className="tv-btn" title="Create Alert" onClick={() => { setPanel('alerts'); setAlertPrice(String(last?.close ?? '')); setShowAlertDialog(true); setMobilePanelOpen(false) }}><AlarmClock size={18}/><span className="tv-label">Alert</span></button>
      <button className={'tv-btn tv-replay' + (replay.active ? ' on' : '')} title="Bar Replay" onClick={toggleReplay}><Rewind size={18} fill="currentColor"/><span>Replay</span></button>
      <i className="tv-sep"/>
      <button className="tv-btn" title="Undo drawing" aria-label="Undo drawing" disabled={!undoHistory.length} onClick={undo}><Undo2 size={18}/></button>
      <button className="tv-btn" title="Redo drawing" aria-label="Redo drawing" disabled={!redo.length} onClick={redoDraw}><Redo2 size={18}/></button>
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
      {mobilePanelOpen && <button className="mobile-panel-backdrop" aria-label="Close panels" onClick={() => setMobilePanelOpen(false)}/>}
      {/* ===== LEFT DRAWING TOOLBAR ===== */}
      <aside className="tv-left" aria-label="Drawing tools">
        {TOOL_GROUPS.map((g, gi) => <div key={gi} className="tv-tool-group">{g.map(t => {
          const selected = t.action === 'hide' ? hideDrawings : t.action === 'magnet' ? magnetMode : t.action === 'lock' ? lockedDrawings : tool === t.name
          const Icon = t.action === 'hide' && hideDrawings ? EyeOff : t.action === 'lock' && lockedDrawings ? Unlock : t.Icon
          const activeTitle = t.action === 'magnet' && magnetMode ? 'Magnet mode (on)' : t.action === 'lock' && lockedDrawings ? 'Unlock drawings' : t.name
          return <button key={t.name} title={activeTitle} aria-label={activeTitle} aria-pressed={selected} className={'tv-tool' + (selected ? ' sel' : '')} onClick={() => pickTool(t)}><Icon size={20}/></button>
        })}</div>)}
        <div className="tv-spacer"/>
        <div className="tv-tool-group"><button className="tv-tool" title="Remove all drawings" aria-label="Remove all drawings" onClick={() => { setDrawings([]); setTrendLines([]); setFibDrawings([]); setBrushPaths([]); setActiveBrushPath([]); brushPathRef.current = []; setChartTexts([]); setChartIcons([]); setMeasurements([]); setPendingAnchor(null); pendingAnchorRef.current = null; setMeasureAnchor(null); measureAnchorRef.current = null; setUndoHistory([]); setRedo([]); setNotice('همه‌ی ترسیم‌های چارت پاک شدند.') }}><Trash2 size={20}/></button></div>
      </aside>

      {/* ===== CHART + BOTTOM ===== */}
      <section className="tv-center">
        <div className={'tv-chart-wrap' + (indicators.rsi ? ' tv-chart-wrap-rsi' : '')}>
          <div ref={host} className="tv-chart"/>
          {indicators.rsi && <div className="tv-rsi-pane"><div className="tv-rsi-title">RSI (14)</div><div ref={rsiHost} className="tv-rsi-chart"/></div>}
          {!hideDrawings && chartRef.current && seriesRef.current && <svg
            className="drawing-overlay"
            aria-label="Chart drawings"
            style={{ pointerEvents: tool === 'Brush' && !lockedDrawings ? 'auto' : 'none', cursor: tool === 'Brush' && !lockedDrawings ? 'crosshair' : 'default', touchAction: 'none' }}
            onPointerDown={e => {
              if (tool !== 'Brush' || lockedDrawings) return
              e.preventDefault(); e.stopPropagation()
              const point = drawingPointFromPointer(e.clientX, e.clientY)
              if (!point) return
              e.currentTarget.setPointerCapture(e.pointerId)
              brushPathRef.current = [point]
              setActiveBrushPath([point])
            }}
            onPointerMove={e => {
              if (tool !== 'Brush' || lockedDrawings || !brushPathRef.current.length) return
              const point = drawingPointFromPointer(e.clientX, e.clientY)
              if (!point) return
              const current = brushPathRef.current
              const previous = current[current.length - 1]
              if (Math.abs(point.time - previous.time) < 1 && Math.abs(point.price - previous.price) < 0.0000001) return
              const next = [...current, point]
              brushPathRef.current = next
              setActiveBrushPath(next)
            }}
            onPointerUp={e => {
              if (tool !== 'Brush' || !brushPathRef.current.length) return
              const point = drawingPointFromPointer(e.clientX, e.clientY)
              const path = point ? [...brushPathRef.current, point] : brushPathRef.current
              if (path.length > 1) {
                setBrushPaths(items => [...items, path])
                setUndoHistory(history => [...history, { kind: 'brush', value: path }]); setRedo([])
              }
              brushPathRef.current = []
              setActiveBrushPath([])
              e.preventDefault(); e.stopPropagation()
            }}
            onPointerCancel={() => { brushPathRef.current = []; setActiveBrushPath([]) }}
          >
            {trendLines.map((line, i) => {
              const x1 = chartRef.current!.timeScale().timeToCoordinate(line.a.time as UTCTimestamp)
              const x2 = chartRef.current!.timeScale().timeToCoordinate(line.b.time as UTCTimestamp)
              const y1 = seriesRef.current!.priceToCoordinate(line.a.price)
              const y2 = seriesRef.current!.priceToCoordinate(line.b.price)
              return x1 === null || x2 === null || y1 === null || y2 === null ? null : <line key={`trend-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#82b1ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            })}
            {fibDrawings.map((fib, i) => {
              const x1 = chartRef.current!.timeScale().timeToCoordinate(fib.a.time as UTCTimestamp)
              const x2 = chartRef.current!.timeScale().timeToCoordinate(fib.b.time as UTCTimestamp)
              if (x1 === null || x2 === null) return null
              const left = Math.min(x1, x2), right = Math.max(x1, x2)
              const levels = [0, .236, .382, .5, .618, .786, 1]
              return <g key={`fib-${i}`}>{levels.map(level => {
                const price = fib.a.price + (fib.b.price - fib.a.price) * level
                const y = seriesRef.current!.priceToCoordinate(price)
                return y === null ? null : <g key={level}><line x1={left} y1={y} x2={right} y2={y} stroke={level === .618 ? '#ffb74d' : '#b2b5be'} strokeWidth="1" strokeDasharray="4 3"/><text x={right - 4} y={y - 3} fill={level === .618 ? '#ffb74d' : '#b2b5be'} fontSize="10" textAnchor="end">{(level * 100).toFixed(1)}%</text></g>
              })}</g>
            })}
            {pendingAnchor && (() => { const x = chartRef.current!.timeScale().timeToCoordinate(pendingAnchor.time as UTCTimestamp); const y = seriesRef.current!.priceToCoordinate(pendingAnchor.price); return x === null || y === null ? null : <circle cx={x} cy={y} r="4" fill="#82b1ff"/> })()}
            {measureAnchor && (() => { const x = chartRef.current!.timeScale().timeToCoordinate(measureAnchor.time as UTCTimestamp); const y = seriesRef.current!.priceToCoordinate(measureAnchor.price); return x === null || y === null ? null : <circle cx={x} cy={y} r="4" fill="#ffb74d"/> })()}
            {[...brushPaths, ...(activeBrushPath.length ? [activeBrushPath] : [])].map((path, i) => {
              const pts = path.map(point => {
                const x = chartRef.current!.timeScale().timeToCoordinate(point.time as UTCTimestamp)
                const y = seriesRef.current!.priceToCoordinate(point.price)
                return x === null || y === null ? null : `${x},${y}`
              }).filter((value): value is string => value !== null)
              return pts.length > 1 ? <polyline key={`brush-${i}`} points={pts.join(' ')} fill="none" stroke="#82b1ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/> : null
            })}
            {chartTexts.map(item => {
              const x = chartRef.current!.timeScale().timeToCoordinate(item.time as UTCTimestamp)
              const y = seriesRef.current!.priceToCoordinate(item.price)
              if (x === null || y === null) return null
              const width = Math.max(54, item.text.length * 7.1 + 16)
              return <g key={item.id}><rect x={x + 7} y={y - 28} width={width} height="24" rx="4" fill="#1e222d" stroke="#82b1ff" strokeWidth="1"/><text x={x + 15} y={y - 12} fontSize="11" fill="#e0e3eb">{item.text}</text></g>
            })}
            {chartIcons.map(item => {
              const x = chartRef.current!.timeScale().timeToCoordinate(item.time as UTCTimestamp)
              const y = seriesRef.current!.priceToCoordinate(item.price)
              return x === null || y === null ? null : <text key={item.id} className="annotation-icon" x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="21">{item.icon}</text>
            })}
            {measurements.map((measure, i) => {
              const x1 = chartRef.current!.timeScale().timeToCoordinate(measure.a.time as UTCTimestamp)
              const x2 = chartRef.current!.timeScale().timeToCoordinate(measure.b.time as UTCTimestamp)
              const y1 = seriesRef.current!.priceToCoordinate(measure.a.price)
              const y2 = seriesRef.current!.priceToCoordinate(measure.b.price)
              if (x1 === null || x2 === null || y1 === null || y2 === null) return null
              const delta = measure.b.price - measure.a.price
              const pct = measure.a.price ? delta / measure.a.price * 100 : 0
              const label = `${delta >= 0 ? '+' : ''}${fmt(delta, digits)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`
              const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
              const width = Math.max(94, label.length * 6.6 + 16)
              return <g key={`measure-${i}`}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffb74d" strokeWidth="1.5" strokeDasharray="4 3"/><circle cx={x1} cy={y1} r="3" fill="#ffb74d"/><circle cx={x2} cy={y2} r="3" fill="#ffb74d"/><rect x={cx - width / 2} y={cy - 22} width={width} height="20" rx="4" fill="#1e222d" stroke="#ffb74d" strokeWidth="1"/><text x={cx} y={cy - 9} fontSize="10" fill="#ffcc80" textAnchor="middle">{label}</text></g>
            })}
          </svg>}
          <div className="tv-legend">
            <div className="tv-legend-title"><b>{info.name}</b><span>·</span><span>{timeframe}</span><span>·</span><span>{isDemo ? 'SAMPLE' : fileName}</span></div>
            {bar && <div className="tv-legend-ohlc">
              {(['O', 'H', 'L', 'C'] as const).map(k => { const v = { O: bar.open, H: bar.high, L: bar.low, C: bar.close }[k]; return <span key={k} className={barUp ? 'up' : 'down'}><em>{k}</em>{fmt(v, digits)}</span> })}
              <span className={barChg >= 0 ? 'up' : 'down'}>{sgn(barChg)}{fmt(Math.abs(barChg), digits)} ({sgn(barPct)}{Math.abs(barPct).toFixed(2)}%)</span>
            </div>}
            {indicators.fast && <div className="tv-legend-ind"><span style={{ color: '#2962ff' }}>SMA {fastPeriod}</span></div>}
            {indicators.slow && <div className="tv-legend-ind"><span style={{ color: '#ff9800' }}>SMA {slowPeriod}</span></div>}
            {compareSymbol && isDemo && <div className="tv-legend-ind"><span style={{ color: SYMBOLS.find(x => x.symbol === compareSymbol)?.color }}>{compareSymbol} (rebased)</span></div>}
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
            <button className="tv-ghost" onClick={() => closeOpenTrades()} disabled={!trades.some(t => t.result === 'OPEN')}>Close open trades ({trades.filter(t => t.result === 'OPEN').length})</button>
            <button className="tv-ghost" onClick={() => { setBottomTab('tester'); setTesterTab('trades') }}>Open trade log ({trades.length})</button>
            {trades.length > 0 && <div className="tv-trade-mini"><table className="tv-table"><thead><tr><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Status</th><th>R</th><th></th></tr></thead><tbody>{trades.slice(0, 6).map(t => <tr key={t.id}><td className={t.side === 'LONG' ? 'up' : 'down'}>{t.side}</td><td>{fmt(t.entry, digits)}</td><td>{fmt(t.stop, digits)}</td><td>{fmt(t.target, digits)}</td><td><span className={t.result === 'OPEN' ? 'pill open' : t.r > 0 ? 'pill win' : 'pill loss'}>{t.result}</span></td><td className={t.result === 'OPEN' ? '' : t.r > 0 ? 'up' : 'down'}>{t.result === 'OPEN' ? '—' : t.r.toFixed(2) + 'R'}</td><td>{t.result === 'OPEN' && <button className="tv-ghost" onClick={() => closeOpenTrades(t.id)}>Close</button>}</td></tr>)}</tbody></table></div>}
          </div>}
        </div>
      </section>

      {/* ===== RIGHT SIDEBAR ===== */}
      <aside className={'tv-right' + (mobilePanelOpen ? ' mobile-open' : '')}>
        {panel && <section className="tv-panel">
          {panel === 'watchlist' && <>
            <div className="tv-panel-head"><span className="tv-panel-title">Watchlist</span><div className="tv-spacer"/><button className="tv-btn tv-narrow" title="Add symbol" onClick={() => setSymbolDialog(true)}><Plus size={17}/></button>
              <div className="tv-menu-wrap" data-menu>
                <button className={'tv-btn tv-narrow' + (wlSort !== 'default' ? ' sel' : '')} title="More" aria-haspopup="menu" onClick={() => toggleMenu('wlmore')}><Ellipsis size={17}/></button>
                {menu === 'wlmore' && <div className="tv-menu right" role="menu"><div className="tv-menu-title">Sort watchlist</div>
                  {([['default', 'Default order'], ['symbol', 'Symbol A → Z'], ['change', 'Change % (high → low)']] as const).map(([id, label]) => <button key={id} role="menuitem" className={'tv-item' + (wlSort === id ? ' sel' : '')} onClick={() => { setWlSort(id); setMenu(null) }}><span>{label}</span>{wlSort === id && <Check size={14}/>}</button>)}
                  <button role="menuitem" className="tv-item" onClick={() => { setMenu(null); setSymbolDialog(true) }}><Plus size={14}/><span>Add symbol…</span></button></div>}
              </div></div>
            <div className="tv-wl-cols"><span>Symbol</span><span>Last</span><span>Chg</span><span>Chg%</span></div>
            <div className="tv-wl-list">{groups.map(g => <div key={g}><div className="tv-wl-group"><ChevronDown size={12}/>{g === 'NOBITEX' ? 'CRYPTO · LIVE NOBITEX' : g}</div>
              {SYMBOLS.filter(s => s.group === g).sort((a, b) => { const pct = (x: SymbolInfo) => x.symbol === symbol ? activeStats.pct : dayStats(demos[x.symbol], demos[x.symbol].length - 1, 96).pct; return wlSort === 'symbol' ? a.symbol.localeCompare(b.symbol) : wlSort === 'change' ? pct(b) - pct(a) : 0 }).map(s => {
                const active = s.symbol === symbol
                const liveOnly = Boolean(NOBITEX_SYMBOLS[s.symbol])
                const st = active ? (liveOnly && !candles.length ? null : activeStats) : liveOnly ? null : dayStats(demos[s.symbol], demos[s.symbol].length - 1, 96)
                const cls = st && st.chg >= 0 ? 'up' : 'down'
                return <button key={s.symbol} className={'tv-wl-row' + (active ? ' active' : '')} onClick={() => selectSymbol(s.symbol)}>
                  <span className="tv-wl-sym"><i style={{ background: s.color }}>{s.symbol[0]}</i><b>{s.symbol}</b></span>
                  <span>{st ? fmt(st.last, s.digits) : '—'}</span><span className={st ? cls : ''}>{st ? `${sgn(st.chg)}${fmt(Math.abs(st.chg), s.digits)}` : '—'}</span><span className={st ? cls : ''}>{st ? `${sgn(st.pct)}${Math.abs(st.pct).toFixed(2)}%` : '—'}</span></button>
              })}</div>)}</div>
            <div className="tv-wl-detail">
              <div className="tv-wl-detail-head"><i style={{ background: info.color }}>{symbol[0]}</i><div><b>{symbol}</b><small>{info.name}</small></div></div>
              <div className="tv-wl-price"><strong>{fmt(activeStats.last, digits)}</strong><span className={activeStats.chg >= 0 ? 'up' : 'down'}>{sgn(activeStats.chg)}{fmt(Math.abs(activeStats.chg), digits)} {sgn(activeStats.pct)}{Math.abs(activeStats.pct).toFixed(2)}%</span></div>
              <div className="tv-wl-stats">
                <div><span>Open</span><b>{fmt(bar?.open ?? 0, digits)}</b></div><div><span>High</span><b>{fmt(bar?.high ?? 0, digits)}</b></div>
                <div><span>Low</span><b>{fmt(bar?.low ?? 0, digits)}</b></div><div><span>Prev close</span><b>{fmt(barPrev?.close ?? bar?.open ?? 0, digits)}</b></div>
              </div>
              <p className="tv-wl-note">{NOBITEX_SYMBOLS[symbol] ? (liveConnected ? 'داده زنده نوبیتکس؛ به‌روزرسانی تقریباً هر ۶۰ ثانیه.' : liveLoading ? 'در حال دریافت کندل‌های زنده از نوبیتکس…' : 'اتصال زنده برقرار نیست؛ نماد را دوباره انتخاب کن تا دریافت داده امتحان شود.') : 'قیمت‌ها نمونه‌اند مگر اینکه CSV خودت را وارد کنی.'}</p>
            </div>
          </>}
          {panel === 'alerts' && <><div className="tv-panel-head"><span className="tv-panel-title">Alerts ({priceAlerts.filter(a => a.active).length})</span><div className="tv-spacer"/><button className="tv-btn tv-narrow" title="Create alert" onClick={() => { setAlertPrice(String(last?.close ?? '')); setShowAlertDialog(true) }}><Plus size={17}/></button></div>
            {priceAlerts.length ? <div className="tv-wl-list">{priceAlerts.map(alert => <div key={alert.id} className="tv-dw"><div><b>{alert.symbol} {alert.direction === 'above' ? '≥' : '≤'} {fmt(alert.price, digits)}</b><span className={alert.active ? 'up' : ''}>{alert.active ? 'Active' : 'Triggered / inactive'}</span></div><button className="tv-ghost" onClick={() => setPriceAlerts(items => items.filter(a => a.id !== alert.id))}>Remove</button></div>)}<p className="tv-wl-note">هشدارها روی کندل‌های دیتای بارگذاری‌شده و Replay بررسی می‌شوند؛ قیمت زنده نیست.</p></div> : <div className="tv-empty tall"><Bell size={26}/><strong>No alerts yet</strong><span>Create an above/below price alert for the loaded chart.</span><button className="tv-primary" onClick={() => { setAlertPrice(String(last?.close ?? '')); setShowAlertDialog(true) }}>Create alert</button></div>}</>}
          {panel === 'data' && <><div className="tv-panel-head"><span className="tv-panel-title">Data Window</span></div>
            <div className="tv-dw"><b>{symbol} · {timeframe}</b><small>{dateLabel(bar?.time)} UTC</small>
              {bar && [['Open', bar.open], ['High', bar.high], ['Low', bar.low], ['Close', bar.close]].map(([k, v]) => <div key={k as string}><span>{k as string}</span><b className={barUp ? 'up' : 'down'}>{fmt(v as number, digits)}</b></div>)}
              <div><span>Change</span><b className={barChg >= 0 ? 'up' : 'down'}>{sgn(barChg)}{fmt(Math.abs(barChg), digits)} ({sgn(barPct)}{Math.abs(barPct).toFixed(2)}%)</b></div>
              {bar?.volume ? <div><span>Volume</span><b>{bar.volume.toLocaleString()}</b></div> : null}</div></>}
          {panel === 'notes' && <><div className="tv-panel-head"><div className="tv-panel-title"><NotebookPen size={15}/> Notes</div><div className="tv-spacer"/><button className="tv-btn tv-narrow" title="Clear notes" aria-label="Clear notes" onClick={() => setNoteDraft('')}><Trash2 size={15}/></button></div>
            <div className="tv-notes-wrap"><p className="tv-wl-note">Your trading plan, observations and ideas. Notes are saved automatically on this device.</p><textarea className="tv-notes-editor" aria-label="Trading notes" value={noteDraft} maxLength={20000} onChange={e => setNoteDraft(e.target.value)} placeholder="Write notes for this chart…&#10;&#10;• Setup:&#10;• Entry reason:&#10;• Risk:&#10;• What to improve:"/><div className="tv-notes-footer"><span>{noteDraft.length.toLocaleString()} / 20,000</span><span><Check size={13}/> Auto-saved</span></div></div></>}
        </section>}
        <nav className="tv-rail" aria-label="Right sidebar">
          <button className={'tv-rail-btn' + (panel === 'watchlist' ? ' sel' : '')} title="Watchlist" onClick={() => setPanel(p => (p === 'watchlist' ? null : 'watchlist'))}><List size={20}/></button>
          <button className={'tv-rail-btn' + (panel === 'alerts' ? ' sel' : '')} title="Alerts" onClick={() => setPanel(p => (p === 'alerts' ? null : 'alerts'))}><AlarmClock size={20}/></button>
          <button className={'tv-rail-btn' + (panel === 'data' ? ' sel' : '')} title="Data Window" aria-label="Data Window" onClick={() => setPanel(p => (p === 'data' ? null : 'data'))}><Info size={20}/></button>
          <button className={'tv-rail-btn' + (panel === 'notes' ? ' sel' : '')} title="Notes" aria-label="Notes" aria-pressed={panel === 'notes'} onClick={() => setPanel(p => (p === 'notes' ? null : 'notes'))}><StickyNote size={20}/></button>
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

    {showTextDialog && textAnchor && <div className="modal-backdrop" onClick={() => setShowTextDialog(false)}><section className="tv-dialog annotation-dialog" role="dialog" aria-modal="true" aria-label="Add chart text" onClick={e => e.stopPropagation()}><div className="tv-dialog-head"><strong>Add chart note</strong><button className="tv-btn tv-narrow" onClick={() => setShowTextDialog(false)} aria-label="Close"><X size={18}/></button></div><form className="alert-form" onSubmit={e => { e.preventDefault(); const value = textValue.trim(); if (!value) { setNotice('متن یادداشت نمی‌تواند خالی باشد.'); return } const item: ChartText = { ...textAnchor, id: Date.now(), text: value.slice(0, 160) }; setChartTexts(items => [...items, item]); setUndoHistory(history => [...history, { kind: 'text', value: item }]); setRedo([]); setShowTextDialog(false); setTextAnchor(null); setTextValue(''); setNotice('یادداشت روی چارت اضافه شد.') }}><label>Text on chart</label><input autoFocus maxLength={160} value={textValue} onChange={e => setTextValue(e.target.value)} placeholder="e.g. Liquidity sweep" /><p className="tv-wl-note">متن روی نقطه‌ای که انتخاب کردی قرار می‌گیرد.</p><button className="tv-primary" type="submit">Add text</button></form></section></div>}
    {showIconDialog && iconAnchor && <div className="modal-backdrop" onClick={() => setShowIconDialog(false)}><section className="tv-dialog annotation-dialog" role="dialog" aria-modal="true" aria-label="Add chart marker" onClick={e => e.stopPropagation()}><div className="tv-dialog-head"><strong>Add chart marker</strong><button className="tv-btn tv-narrow" onClick={() => setShowIconDialog(false)} aria-label="Close"><X size={18}/></button></div><div className="annotation-icon-grid">{['📌','⭐','✅','⚠️','🔥','🚀','💡','❌','🎯','👀','💎','🧠'].map(icon => <button key={icon} className="annotation-icon-choice" title={icon} onClick={() => { const item: ChartIcon = { ...iconAnchor, id: Date.now(), icon }; setChartIcons(items => [...items, item]); setUndoHistory(history => [...history, { kind: 'icon', value: item }]); setRedo([]); setShowIconDialog(false); setIconAnchor(null); setNotice('آیکون روی چارت اضافه شد.') }}>{icon}</button>)}</div><p className="tv-wl-note" style={{ padding: '0 14px 14px' }}>یک نشانگر برای نقطه‌ی انتخاب‌شده روی چارت انتخاب کن.</p></section></div>}
    {showAlertDialog && <div className="modal-backdrop" onClick={() => setShowAlertDialog(false)}><section className="tv-dialog alert-dialog" role="dialog" aria-modal="true" aria-label="Create price alert" onClick={e => e.stopPropagation()}><div className="tv-dialog-head"><strong>Create price alert · {symbol}</strong><button className="tv-btn tv-narrow" onClick={() => setShowAlertDialog(false)} aria-label="Close"><X size={18}/></button></div><form className="alert-form" onSubmit={e => { e.preventDefault(); const price = Number(alertPrice); if (!Number.isFinite(price) || price <= 0) { setNotice('قیمت هشدار باید عددی بزرگ‌تر از صفر باشد.'); return } setPriceAlerts(items => [...items, { id: Date.now(), symbol, price, direction: alertDirection, active: true }]); setPanel('alerts'); setShowAlertDialog(false); setNotice(`هشدار ${alertDirection === 'above' ? 'بالای' : 'پایین'} ${fmt(price, digits)} برای ${symbol} ساخته شد.`) }}><label>Trigger when price is</label><select value={alertDirection} onChange={e => setAlertDirection(e.target.value as 'above' | 'below')}><option value="above">At or above</option><option value="below">At or below</option></select><label>Target price</label><input type="number" min="0.00000001" step="any" required value={alertPrice} onChange={e => setAlertPrice(e.target.value)} /><p className="tv-wl-note">این هشدار روی داده‌های چارت و Bar Replay اجرا می‌شود و اعلان قیمت زنده نیست.</p><button className="tv-primary" type="submit">Save alert</button></form></section></div>}

    {notice && <div className="toast" role="status"><Bell size={16}/><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}

    {showImport && <div className="modal-backdrop" onClick={() => setShowImport(false)}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={e => e.stopPropagation()}><div className="modal-head"><div><strong id="import-title">Import historical data</strong><span>CSV · OHLC candles</span></div><button className="tv-btn tv-narrow" onClick={() => setShowImport(false)} aria-label="Close"><X size={18}/></button></div><label className="file-drop"><FileUp size={28}/><strong>Choose a CSV file</strong><span>Required: DATE / DTYYYYMMDD, OPEN, HIGH, LOW, CLOSE. Optional: TIME, VOL.</span>{importProgress !== null && <div className="import-progress"><div className="import-progress-label"><span>Streaming CSV locally…</span><strong>{importProgress}%</strong></div><div className="import-progress-track"><div className="import-progress-fill" style={{ width: `${importProgress}%` }} /></div></div>}<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => importFile(e.target.files?.[0])}/></label>
      <div className="modal-tip">Local import draws the chart immediately, but very large files can still use substantial browser memory.</div>
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <button className="tv-primary" onClick={() => connectExistingBlob()} disabled={cloudProcessing || blobUploadProgress !== null}>{cloudProcessing ? 'Loading saved data…' : 'Reload hosted data'}</button>
        <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--muted)' }}>Owner only: upload key (needed just to upload new data)<input type="password" autoComplete="off" value={uploadKey} onChange={e => setUploadKey(e.target.value)} placeholder="Enter your private upload key" style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)' }} /></label>
        <label className="file-drop"><Upload size={25}/><strong>Owner: upload a new CSV to cloud storage</strong><span>Multipart upload with progress · maximum 1 GB</span>{blobUploadProgress !== null && <div className="import-progress"><div className="import-progress-label"><span>Uploading to Blob…</span><strong>{blobUploadProgress}%</strong></div><div className="import-progress-track"><div className="import-progress-fill" style={{ width: `${blobUploadProgress}%` }} /></div></div>}<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => uploadFileToBlob(e.target.files?.[0])}/></label>
        {storedBlob && <div className="modal-tip">Stored privately: {storedBlob.pathname} · {(storedBlob.size / (1024 * 1024)).toFixed(1)} MB</div>}
        {storedBlob && <button className="tv-primary" onClick={runTest} disabled={cloudProcessing || blobUploadProgress !== null}>{cloudProcessing ? 'Processing cloud CSV…' : 'Analyze full cloud CSV'}</button>}
        <div className="modal-tip">Cloud analysis streams the private CSV on the server and returns the last 5,000 chart bars plus full-dataset backtest statistics. Very large files may exceed the serverless function time limit; this is not a persistent background job.</div>
      </div></section></div>}
  </main>
}

export default App
