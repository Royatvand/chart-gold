import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, CandlestickSeries, ColorType, type IChartApi, type CandlestickData, type UTCTimestamp } from 'lightweight-charts'
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, Bell, CandlestickChart, ChevronDown, Clock3, Crosshair, Eye, FileUp, FlaskConical, LayoutGrid, Magnet, Maximize2, Minus, MousePointer2, Pause, Pencil, Play, Plus, RotateCcw, Ruler, Search, Settings2, ShieldCheck, TrendingUp, Upload, X } from 'lucide-react'

type Candle = CandlestickData<UTCTimestamp> & { volume?: number }
type Trade = { id: number; side: 'LONG' | 'SHORT'; entry: number; stop: number; target: number; result: 'OPEN' | 'WIN' | 'LOSS'; r?: number }

const demo: Candle[] = Array.from({ length: 110 }, (_, i) => {
  const base = 332 + i * 0.085 + Math.sin(i * 0.22) * 3.8 + Math.sin(i * 0.071) * 5
  const open = base + Math.sin(i * 1.9) * 1.1
  const close = base + Math.cos(i * 1.37) * 1.65
  return {
    time: (Date.UTC(2024, 0, 2, 0, i * 15) / 1000) as UTCTimestamp,
    open: Number(open.toFixed(3)),
    high: Number((Math.max(open, close) + 0.5 + Math.abs(Math.sin(i)) * 0.7).toFixed(3)),
    low: Number((Math.min(open, close) - 0.45 - Math.abs(Math.cos(i)) * 0.65).toFixed(3)),
    close: Number(close.toFixed(3)),
  }
})

function parseCsv(text: string): Candle[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) throw new Error('CSV must include a header and at least one data row.')
  const header = lines[0].replace(/^\uFEFF/, '').split(',').map(s => s.trim().replace(/[<>]/g, '').toUpperCase())
  const index = (key: string) => header.indexOf(key)
  for (const key of ['DTYYYYMMDD', 'TIME', 'OPEN', 'HIGH', 'LOW', 'CLOSE']) {
    if (index(key) < 0) throw new Error(`Missing required column: ${key}`)
  }
  const candles: Candle[] = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cells = line.split(',').map(s => s.trim())
    const date = cells[index('DTYYYYMMDD')]
    const time = (cells[index('TIME')] ?? '000000').padStart(6, '0')
    const year = Number(date.slice(0, 4)), month = Number(date.slice(4, 6)) - 1, day = Number(date.slice(6, 8))
    const hour = Number(time.slice(0, 2)), minute = Number(time.slice(2, 4)), second = Number(time.slice(4, 6))
    const timestamp = Math.floor(Date.UTC(year, month, day, hour, minute, second) / 1000) as UTCTimestamp
    const open = Number(cells[index('OPEN')]), high = Number(cells[index('HIGH')]), low = Number(cells[index('LOW')]), close = Number(cells[index('CLOSE')])
    if (![timestamp, open, high, low, close].every(Number.isFinite) || high < low) continue
    candles.push({ time: timestamp, open, high, low, close })
  }
  candles.sort((a, b) => Number(a.time) - Number(b.time))
  const unique = candles.filter((c, i) => i === 0 || c.time !== candles[i - 1].time)
  if (!unique.length) throw new Error('No valid OHLC rows found in this CSV.')
  return unique
}

