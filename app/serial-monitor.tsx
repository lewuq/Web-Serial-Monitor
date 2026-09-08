'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, CircleStop, Eraser, Gauge, LineChart, Moon, Pause, Play, Plug, Plus, Radio, RotateCcw, Send, Settings2, Sun, TerminalSquare, Trash2, Unplug, Usb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import './serial-monitor.css';

type SerialReader = { read: () => Promise<{ value?: Uint8Array; done: boolean }>; cancel: () => Promise<void>; releaseLock: () => void };
type SerialWriter = { write: (data: Uint8Array) => Promise<void>; releaseLock: () => void };
type BrowserSerialPort = {
  readable: { getReader: () => SerialReader } | null;
  writable: { getWriter: () => SerialWriter } | null;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
};
type BrowserSerial = { requestPort: () => Promise<BrowserSerialPort> };

declare global { interface Navigator { serial?: BrowserSerial } }
type ModelContext = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: () => unknown }, options?: { signal: AbortSignal }) => void | Promise<void> };
declare global { interface Document { readonly modelContext?: ModelContext } }

type DataPoint = { index: number; values: number[] };
type LogLine = { id: number; time: string; direction: 'RX' | 'TX' | 'SYS'; text: string };
type PlotConfig = { id: number; name: string; color: string; field: number };
const MAX_POINTS = 90;
const PLOT_COLORS = ['#8FC31F', '#00A6A6', '#F4A340', '#B47AE8', '#ED6A5A', '#4C9AFF', '#F2C94C', '#2CCB9B'];
const now = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function LivePlot({ points, plots }: { points: DataPoint[]; plots: PlotConfig[] }) {
  const width = 900, height = 280, padding = 22;
  const values = points.flatMap((point) => plots.map((plot) => point.values[plot.field])).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : -1;
  const max = values.length ? Math.max(...values) : 1;
  const range = Math.max(max - min, 1);
  const paths = plots.map((plot) => {
    const fieldIndex = plot.field;
    const valid = points.filter((point) => Number.isFinite(point.values[fieldIndex]));
    const path = valid.map((point, index) => {
      const x = padding + (index / Math.max(valid.length - 1, 1)) * (width - padding * 2);
      const y = padding + ((max - point.values[fieldIndex]) / range) * (height - padding * 2);
      return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    return { ...plot, path };
  });
  return (
    <div className="sm-plot-shell" aria-label="Live serial data plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {[0, 1, 2, 3, 4].map((line) => <line key={`h-${line}`} x1={padding} x2={width-padding} y1={padding+(line*(height-padding*2))/4} y2={padding+(line*(height-padding*2))/4} className="sm-grid-line" />)}
        {[0, 1, 2, 3, 4, 5, 6].map((line) => <line key={`v-${line}`} y1={padding} y2={height-padding} x1={padding+(line*(width-padding*2))/6} x2={padding+(line*(width-padding*2))/6} className="sm-grid-line" />)}
        {paths.map((item) => <path key={item.name} d={item.path} fill="none" stroke={item.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />)}
      </svg>
      {(!points.length || !plots.length) && <div className="sm-plot-empty"><Activity size={24} /><span>{plots.length ? 'Connect a device or start Demo mode' : 'Add a plot to visualize incoming data'}</span></div>}
    </div>
  );
}

export default function SerialMonitor() {
  const [baudRate, setBaudRate] = useState(115200);
  const [connected, setConnected] = useState(false);
  const [demo, setDemo] = useState(false);
  const [paused, setPaused] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [detectedFieldCount, setDetectedFieldCount] = useState(0);
  const [plots, setPlots] = useState<PlotConfig[]>([
    { id: 1, name: 'Plot 1', color: PLOT_COLORS[0], field: 0 },
    { id: 2, name: 'Plot 2', color: PLOT_COLORS[1], field: 1 },
    { id: 3, name: 'Plot 3', color: PLOT_COLORS[2], field: 2 },
  ]);
  const [logs, setLogs] = useState<LogLine[]>([{ id: 1, time: now(), direction: 'SYS', text: 'Ready. Expected format: value1,value2,value3' }]);
  const [message, setMessage] = useState('');
  const [bytesReceived, setBytesReceived] = useState(0);
  const [error, setError] = useState('');
  const portRef = useRef<BrowserSerialPort | null>(null);
  const readerRef = useRef<SerialReader | null>(null);
  const pointIndex = useRef(0);
  const partialLine = useRef('');
  const pausedRef = useRef(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const demoTimerRef = useRef<number | null>(null);
  const nextPlotId = useRef(4);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const appendLog = useCallback((direction: LogLine['direction'], text: string) => {
    setLogs((current) => [...current.slice(-299), { id: Date.now() + Math.random(), time: now(), direction, text }]);
  }, []);
  const ingestLine = useCallback((line: string, showInTerminal = true) => {
    const clean = line.trim();
    if (!clean) return;
    if (showInTerminal) appendLog('RX', clean);
    if (pausedRef.current) return;
    const numeric = clean.split(/[\s,;]+/).map(Number).filter(Number.isFinite);
    if (!numeric.length) return;
    setDetectedFieldCount((current) => Math.max(current, numeric.length));
    pointIndex.current += 1;
    setPoints((current) => [...current, { index: pointIndex.current, values: numeric }].slice(-MAX_POINTS));
  }, [appendLog]);

  const readLoop = useCallback(async (port: BrowserSerialPort) => {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        setBytesReceived((total) => total + value.byteLength);
        partialLine.current += decoder.decode(value, { stream: true });
        const lines = partialLine.current.split(/\r?\n/);
        partialLine.current = lines.pop() ?? '';
        lines.forEach(ingestLine);
      }
    } catch (readError) {
      if (portRef.current) setError(readError instanceof Error ? readError.message : 'Serial read failed.');
    } finally {
      reader.releaseLock();
      readerRef.current = null;
    }
  }, [ingestLine]);

  const connect = async () => {
    setError('');
    if (!navigator.serial) return setError('Web Serial is unavailable. Use Chrome or Edge over HTTPS or localhost.');
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate });
      portRef.current = port;
      setConnected(true);
      appendLog('SYS', `Connected at ${baudRate} baud.`);
      void readLoop(port);
    } catch (connectError) { setError(connectError instanceof Error ? connectError.message : 'Could not open the serial port.'); }
  };
  const disconnect = useCallback(async () => {
    try { await readerRef.current?.cancel(); await portRef.current?.close(); } catch { /* Browser may release an unplugged reader. */ }
    readerRef.current = null;
    portRef.current = null;
    setConnected(false);
    appendLog('SYS', 'Disconnected.');
  }, [appendLog]);
  useEffect(() => () => { void readerRef.current?.cancel(); }, []);

  const stopDemo = useCallback((announce = true) => {
    if (demoTimerRef.current !== null) {
      window.clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
    setDemo(false);
    if (announce) appendLog('SYS', 'Demo stream stopped.');
  }, [appendLog]);
  const toggleDemo = () => {
    if (demo) return stopDemo();
    setDemo(true);
    appendLog('SYS', 'Demo stream started.');
    demoTimerRef.current = window.setInterval(() => {
      const t = Date.now() / 700;
      ingestLine(`${(Math.sin(t)*42).toFixed(2)},${(Math.cos(t*.72)*31+8).toFixed(2)},${(Math.sin(t*1.4)*18-12).toFixed(2)}`, false);
    }, 90);
  };
  useEffect(() => () => {
    if (demoTimerRef.current !== null) window.clearInterval(demoTimerRef.current);
  }, []);
  useEffect(() => { terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight }); }, [logs]);
  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(document.modelContext.registerTool({
      name: 'clear_monitor_data',
      title: 'Clear monitor data',
      description: 'Clear the visible plot samples and terminal log in the serial monitor.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        setPoints([]);
        setLogs([]);
        setBytesReceived(0);
        return { cleared: true };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const sendMessage = async () => {
    const text = message.trim();
    if (!text) return;
    if (!portRef.current?.writable) return setError('Connect a serial device before sending data.');
    const writer = portRef.current.writable.getWriter();
    try { await writer.write(new TextEncoder().encode(`${text}\n`)); appendLog('TX', text); setMessage(''); }
    finally { writer.releaseLock(); }
  };
  const latest = points.at(-1)?.values ?? [];
  const values = useMemo(() => plots.map((plot) => Number.isFinite(latest[plot.field]) ? latest[plot.field].toFixed(2) : '—'), [latest, plots]);
  const bindField = (id: number, field: number) => setPlots((current) => current.map((plot) => plot.id === id ? { ...plot, field } : plot));
  const addPlot = () => {
    const id = nextPlotId.current++;
    setPlots((current) => [...current, { id, name: `Plot ${id}`, color: PLOT_COLORS[(id - 1) % PLOT_COLORS.length], field: 0 }]);
  };
  const removePlot = (id: number) => setPlots((current) => current.filter((plot) => plot.id !== id));
  const toggleTheme = () => setDarkMode((current) => !current);
  const browserSupported = typeof navigator !== 'undefined' && Boolean(navigator.serial);
  const statusText = connected ? 'Connected' : demo ? 'Demo stream' : 'Disconnected';

  return (
    <main className={`sm-shell ${darkMode ? 'dark' : ''}`}>
      <header className="sm-topbar">
        <div className="sm-brand"><div className="sm-brand-mark"><Radio size={20} /></div><div><h1>Seeed Studio Serial Monitor</h1><p>Browser workspace</p></div></div>
        <div className="sm-connection-strip">
          <label className="sm-baud"><span>Baud rate</span><select value={baudRate} onChange={(event) => setBaudRate(Number(event.target.value))} disabled={connected}>{[9600,19200,38400,57600,115200,230400,460800,921600].map((rate) => <option key={rate}>{rate}</option>)}</select></label>
          <div className={`sm-status ${connected || demo ? 'online' : ''}`}><span />{statusText}</div>
          <Button variant="outline" size="icon" className="sm-theme-toggle" onClick={toggleTheme} aria-label={darkMode ? 'Use light theme' : 'Use dark theme'}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</Button>
          <Button className="sm-connect" onClick={connected ? disconnect : connect}>{connected ? <Unplug size={17} /> : <Usb size={17} />}{connected ? 'Disconnect' : 'Connect device'}</Button>
        </div>
      </header>

      <div className="sm-workspace">
        <aside className="sm-sidebar">
          <div className="sm-sidebar-section"><p className="sm-eyebrow">Workspace</p><button className="sm-nav active"><LineChart size={18} />Monitor</button><button className="sm-nav"><TerminalSquare size={18} />Terminal</button><button className="sm-nav"><Gauge size={18} />Dashboard<i>Soon</i></button><button className="sm-nav"><Activity size={18} />IMU view<i>Soon</i></button></div>
          <div className="sm-sidebar-section grow"><div className="sm-section-row"><p className="sm-eyebrow">Plot bindings</p><Button variant="ghost" size="sm" className="sm-add-plot" onClick={addPlot}><Plus size={14}/>Add</Button></div><p className="sm-channel-help">Plots are optional. Add one, then bind it to any numeric field after data arrives.</p>{plots.map((plot,index) => <div className="sm-channel" key={plot.id}><span style={{background:plot.color}} /><label>{plot.name}</label><select value={plot.field} onChange={(event)=>bindField(plot.id,Number(event.target.value))} disabled={!detectedFieldCount} aria-label={`${plot.name} data field`}>{detectedFieldCount ? Array.from({length:detectedFieldCount},(_,field)=><option value={field} key={field}>Field {field+1}</option>) : <option>Waiting for data</option>}</select><strong>{values[index]}</strong><button className="sm-remove-plot" onClick={()=>removePlot(plot.id)} aria-label={`Remove ${plot.name}`}><Trash2 size={13}/></button></div>)}{!plots.length&&<div className="sm-no-plots">No plots added</div>}</div>
          <div className="sm-device"><Plug size={18} /><div><strong>Web Serial</strong><span>{browserSupported ? 'Available in this browser' : 'Chrome or Edge required'}</span></div></div>
        </aside>

        <section className="sm-main">
          <div className="sm-heading"><div><p className="sm-eyebrow">Live data</p><h2>Serial plot</h2></div><div className="sm-actions"><Button variant="outline" size="sm" onClick={toggleDemo} disabled={connected}>{demo ? <CircleStop size={15}/> : <Play size={15}/>} {demo ? 'Stop demo' : 'Run demo'}</Button><Button variant="outline" size="icon-sm" aria-label={paused?'Resume plot':'Pause plot'} onClick={() => setPaused((value)=>!value)}>{paused?<Play size={15}/>:<Pause size={15}/>}</Button><Button variant="outline" size="icon-sm" aria-label="Clear plot" onClick={()=>setPoints([])}><RotateCcw size={15}/></Button></div></div>
          <div className="sm-card"><div className="sm-legend">{plots.length ? plots.map((plot)=><span key={plot.id}><i style={{background:plot.color}}/>{plot.name} · Field {plot.field+1}</span>) : <span>No active plots</span>}<span className="samples">{points.length} samples visible</span></div><LivePlot points={points} plots={plots}/></div>
          <Tabs defaultValue="terminal" className="sm-terminal sm-card">
            <div className="sm-terminal-head"><TabsList><TabsTrigger value="terminal">Terminal</TabsTrigger><TabsTrigger value="format">Data format</TabsTrigger></TabsList><div className="sm-terminal-actions"><span><ArrowDownToLine size={14}/>{bytesReceived.toLocaleString()} bytes</span><Button variant="ghost" size="sm" onClick={()=>setLogs([])}><Eraser size={15}/>Clear</Button></div></div>
            <TabsContent value="terminal" className="sm-terminal-content"><div className="sm-output" ref={terminalRef} aria-live="polite">{logs.map((line)=><div className="sm-log" key={line.id}><time>{line.time}</time><b className={line.direction.toLowerCase()}>{line.direction}</b><code>{line.text}</code></div>)}</div><div className="sm-send"><Input value={message} onChange={(event)=>setMessage(event.target.value)} onKeyDown={(event)=>event.key==='Enter'&&void sendMessage()} placeholder="Type a command and press Enter" aria-label="Serial command"/><Button onClick={sendMessage}><Send size={16}/>Send</Button></div></TabsContent>
            <TabsContent value="format" className="sm-format"><div><strong>Text / CSV</strong><p>Send one frame per line. Values may be separated by commas, spaces, or semicolons.</p></div><div className="sm-code-example"><span>Arduino / C++ example</span><pre><code>{'float temperature = 24.6;\nfloat voltage = 3.31;\nfloat current = 0.18;\n\nSerial.printf("%.2f,%.2f,%.2f\\n",\n  temperature, voltage, current);'}</code></pre></div><p>Received frame: <code>24.60,3.31,0.18</code>. Bind Plot A, B, and C to Field 1, Field 2, or Field 3 after the first frame arrives.</p></TabsContent>
          </Tabs>
          {error&&<div className="sm-error" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
        </section>
      </div>
    </main>
  );
}
