import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CandlestickSeries, ColorType, type IChartApi, type ISeriesApi, type CandlestickData, type UTCTimestamp } from 'lightweight-charts'
import { Activity, AlertTriangle, BarChart3, Bell, Bookmark, ChevronDown, CircleHelp, Clock3, Crosshair, Download, Eye, FileUp, FlaskConical, LineChart, ListFilter, Maximize2, Menu, Minus, MousePointer2, Pause, Pencil, Play, Plus, RotateCcw, Ruler, Search, Settings2, ShieldCheck, SlidersHorizontal, TrendingDown, TrendingUp, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'

type Candle = CandlestickData<UTCTimestamp> & { volume?: number }
type Side = 'LONG' | 'SHORT'
type Trade = { id: number; side: Side; entry: number; stop: number; target: number; exit: number; result: 'WIN' | 'LOSS' | 'OPEN'; r: number; entryIndex: number; exitIndex?: number; date: string }
type ClosedTrade = Trade & { result: 'WIN' | 'LOSS' }
const demo: Candle[] = Array.from({ length: 320 }, (_, i) => {
  const wave = Math.sin(i * .13) * 8 + Math.sin(i * .037) * 13 + Math.sin(i * .41) * 2.1
  const trend = i < 75 ? i * -.035 : i < 170 ? (i - 75) * .12 - 2.6 : i < 245 ? 11.8 - (i - 170) * .16 : -.2 + (i - 245) * .08
  const base = 3972 + wave + trend
  const open = base + Math.sin(i * 1.7) * 1.25
  const close = base + Math.cos(i * 1.23) * 1.9
  return { time: (Date.UTC(2025, 0, 2, 0, i * 15) / 1000) as UTCTimestamp, open: +open.toFixed(2), high: +(Math.max(open, close) + .7 + Math.abs(Math.sin(i)) * 1.4).toFixed(2), low: +(Math.min(open, close) - .65 - Math.abs(Math.cos(i)) * 1.2).toFixed(2), close: +close.toFixed(2) }
})
const fmt = (n: number, digits = 2) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const dateLabel = (t?: UTCTimestamp) => t ? new Date(Number(t) * 1000).toISOString().replace('T', ' ').slice(0, 16) : '—'

function parseCsv(raw: string): Candle[] {
  const lines = raw.trim().split(/\r?\n/)
  if (lines.length < 2) throw new Error('CSV باید سطر عنوان و حداقل یک کندل داشته باشد.')
  const header = lines[0].replace(/^\uFEFF/, '').split(/[,;\t]/).map(x => x.trim().replace(/[<>]/g, '').toUpperCase())
  const find = (...names: string[]) => header.findIndex(h => names.includes(h))
  const dateIdx = find('DTYYYYMMDD', 'DATE', 'DATETIME', 'TIMESTAMP')
  const timeIdx = find('TIME')
  const oi = find('OPEN'), hi = find('HIGH'), li = find('LOW'), ci = find('CLOSE')
  if ([oi, hi, li, ci].some(i => i < 0) || dateIdx < 0) throw new Error('ستون‌های DATE/TIME و OPEN, HIGH, LOW, CLOSE در فایل پیدا نشدند.')
  const result: Candle[] = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = line.split(/[,;\t]/).map(x => x.trim())
    const rawDate = cells[dateIdx] ?? ''
    const rawTime = timeIdx >= 0 ? (cells[timeIdx] ?? '000000').padStart(6, '0') : '000000'
    let timestamp = Number(rawDate)
    if (/^\d{8}$/.test(rawDate)) {
      timestamp = Date.UTC(+rawDate.slice(0, 4), +rawDate.slice(4, 6) - 1, +rawDate.slice(6, 8), +rawTime.slice(0, 2), +rawTime.slice(2, 4), +rawTime.slice(4, 6)) / 1000
    } else if (!Number.isFinite(timestamp) || timestamp < 1000000000) {
      const parsed = Date.parse(rawDate)
      if (!Number.isFinite(parsed)) continue
      timestamp = parsed / 1000
    }
    const open = Number(cells[oi]), high = Number(cells[hi]), low = Number(cells[li]), close = Number(cells[ci])
    if (![timestamp, open, high, low, close].every(Number.isFinite) || high < low || timestamp <= 0) continue
    result.push({ time: Math.floor(timestamp) as UTCTimestamp, open, high, low, close, volume: Number(cells[find('VOL', 'VOLUME')]) || 0 })
  }
  result.sort((a, b) => Number(a.time) - Number(b.time))
  const unique = result.filter((c, i) => i === 0 || c.time !== result[i - 1].time)
  if (!unique.length) throw new Error('هیچ کندل معتبر OHLC پیدا نشد.')
  return unique
}
function sma(values: number[], period: number, index: number) {
  if (index + 1 < period) return NaN
  let total = 0
  for (let i = index - period + 1; i <= index; i++) total += values[i]
  return total / period
}
function runBacktest(candles: Candle[], fastPeriod: number, slowPeriod: number, rr: number, riskPct: number, commission: number): ClosedTrade[] {
  const trades: ClosedTrade[] = []
  const closes = candles.map(c => c.close)
  let open: Trade | null = null
  let equity = 10000
  let id = 1
  for (let i = Math.max(slowPeriod, 2); i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1]
    if (open) {
      const stopHit = open.side === 'LONG' ? c.low <= open.stop : c.high >= open.stop
      const targetHit = open.side === 'LONG' ? c.high >= open.target : c.low <= open.target
      if (stopHit || targetHit) {
        // If both levels are touched in one candle, conservatively assume the stop was hit first.
        const exit = stopHit ? open.stop : open.target
        const r = (open.side === 'LONG' ? exit - open.entry : open.entry - exit) / Math.abs(open.entry - open.stop)
        const result: ClosedTrade = { ...open, exit, result: r > 0 ? 'WIN' : 'LOSS', r: r - commission / Math.max(1, Math.abs(open.entry - open.stop)), exitIndex: i }
        trades.push(result); equity += equity * (riskPct / 100) * result.r; open = null
      }
    }
    const fastNow = sma(closes, fastPeriod, i), slowNow = sma(closes, slowPeriod, i)
    const fastPrev = sma(closes, fastPeriod, i - 1), slowPrev = sma(closes, slowPeriod, i - 1)
    if (!open && Number.isFinite(fastPrev) && Number.isFinite(slowPrev)) {
      const side: Side | null = fastPrev <= slowPrev && fastNow > slowNow ? 'LONG' : fastPrev >= slowPrev && fastNow < slowNow ? 'SHORT' : null
      if (side) {
        const range = Math.max(c.high - c.low, Math.abs(c.close - c.open), c.close * .0008)
        const entry = c.close, stop = side === 'LONG' ? entry - range * 1.6 : entry + range * 1.6
        const target = side === 'LONG' ? entry + Math.abs(entry - stop) * rr : entry - Math.abs(entry - stop) * rr
        open = { id: id++, side, entry, stop, target, exit: entry, result: 'OPEN', r: 0, entryIndex: i, date: dateLabel(c.time) }
      }
    }
  }
  if (open) trades.push({ ...open, exit: candles[candles.length - 1].close, result: 'LOSS', r: (open.side === 'LONG' ? candles[candles.length - 1].close - open.entry : open.entry - candles[candles.length - 1].close) / Math.abs(open.entry - open.stop), exitIndex: candles.length - 1 })
  return trades
}