function App() {
  const chartHost = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [candles, setCandles] = useState<Candle[]>(demo)
  const [symbol, setSymbol] = useState('XAUUSD')
  const [timeframe, setTimeframe] = useState('M15')
  const [fileName, setFileName] = useState('')
  const [notice, setNotice] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [visibleCount, setVisibleCount] = useState(demo.length)
  const [trades, setTrades] = useState<Trade[]>([])
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG')
  const [risk, setRisk] = useState('1')
  const [rr, setRr] = useState('2')
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [showImport, setShowImport] = useState(false)

  const shownCandles = useMemo(() => candles.slice(0, Math.max(1, Math.min(visibleCount, candles.length))), [candles, visibleCount])
  const last = shownCandles[shownCandles.length - 1]
  const first = shownCandles[0]
  const change = last && first ? last.close - first.open : 0
  const wins = trades.filter(t => t.result === 'WIN').length
  const losses = trades.filter(t => t.result === 'LOSS').length
  const closed = wins + losses
  const winRate = closed ? wins / closed * 100 : 0

  useEffect(() => {
    if (!chartHost.current) return
    const chart = createChart(chartHost.current, {
      layout: { background: { type: ColorType.Solid, color: '#0b0e14' }, textColor: '#8b95a7', fontFamily: 'Inter, ui-sans-serif, system-ui', fontSize: 11 },
      grid: { vertLines: { color: '#171c26' }, horzLines: { color: '#171c26' } },
      rightPriceScale: { borderColor: '#242b38', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: '#242b38', timeVisible: true, secondsVisible: false, rightOffset: 5 },
      crosshair: { vertLine: { color: '#65748b', labelBackgroundColor: '#2b3546' }, horzLine: { color: '#65748b', labelBackgroundColor: '#2b3546' } },
      handleScroll: true,
      handleScale: true,
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c997', downColor: '#ff5c70', borderUpColor: '#22c997', borderDownColor: '#ff5c70',
      wickUpColor: '#22c997', wickDownColor: '#ff5c70',
    })
    series.setData(shownCandles)
    chart.timeScale().fitContent()
    chartRef.current = chart
    const resize = () => { if (chartHost.current) chart.applyOptions({ width: chartHost.current.clientWidth, height: chartHost.current.clientHeight }) }
    const observer = new ResizeObserver(resize)
    observer.observe(chartHost.current)
    return () => { observer.disconnect(); chart.remove(); chartRef.current = null }
  }, [shownCandles])

  const onFile = useCallback(async (file?: File) => {
    if (!file) return
    try {
      const parsed = parseCsv(await file.text())
      setCandles(parsed)
      setVisibleCount(parsed.length)
      setFileName(file.name)
      setNotice(`Imported ${parsed.length.toLocaleString()} candles. Timestamps are interpreted as UTC.`)
      setShowImport(false)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not parse this CSV.')
    }
  }, [])

  useEffect(() => {
    if (!isPlaying || visibleCount >= candles.length) return
    const id = window.setInterval(() => setVisibleCount(v => Math.min(v + 1, candles.length)), 300)
    return () => window.clearInterval(id)
  }, [isPlaying, visibleCount, candles.length])

  const addTrade = () => {
    const e = Number(entry), s = Number(stop), t = Number(target)
    if (![e, s, t].every(Number.isFinite) || e <= 0 || s <= 0 || t <= 0 || e === s || e === t) {
      setNotice('Enter valid entry, stop-loss and take-profit prices first.')
      return
    }
    if ((side === 'LONG' && !(s < e && t > e)) || (side === 'SHORT' && !(t < e && s > e))) {
      setNotice('For a long: stop < entry < target. For a short: target < entry < stop.')
      return
    }
    setTrades(prev => [{ id: Date.now(), side, entry: e, stop: s, target: t, result: 'OPEN' }, ...prev])
    setNotice('Trade saved as open. Result resolution will be added in the next iteration.')
  }

  const reset = () => { setCandles(demo); setVisibleCount(demo.length); setFileName(''); setSymbol('XAUUSD'); setNotice('Demo chart restored.') }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="ChartGold home"><span className="brand-mark"><Activity size={19} /></span><span>chart<span className="brand-gold">gold</span><small>BACKTEST LAB</small></span></a>
        <div className="market-pill"><span className="live-dot" /> MARKET REPLAY <span className="pill-divider" /> HISTORICAL DATA</div>
        <div className="top-actions"><button className="icon-button" title="Search markets"><Search size={17}/></button><button className="icon-button" title="Alerts"><Bell size={17}/></button><button className="icon-button" title="Layout"><LayoutGrid size={17}/></button><button className="icon-button" title="Settings"><Settings2 size={17}/></button><div className="avatar">CG</div></div>
      </header>

      <section className="toolbar">
        <div className="symbol-block"><span className="gold-icon">Au</span><div><strong>{symbol}</strong><small>Gold / US Dollar</small></div><ChevronDown size={15} className="muted-icon"/></div>
        <div className="toolbar-divider"/>
        <div className="timeframes">{['M1','M5','M15','M30','H1','H4','D1'].map(tf => <button key={tf} onClick={() => setTimeframe(tf)} className={timeframe === tf ? 'timeframe active' : 'timeframe'}>{tf}</button>)}</div>
        <div className="toolbar-spacer"/>
        <button className="tool-button" onClick={() => setShowImport(true)}><Upload size={15}/> Import CSV</button>
        <button className="tool-button secondary" onClick={reset}><RotateCcw size={15}/><span>Reset</span></button>
      </section>

      <section className="workspace">
        <div className="chart-column">
          <div className="chart-card">
            <div className="chart-heading"><div><div className="chart-title"><span className="chart-symbol-dot"/> {symbol} <span className="tf-label">{timeframe}</span></div><div className="chart-subtitle">{fileName || 'Sample preview · import your historical CSV to begin'}</div></div><div className="chart-tools"><button title="Crosshair"><Crosshair size={16}/></button><button title="Pointer"><MousePointer2 size={16}/></button><button title="Expand"><Maximize2 size={16}/></button></div></div>
            <div className="ohlc-strip">{last && <><span>O <b>{last.open.toFixed(3)}</b></span><span>H <b className="positive">{last.high.toFixed(3)}</b></span><span>L <b className="negative">{last.low.toFixed(3)}</b></span><span>C <b className={last.close >= last.open ? 'positive' : 'negative'}>{last.close.toFixed(3)}</b></span></>}</div>
            <div className="chart-stage"><nav className="drawing-toolbar" aria-label="Chart drawing tools"><button className="drawing-tool selected" title="Cursor"><MousePointer2 size={17}/></button><button className="drawing-tool" title="Crosshair"><Crosshair size={17}/></button><span className="drawing-separator"/><button className="drawing-tool" title="Trend line"><TrendingUp size={17}/></button><button className="drawing-tool" title="Brush"><Pencil size={17}/></button><button className="drawing-tool" title="Horizontal line"><Minus size={17}/></button><button className="drawing-tool" title="Measure"><Ruler size={17}/></button><span className="drawing-separator"/><button className="drawing-tool" title="Magnet"><Magnet size={17}/></button><button className="drawing-tool" title="Hide drawings"><Eye size={17}/></button><button className="drawing-tool" title="Delete drawings"><X size={17}/></button><div className="drawing-spacer"/><button className="drawing-tool" title="Chart type"><CandlestickChart size={17}/></button></nav><div ref={chartHost} className="chart-host"/>{candles === demo && <div className="sample-watermark">SAMPLE DATA</div>}</div>
            <div className="chart-footer"><span><span className="status-dot"/> {candles.length.toLocaleString()} candles loaded</span><span>{first ? new Date(Number(first.time) * 1000).toISOString().slice(0, 10) : '—'} — {last ? new Date(Number(last.time) * 1000).toISOString().slice(0, 10) : '—'}</span><span className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(3)} range change</span></div>
          </div>

          <div className="replay-panel">
            <div className="panel-heading"><div className="panel-title"><Clock3 size={16}/> Bar Replay <span className="beta-tag">BETA</span></div><span className="muted-text">{visibleCount.toLocaleString()} / {candles.length.toLocaleString()} bars</span></div>
            <div className="replay-controls"><button className="replay-icon" onClick={() => {setVisibleCount(Math.max(1, visibleCount - 10)); setIsPlaying(false)}} title="Step back"><ArrowLeft size={16}/></button><button className="play-button" onClick={() => { if (visibleCount >= candles.length) setVisibleCount(1); setIsPlaying(v => !v) }}>{isPlaying ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}<span>{isPlaying ? 'Pause replay' : 'Play replay'}</span></button><button className="replay-icon" onClick={() => {setVisibleCount(Math.min(candles.length, visibleCount + 1)); setIsPlaying(false)}} title="Next bar"><ArrowRight size={16}/></button><input aria-label="Replay position" type="range" min="1" max={candles.length} value={visibleCount} onChange={e => {setVisibleCount(Number(e.target.value)); setIsPlaying(false)}}/><button className="replay-icon" onClick={() => {setVisibleCount(candles.length); setIsPlaying(false)}} title="Jump to end"><ArrowRight size={16}/><ArrowRight size={16}/></button></div>
            <div className="replay-caption">Move through historical candles one bar at a time to practice your setup without seeing future price action.</div>
          </div>

          <div className="trades-panel">
            <div className="panel-heading"><div className="panel-title"><BarChart3 size={16}/> Trade log <span className="count-badge">{trades.length}</span></div><button className="text-button" onClick={() => setTrades([])}>Clear all</button></div>
            {trades.length === 0 ? <div className="empty-state"><div className="empty-icon"><FlaskConical size={20}/></div><strong>No trades recorded yet</strong><span>Use the order panel to record your first practice trade.</span></div> : <div className="trade-table-wrap"><table className="trade-table"><thead><tr><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Status</th><th/></tr></thead><tbody>{trades.map(t => <tr key={t.id}><td><span className={t.side === 'LONG' ? 'side-long' : 'side-short'}>{t.side}</span></td><td>{t.entry.toFixed(3)}</td><td>{t.stop.toFixed(3)}</td><td>{t.target.toFixed(3)}</td><td><span className="open-status">{t.result}</span></td><td><button className="tiny-icon" onClick={() => setTrades(prev => prev.filter(x => x.id !== t.id))} aria-label="Remove trade"><X size={14}/></button></td></tr>)}</tbody></table></div>}
          </div>
        </div>

        <aside className="side-column">
          <div className="side-card import-card"><div className="side-card-title"><div className="side-icon violet"><FileUp size={17}/></div><div><strong>Historical data</strong><small>Bring your own market data</small></div></div><div className="import-drop" onClick={() => setShowImport(true)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setShowImport(true)}><div className="upload-circle"><Upload size={19}/></div><strong>Import OHLC CSV</strong><span>DTYYYYMMDD, TIME, OPEN, HIGH, LOW, CLOSE</span><button className="browse-button" onClick={e => {e.stopPropagation(); setShowImport(true)}}>Choose file</button></div><div className="data-note"><ShieldCheck size={14}/> Processed in your browser in this prototype</div></div>

          <div className="side-card order-card"><div className="side-card-title"><div className="side-icon green"><TrendingUp size={17}/></div><div><strong>Practice order</strong><small>Manual trade entry</small></div></div><div className="side-label">DIRECTION</div><div className="direction-toggle"><button className={side === 'LONG' ? 'direction-long selected' : 'direction-long'} onClick={() => setSide('LONG')}>Buy / Long</button><button className={side === 'SHORT' ? 'direction-short selected' : 'direction-short'} onClick={() => setSide('SHORT')}>Sell / Short</button></div><label className="field-label">Entry price<input value={entry} onChange={e => setEntry(e.target.value)} placeholder={last?.close.toFixed(3) ?? 'e.g. 2345.50'} inputMode="decimal"/></label><div className="field-row"><label className="field-label">Stop loss<input value={stop} onChange={e => setStop(e.target.value)} placeholder="SL price" inputMode="decimal"/></label><label className="field-label">Take profit<input value={target} onChange={e => setTarget(e.target.value)} placeholder="TP price" inputMode="decimal"/></label></div><div className="field-row"><label className="field-label">Risk %<select value={risk} onChange={e => setRisk(e.target.value)}><option value="0.25">0.25%</option><option value="0.5">0.5%</option><option value="1">1%</option><option value="2">2%</option></select></label><label className="field-label">Target R:R<select value={rr} onChange={e => setRr(e.target.value)}><option value="1">1 : 1</option><option value="2">1 : 2</option><option value="3">1 : 3</option><option value="4">1 : 4</option><option value="5">1 : 5</option></select></label></div><button className={side === 'LONG' ? 'submit-trade buy' : 'submit-trade sell'} onClick={addTrade}><Plus size={16}/> Record {side === 'LONG' ? 'Long' : 'Short'} trade</button><div className="risk-footnote">Risk and R:R are currently planning fields; position sizing and automatic trade outcomes are not implemented yet.</div></div>

          <div className="side-card stats-card"><div className="side-card-title"><div className="side-icon blue"><Activity size={17}/></div><div><strong>Session stats</strong><small>Your current practice session</small></div></div><div className="stats-grid"><div><span>Total trades</span><strong>{trades.length}</strong></div><div><span>Win rate</span><strong>{winRate.toFixed(0)}%</strong></div><div><span>Wins</span><strong className="positive">{wins}</strong></div><div><span>Losses</span><strong className="negative">{losses}</strong></div></div><div className="stats-progress"><span style={{width: `${winRate}%`}}/></div><div className="stats-footnote">Performance metrics update as trade outcomes are added.</div></div>
          <div className="side-card next-card"><div className="next-kicker">ROADMAP</div><strong>Built for serious testing.</strong><p>Next up: true timeframe aggregation, trade outcome simulation, keyboard shortcuts, and session exports.</p><div className="roadmap-item"><span>01</span> CSV import <span className="roadmap-done">Ready</span></div><div className="roadmap-item"><span>02</span> Bar replay <span className="roadmap-done">Preview</span></div><div className="roadmap-item"><span>03</span> Auto outcomes <span className="roadmap-planned">Planned</span></div></div>
        </aside>
      </section>

      {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
      {showImport && <div className="modal-backdrop" onClick={() => setShowImport(false)}><div className="import-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><strong>Import historical candles</strong><span>Load a CSV file with OHLC data</span></div><button className="icon-button" onClick={() => setShowImport(false)}><X size={18}/></button></div><label className="file-picker"><input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => onFile(e.target.files?.[0])}/><Upload size={24}/><strong>Choose a CSV file</strong><span>Expected columns: TICKER, DTYYYYMMDD, TIME, OPEN, HIGH, LOW, CLOSE, VOL</span></label><div className="modal-tip">Your data is parsed locally in this browser. Large files may need a later optimized streaming importer. Times are interpreted as UTC for this prototype.</div></div></div>}
      <footer className="app-footer"><span>CHARTGOLD <span>·</span> BACKTEST LAB</span><span>Prototype v0.1 <span>·</span> Historical data only</span></footer>
    </main>
  )
}

export default App