function App() {
  const host = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [candles, setCandles] = useState<Candle[]>(demo)
  const [symbol, setSymbol] = useState('XAUUSD')
  const [timeframe, setTimeframe] = useState('15m')
  const [visibleCount, setVisibleCount] = useState(demo.length)
  const [playing, setPlaying] = useState(false)
  const [activeTab, setActiveTab] = useState('Strategy Tester')
  const [tool, setTool] = useState('Cursor')
  const [notice, setNotice] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [fileName, setFileName] = useState('')
  const [trades, setTrades] = useState<Trade[]>([])
  const [fastPeriod, setFastPeriod] = useState('9')
  const [slowPeriod, setSlowPeriod] = useState('21')
  const [rr, setRr] = useState('2')
  const [riskPct, setRiskPct] = useState('1')
  const [commission, setCommission] = useState('0')
  const [testResults, setTestResults] = useState<ClosedTrade[] | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [watchlistOpen, setWatchlistOpen] = useState(true)
  const shown = useMemo(() => candles.slice(0, Math.max(1, Math.min(visibleCount, candles.length))), [candles, visibleCount])
  const last = shown[shown.length - 1]
  const prev = shown[Math.max(0, shown.length - 2)]
  const delta = last && prev ? last.close - prev.close : 0
  const pct = prev?.close ? delta / prev.close * 100 : 0
  const closed = testResults ?? trades.filter(t => t.result !== 'OPEN') as ClosedTrade[]
  const wins = closed.filter(t => t.r > 0).length
  const losses = closed.length - wins
  const netR = closed.reduce((sum, t) => sum + t.r, 0)
  const grossWin = closed.filter(t => t.r > 0).reduce((sum, t) => sum + t.r, 0)
  const grossLoss = Math.abs(closed.filter(t => t.r < 0).reduce((sum, t) => sum + t.r, 0))
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin ? Infinity : 0

  useEffect(() => {
    if (!host.current) return
    const chart = createChart(host.current, {
      width: host.current.clientWidth, height: host.current.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#b2b5be', fontFamily: '-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif', fontSize: 12 },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: .1, bottom: .12 } },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 8 },
      crosshair: { vertLine: { color: '#758696', labelBackgroundColor: '#2962ff' }, horzLine: { color: '#758696', labelBackgroundColor: '#2962ff' } },
      handleScroll: true, handleScale: true,
    })
    const series = chart.addSeries(CandlestickSeries, { upColor: '#089981', downColor: '#f23645', borderUpColor: '#089981', borderDownColor: '#f23645', wickUpColor: '#089981', wickDownColor: '#f23645' })
    chartRef.current = chart; seriesRef.current = series
    const resize = () => { if (host.current) chart.applyOptions({ width: host.current.clientWidth, height: host.current.clientHeight }) }
    const observer = new ResizeObserver(resize); observer.observe(host.current)
    return () => { observer.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return
    seriesRef.current.setData(shown)
    chartRef.current.timeScale().fitContent()
  }, [shown])
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setVisibleCount(v => { if (v >= candles.length) { setPlaying(false); return v }; return v + 1 }), 350)
    return () => window.clearInterval(id)
  }, [playing, candles.length])
  const importFile = useCallback(async (file?: File) => {
    if (!file) return
    try {
      const parsed = parseCsv(await file.text())
      setCandles(parsed); setVisibleCount(parsed.length); setFileName(file.name); setTestResults(null); setTrades([]); setShowImport(false); setNotice(`${parsed.length.toLocaleString()} کندل وارد شد.`)
    } catch (e) { setNotice(e instanceof Error ? e.message : 'خطا در خواندن CSV') }
  }, [])
  const recordTrade = (side: Side) => {
    if (!last) return
    const entry = last.close
    const distance = Math.max((last.high - last.low) * 1.5, entry * .001)
    const stop = side === 'LONG' ? entry - distance : entry + distance
    const target = side === 'LONG' ? entry + distance * Number(rr) : entry - distance * Number(rr)
    setTrades(p => [{ id: Date.now(), side, entry, stop, target, exit: entry, result: 'OPEN', r: 0, entryIndex: visibleCount - 1, date: dateLabel(last.time) }, ...p])
    setActiveTab('List of Trades'); setNotice(`معامله ${side === 'LONG' ? 'خرید' : 'فروش'} ثبت شد؛ خروجی خودکار برای این معامله هنوز فعال نیست.`)
  }
  const runTest = () => {
    if (Number(fastPeriod) < 2 || Number(slowPeriod) <= Number(fastPeriod) || Number(slowPeriod) > 200) { setNotice('میانگین سریع باید حداقل ۲ و کوچک‌تر از میانگین کند باشد (حداکثر ۲۰۰).'); return }
    const result = runBacktest(candles, Number(fastPeriod), Number(slowPeriod), Number(rr), Number(riskPct), Number(commission))
    setTestResults(result); setActiveTab('Overview'); setNotice(`بک‌تست تمام شد؛ ${result.length} معامله بررسی شد.`)
  }
  const exportTrades = () => {
    const data = testResults ?? trades
    if (!data.length) { setNotice('هنوز معامله‌ای برای خروجی گرفتن وجود ندارد.'); return }
    const csv = ['id,side,entry,stop,target,exit,result,r,date', ...data.map(t => [t.id,t.side,t.entry,t.stop,t.target,t.exit,t.result,t.r,t.date].join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'chartgold-trades.csv'; a.click(); URL.revokeObjectURL(url)
  }
  const reset = () => { setCandles(demo); setVisibleCount(demo.length); setFileName(''); setSymbol('XAUUSD'); setTrades([]); setTestResults(null); setPlaying(false); setNotice('دیتای نمونه بازنشانی شد.') }

  return <main className="tv-app">
    <header className="tv-topbar">
      <button className="top-icon mobile-menu" aria-label="Open menu" onClick={() => setWatchlistOpen(v => !v)}><Menu size={18}/></button>
      <a className="tv-logo" href="#" aria-label="ChartGold home"><span className="logo-mark"><Activity size={18}/></span><span>ChartGold</span></a>
      <button className="symbol-select" onClick={() => setShowSettings(v => !v)}><strong>{symbol}</strong><ChevronDown size={14}/></button>
      <div className="top-change"><strong className={delta >= 0 ? 'up' : 'down'}>{fmt(last?.close ?? 0)}</strong><span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(pct), 2)}%</span></div>
      <div className="top-separator"/>
      <div className="quick-search"><Search size={15}/><input aria-label="Search symbol" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase().slice(0, 12))} onKeyDown={e => e.key === 'Enter' && setShowSettings(false)} placeholder="Search"/></div>
      <div className="top-spacer"/>
      <button className="top-icon" title="Alert" onClick={() => setNotice('هشدار قیمت در نسخه‌ی بعدی اضافه می‌شود.')}><Bell size={17}/></button>
      <button className="top-icon" title="Settings" onClick={() => setShowSettings(v => !v)}><Settings2 size={17}/></button>
      <button className="publish-button" onClick={exportTrades}><Download size={15}/> Export</button>
    </header>
    {showSettings && <div className="symbol-popover"><strong>Chart settings</strong><p>Market: {symbol || 'XAUUSD'}</p><p>Chart mode: Candles · Historical replay</p><button className="small-action" onClick={() => {setShowImport(true);setShowSettings(false)}}>Import historical data</button></div>}
    <div className="market-toolbar">
      <div className="toolbar-group"><button className="tool-main"><span className="ticker-icon">Au</span><span><strong>{symbol}</strong><small>Gold / U.S. Dollar</small></span><ChevronDown size={13}/></button></div>
      <span className="toolbar-divider"/>
      <div className="timeframes">{['1m','5m','15m','30m','1h','4h','1D','1W'].map(tf => <button key={tf} className={timeframe === tf ? 'tf-button selected' : 'tf-button'} onClick={() => setTimeframe(tf)}>{tf}</button>)}</div>
      <span className="toolbar-divider desktop-only"/>
      <div className="toolbar-group desktop-only"><button className="toolbar-action" onClick={() => setNotice('نوع نمودار: کندل ژاپنی')}><CandlestickIcon/> <ChevronDown size={12}/></button><button className="toolbar-action" onClick={() => setNotice('Indicators: SMA crossover در Strategy Tester قابل تنظیم است.')}><LineChart size={16}/> Indicators</button></div>
      <div className="toolbar-spacer"/>
      <button className="toolbar-action" onClick={() => setShowImport(true)}><Upload size={15}/> Import</button>
      <button className="toolbar-action" onClick={reset}><RotateCcw size={15}/><span className="desktop-only">Reset</span></button>
    </div>
    <div className="terminal-layout">
      <aside className="left-tools" aria-label="Drawing tools">
        {[{name:'Cursor', Icon:MousePointer2}, {name:'Crosshair', Icon:Crosshair}, {name:'Trend line', Icon:TrendingUp}, {name:'Brush', Icon:Pencil}, {name:'Horizontal line', Icon:Minus}, {name:'Measure', Icon:Ruler}, {name:'Zoom in', Icon:ZoomIn}, {name:'Zoom out', Icon:ZoomOut}, {name:'Hide drawings', Icon:Eye}].map(({name, Icon}) => <button key={name} title={name} aria-label={name} className={tool === name ? 'left-tool selected' : 'left-tool'} onClick={() => {setTool(name); if (name !== 'Cursor' && name !== 'Crosshair') setNotice(`ابزار ${name} انتخاب شد؛ رسم تعاملی این ابزار هنوز پیاده‌سازی نشده.`)}}><Icon size={18}/></button>)}
        <span className="tool-spacer"/><button className="left-tool" title="Remove drawings" onClick={() => setNotice('موردی برای پاک کردن انتخاب نشده است.')}><X size={17}/></button>
      </aside>
      <section className="chart-area">
        <div className="chart-meta"><div className="chart-name"><span className="asset-avatar">Au</span><div><strong>{symbol} · {timeframe.toUpperCase()}</strong><small>{fileName || 'Historical sample data'} {candles === demo ? '· SAMPLE' : ''}</small></div></div><div className="ohlc-values"><span>O <b>{fmt(last?.open ?? 0)}</b></span><span>H <b className="up">{fmt(last?.high ?? 0)}</b></span><span>L <b className="down">{fmt(last?.low ?? 0)}</b></span><span>C <b className={delta >= 0 ? 'up' : 'down'}>{fmt(last?.close ?? 0)}</b></span></div><div className="chart-meta-actions"><button className="top-icon" title="Save layout" onClick={() => setNotice('ذخیره‌ی layout در نسخه‌ی بعدی اضافه می‌شود.')}><Bookmark size={16}/></button><button className="top-icon" title="Fullscreen" onClick={() => host.current?.requestFullscreen?.()}><Maximize2 size={16}/></button></div></div>
        <div className="chart-canvas-wrap"><div ref={host} className="chart-canvas"/><div className="chart-watermark"><span>ChartGold</span><small>BACKTEST LAB</small></div><div className="chart-live-price"><span className={delta >= 0 ? 'up-bg' : 'down-bg'}>{fmt(last?.close ?? 0)}</span></div><div className="chart-bottom-label">{dateLabel(last?.time)}</div></div>
        <div className="chart-status"><span><i className="status-dot"/> {candles.length.toLocaleString()} bars</span><span>{dateLabel(shown[0]?.time)} — {dateLabel(last?.time)}</span><span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta))} ({pct.toFixed(2)}%)</span></div>
        <div className="replay-strip"><div className="replay-title"><Clock3 size={15}/><strong>Bar Replay</strong><span>{visibleCount.toLocaleString()} / {candles.length.toLocaleString()}</span></div><div className="replay-buttons"><button className="round-control" aria-label="Previous 10 bars" onClick={() => {setPlaying(false);setVisibleCount(v => Math.max(1,v-10))}}><TrendingDown size={15}/></button><button className="play-control" onClick={() => {if(visibleCount >= candles.length) setVisibleCount(1);setPlaying(v=>!v)}}>{playing ? <Pause size={15}/> : <Play size={15}/>}<span>{playing ? 'Pause' : 'Play'}</span></button><button className="round-control" aria-label="Next bar" onClick={() => {setPlaying(false);setVisibleCount(v=>Math.min(candles.length,v+1))}}><Plus size={15}/></button><input aria-label="Replay position" type="range" min="1" max={candles.length} value={visibleCount} onChange={e=>{setPlaying(false);setVisibleCount(Number(e.target.value))}}/><button className="toolbar-action" onClick={()=>{setPlaying(false);setVisibleCount(candles.length)}}>Latest <ChevronDown size={13}/></button></div></div>
        <div className="bottom-panel">
          <div className="panel-tabs">{['Overview','Performance Summary','List of Trades','Properties','Strategy Tester'].map(tab=><button key={tab} className={activeTab===tab?'panel-tab active':'panel-tab'} onClick={()=>setActiveTab(tab)}>{tab}</button>)}<span className="panel-tab-spacer"/><button className="top-icon" title="Collapse panel" onClick={()=>setActiveTab(activeTab ? '' : 'Strategy Tester')}><ChevronDown size={15}/></button></div>
          {activeTab === 'Strategy Tester' || activeTab === 'Properties' ? <div className="tester-layout"><div className="tester-copy"><div className="tester-heading"><FlaskConical size={18}/><div><strong>Strategy Tester</strong><small>Moving Average Crossover · Historical simulation</small></div></div><p>یک بک‌تست پایه روی داده‌های واردشده اجرا کن. نتایج نمونه یا تست‌شده با داده‌ی واقعی در همین بخش نمایش داده می‌شوند.</p><button className="run-button" onClick={runTest}><Play size={15} fill="currentColor"/> Run backtest</button></div><div className="strategy-fields"><label>Fast SMA<input type="number" min="2" max="199" value={fastPeriod} onChange={e=>setFastPeriod(e.target.value)}/></label><label>Slow SMA<input type="number" min="3" max="200" value={slowPeriod} onChange={e=>setSlowPeriod(e.target.value)}/></label><label>Risk / trade %<select value={riskPct} onChange={e=>setRiskPct(e.target.value)}><option value="0.25">0.25%</option><option value="0.5">0.5%</option><option value="1">1%</option><option value="2">2%</option></select></label><label>Risk / Reward<select value={rr} onChange={e=>setRr(e.target.value)}><option value="1">1 : 1</option><option value="1.5">1 : 1.5</option><option value="2">1 : 2</option><option value="3">1 : 3</option><option value="4">1 : 4</option><option value="5">1 : 5</option></select></label><label>Commission (R)<input type="number" min="0" step=".01" value={commission} onChange={e=>setCommission(e.target.value)}/></label></div></div> : activeTab === 'List of Trades' ? <div className="trades-table-wrap">{(testResults ?? trades).length ? <table className="trades-table"><thead><tr><th>#</th><th>Type</th><th>Entry date</th><th>Entry</th><th>Stop</th><th>Target</th><th>Exit</th><th>Result</th><th>R multiple</th></tr></thead><tbody>{(testResults ?? trades).map(t=><tr key={t.id}><td>{t.id}</td><td className={t.side==='LONG'?'up':'down'}>{t.side}</td><td>{t.date}</td><td>{fmt(t.entry)}</td><td>{fmt(t.stop)}</td><td>{fmt(t.target)}</td><td>{fmt(t.exit)}</td><td><span className={t.r>0?'result-win':t.result==='OPEN'?'result-open':'result-loss'}>{t.result}</span></td><td className={t.r>0?'up':'down'}>{t.r.toFixed(2)}R</td></tr>)}</tbody></table>:<div className="empty-panel"><ListFilter size={20}/><strong>No trades yet</strong><span>Run a backtest or add a practice trade.</span></div>}</div> : <div className="stats-panel"><div className="metric"><span>Net profit (R)</span><strong className={netR>=0?'up':'down'}>{netR>=0?'+':''}{netR.toFixed(2)}R</strong></div><div className="metric"><span>Total trades</span><strong>{closed.length}</strong></div><div className="metric"><span>Win rate</span><strong>{closed.length?(wins/closed.length*100).toFixed(1):'0.0'}%</strong></div><div className="metric"><span>Profit factor</span><strong>{profitFactor===Infinity?'∞':profitFactor.toFixed(2)}</strong></div><div className="metric"><span>Wins / Losses</span><strong><span className="up">{wins}</span> / <span className="down">{losses}</span></strong></div><div className="metric"><span>Data</span><strong className="metric-small">{candles===demo?'Sample':'Imported CSV'}</strong></div><div className="stats-actions"><button className="toolbar-action" onClick={runTest}><RotateCcw size={14}/> Recalculate</button><button className="toolbar-action" onClick={exportTrades}><Download size={14}/> Export CSV</button></div></div>}
        </div>
      </section>
      {watchlistOpen && <aside className="right-sidebar"><div className="sidebar-header"><strong>Watchlist</strong><button className="top-icon" onClick={()=>setWatchlistOpen(false)} title="Close watchlist"><X size={15}/></button></div><div className="watchlist-columns"><span>Symbol</span><span>Last</span><span>Chg%</span></div><button className="watch-row active" onClick={()=>setSymbol('XAUUSD')}><span className="watch-symbol"><span className="watch-avatar gold">Au</span><span><strong>XAUUSD</strong><small>Gold / U.S. Dollar</small></span></span><span>{fmt(last?.close??0)}</span><span className={pct>=0?'up':'down'}>{pct>=0?'+':''}{pct.toFixed(2)}%</span></button><button className="watch-row" onClick={()=>setSymbol('EURUSD')}><span className="watch-symbol"><span className="watch-avatar blue">€</span><span><strong>EURUSD</strong><small>Euro / U.S. Dollar</small></span></span><span>1.0842</span><span className="down">−0.12%</span></button><button className="watch-row" onClick={()=>setSymbol('BTCUSD')}><span className="watch-symbol"><span className="watch-avatar orange">₿</span><span><strong>BTCUSD</strong><small>Bitcoin / U.S. Dollar</small></span></span><span>67,420</span><span className="up">+1.42%</span></button><button className="watch-row" onClick={()=>setSymbol('USOIL')}><span className="watch-symbol"><span className="watch-avatar silver">O</span><span><strong>USOIL</strong><small>Crude Oil</small></span></span><span>72.18</span><span className="down">−0.33%</span></button><div className="sidebar-section"><div className="sidebar-section-title"><strong>Market details</strong><button className="top-icon" onClick={()=>setNotice('اطلاعات بازار به دیتای زنده متصل نیست.')}><CircleHelp size={14}/></button></div><div className="detail-row"><span>Market</span><strong>Forex / CFD</strong></div><div className="detail-row"><span>Session</span><strong>Historical</strong></div><div className="detail-row"><span>Bars loaded</span><strong>{candles.length.toLocaleString()}</strong></div><div className="detail-row"><span>Replay state</span><strong>{playing?'Playing':'Paused'}</strong></div></div><div className="sidebar-section"><div className="sidebar-section-title"><strong>Practice order</strong><SlidersHorizontal size={14}/></div><p className="side-hint">ثبت معامله‌ی آزمایشی روی آخرین کندل قابل مشاهده</p><div className="order-buttons"><button className="buy-button" onClick={()=>recordTrade('LONG')}><TrendingUp size={15}/> Buy</button><button className="sell-button" onClick={()=>recordTrade('SHORT')}><TrendingDown size={15}/> Sell</button></div><button className="full-width-action" onClick={()=>setActiveTab('List of Trades')}>Open trade log</button></div><div className="sidebar-section sidebar-note"><ShieldCheck size={15}/><span>این نسخه شبیه‌ساز آموزشی است؛ قیمت‌ها نمونه‌اند مگر اینکه CSV خودت را وارد کنی.</span></div></aside>}
    </div>
    {notice && <div className="toast" role="status"><AlertTriangle size={16}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
    {showImport && <div className="modal-backdrop" onClick={()=>setShowImport(false)}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><strong id="import-title">Import historical data</strong><span>CSV · OHLC candles</span></div><button className="top-icon" onClick={()=>setShowImport(false)} aria-label="Close"><X size={18}/></button></div><label className="file-drop"><FileUp size={28}/><strong>Choose a CSV file</strong><span>Required: DATE / DTYYYYMMDD, OPEN, HIGH, LOW, CLOSE. Optional: TIME, VOL.</span><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e=>importFile(e.target.files?.[0])}/></label><div className="modal-tip">CSV data is parsed locally in your browser. Dates without a timezone are interpreted as UTC. Use clean, chronologically sortable historical data for meaningful results.</div></section></div>}
    <footer className="app-footer"><span>CHARTGOLD <i>·</i> BACKTEST LAB</span><span><span className="status-dot"/> Historical data only · Prototype</span></footer>
  </main>
}
function CandlestickIcon() { return <BarChart3 size={16}/> }
export default App
