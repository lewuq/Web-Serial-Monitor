'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, Braces, CircleStop, Copy, Cpu, Eraser, Gauge, GripHorizontal, GripVertical, Hand, Layers3, LineChart, Maximize2, Moon, MoveHorizontal, Pause, Play, Plug, Plus, Radio, RotateCcw, Send, SlidersHorizontal, Sun, TerminalSquare, Trash2, Unplug, Usb, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import './serial-workspace.css';

type SerialReader = { read: () => Promise<{ value?: Uint8Array; done: boolean }>; cancel: () => Promise<void>; releaseLock: () => void };
type SerialWriter = { write: (data: Uint8Array) => Promise<void>; releaseLock: () => void };
type BrowserSerialPort = { readable: { getReader: () => SerialReader } | null; writable: { getWriter: () => SerialWriter } | null; open: (options: { baudRate: number }) => Promise<void>; close: () => Promise<void> };
type BrowserSerial = { requestPort: () => Promise<BrowserSerialPort> };
declare global { interface Navigator { serial?: BrowserSerial } }
type ModelContext = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: () => unknown }, options?: { signal: AbortSignal }) => void | Promise<void> };
declare global { interface Document { readonly modelContext?: ModelContext } }

type DataPoint = { index: number; values: number[] };
type LogLine = { id: number; time: string; direction: 'RX' | 'TX' | 'SYS'; text: string; rawHex?: string };
type PlotConfig = { id: number; name: string; color: string; field: number };
type WorkspaceView = 'monitor' | 'components';
const MAX_POINTS = 600;
const MAX_LOG_LINES = 1200;
const MAX_PENDING_LOGS = 1600;
const PLOT_COLORS = ['#8FC31F', '#00A6A6', '#F4A340', '#B47AE8', '#ED6A5A', '#4C9AFF', '#F2C94C', '#2CCB9B'];
const now = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const numberPattern = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const bytesToHex = (bytes: Uint8Array | number[]) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const parseHex = (input: string) => { const normalized=input.replace(/0x/gi,'').replace(/[\s,;:_-]+/g,''); if(!normalized || normalized.length%2 || /[^0-9a-f]/i.test(normalized)) throw new Error('HEX data must contain complete byte pairs, for example: 01 0A FF.'); return new Uint8Array(normalized.match(/.{2}/g)!.map((pair)=>Number.parseInt(pair,16))); };

function flattenNumbers(value: unknown, prefix = '', output: { labels: string[]; values: number[] } = { labels: [], values: [] }) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    output.labels.push(prefix || `Field ${output.labels.length + 1}`);
    output.values.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flattenNumbers(item, prefix ? `${prefix}.${index}` : `Field ${index + 1}`, output));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => flattenNumbers(item, prefix ? `${prefix}.${key}` : key, output));
  }
  return output;
}

function parseSerialFields(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return { values: [] as number[], labels: [] as string[] };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const jsonResult = flattenNumbers(JSON.parse(trimmed));
      if (jsonResult.values.length) return jsonResult;
    } catch { /* Continue with text parsing. */ }
  }
  const values: number[] = [];
  const labels: string[] = [];
  const keyValue = /([A-Za-z_][\w.-]*)\s*(?:=|:)\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let context = '';
  let previousEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = keyValue.exec(trimmed)) !== null) {
    const gap = trimmed.slice(previousEnd, match.index);
    const group = gap.match(/([A-Za-z_][\w.-]*)\s*(?:\([^)]*\))?\s*$/);
    if (group) context = group[1].toLowerCase();
    const baseLabel = context ? `${context}.${match[1]}` : match[1];
    let label = baseLabel;
    let suffix = 2;
    while (labels.includes(label)) label = `${baseLabel}.${suffix++}`;
    labels.push(label);
    values.push(Number(match[2]));
    previousEnd = keyValue.lastIndex;
  }
  if (values.length) return { values, labels };
  const numericTokens = trimmed.split(/[\s,;|\t]+/).filter((token) => numberPattern.test(token));
  return { values: numericTokens.map(Number), labels: numericTokens.map((_, index) => `Field ${index + 1}`) };
}

function LivePlot({ points, plots, windowSize, panOffset, verticalPan, zh, onWindowSize, onPanOffset, onVerticalPan }: { points: DataPoint[]; plots: PlotConfig[]; windowSize: number; panOffset: number; verticalPan: number; zh: boolean; onWindowSize: (value: number) => void; onPanOffset: (value: number) => void; onVerticalPan: (value: number) => void }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ axis: 'width' | 'height'; start: number; size: number } | null>(null);
  const [chartHeight,setChartHeight] = useState(360);
  const [chartWidth,setChartWidth] = useState<number|null>(null);
  const [chartSize,setChartSize] = useState({width:1000,height:360});
  useEffect(()=>{const element=shellRef.current;if(!element)return;const observer=new ResizeObserver(([entry])=>{if(!entry)return;setChartSize({width:Math.max(320,Math.round(entry.contentRect.width)),height:Math.max(240,Math.round(entry.contentRect.height-18))});});observer.observe(element);return()=>observer.disconnect();},[]);
  const wheelRef=useRef({windowSize,onWindowSize});
  wheelRef.current={windowSize,onWindowSize};
  useEffect(()=>{const element=shellRef.current;if(!element)return;const handleWheel=(event:WheelEvent)=>{event.preventDefault();event.stopPropagation();const current=wheelRef.current;const factor=event.deltaY>0?1.18:.84;const next=clamp(Math.round(current.windowSize*factor),20,MAX_POINTS);if(next!==current.windowSize)current.onWindowSize(next);};element.addEventListener('wheel',handleWheel,{passive:false,capture:true});return()=>element.removeEventListener('wheel',handleWheel,true);},[]);
  const width = chartSize.width;
  const height = chartSize.height;
  const padding = { left: 62, right: 20, top: 22, bottom: 38 };
  const dragRef = useRef<{ x: number; y: number; offset: number; verticalPan: number; width: number; height: number } | null>(null);
  const maxOffset = Math.max(0, points.length - Math.min(windowSize, points.length));
  const safeOffset = clamp(panOffset, 0, maxOffset);
  const end = Math.max(0, points.length - safeOffset);
  const start = Math.max(0, end - windowSize);
  const visible = points.slice(start, end);
  const allValues = visible.flatMap((point) => plots.map((plot) => point.values[plot.field])).filter(Number.isFinite);
  const rawMin = allValues.length ? Math.min(...allValues) : -1;
  const rawMax = allValues.length ? Math.max(...allValues) : 1;
  const margin = Math.max((rawMax - rawMin) * 0.08, 0.5);
  const range = Math.max(rawMax - rawMin + margin * 2, 1);
  const min = rawMin - margin + verticalPan;
  const max = min + range;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const yTicks = Array.from({ length: 5 }, (_, index) => max - (range * index) / 4);
  const xTicks = Array.from({ length: 6 }, (_, index) => visible[Math.min(visible.length - 1, Math.round((Math.max(visible.length - 1, 0) * index) / 5))]?.index ?? 0);
  const paths = plots.map((plot) => {
    const valid = visible.map((point, position) => ({ point, position })).filter(({ point }) => Number.isFinite(point.values[plot.field]));
    const path = valid.map(({ point, position }, index) => {
      const x = padding.left + (position / Math.max(visible.length - 1, 1)) * plotWidth;
      const y = padding.top + ((max - point.values[plot.field]) / range) * plotHeight;
      return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    return { ...plot, path };
  });
  return <div ref={shellRef} className="sm-plot-shell" style={{height:chartHeight,width:chartWidth??'100%',maxWidth:'100%'}} aria-label="Interactive live serial data plot"
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, offset: safeOffset, verticalPan, width: event.currentTarget.clientWidth, height: event.currentTarget.clientHeight }; }}
    onPointerMove={(event) => { if (!dragRef.current) return; const deltaX = event.clientX - dragRef.current.x; const deltaY = event.clientY - dragRef.current.y; onPanOffset(clamp(Math.round(dragRef.current.offset + (deltaX / Math.max(dragRef.current.width, 1)) * windowSize), 0, maxOffset)); onVerticalPan(dragRef.current.verticalPan + (deltaY / Math.max(dragRef.current.height, 1)) * range); }}
    onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
    <svg className="sm-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img">
      {yTicks.map((tick, index) => { const y = padding.top + (index * plotHeight) / 4; return <g key={`y-${index}`}><line x1={padding.left} x2={width-padding.right} y1={y} y2={y} className="sm-grid-line"/><text x={padding.left-10} y={y+4} className="sm-axis-label" textAnchor="end">{tick.toFixed(Math.abs(tick)<10?2:1)}</text></g>; })}
      {xTicks.map((tick, index) => { const x = padding.left + (index * plotWidth) / 5; return <g key={`x-${index}`}><line y1={padding.top} y2={height-padding.bottom} x1={x} x2={x} className="sm-grid-line"/><text x={x} y={height-13} className="sm-axis-label" textAnchor="middle">{tick}</text></g>; })}
      <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height-padding.bottom} className="sm-axis-line"/><line x1={padding.left} x2={width-padding.right} y1={height-padding.bottom} y2={height-padding.bottom} className="sm-axis-line"/>
      {paths.map((item) => <path key={item.id} d={item.path} fill="none" stroke={item.color} strokeWidth="2.35" vectorEffect="non-scaling-stroke"/>)}
    </svg>
    <div className="sm-plot-gesture"><Hand size={13}/><span>{zh?'拖拽平移 · 滚轮缩放':'Drag to pan · Wheel to zoom'}</span><b>{Math.round(120/windowSize*100)}%</b></div>
    {(!visible.length || !plots.length) && <div className="sm-plot-empty"><Activity size={24}/><span>{plots.length ? (zh?'连接设备或运行演示':'Connect a device or run the demo') : (zh?'添加曲线以显示数据':'Add a plot to visualize incoming data')}</span></div>}
    <div className="sm-height-resizer" role="separator" aria-orientation="horizontal" aria-label={zh?'调整绘图高度':'Resize plot height'} title={zh?'上下拖动调整高度，双击恢复':'Drag vertically to resize height; double-click to reset'} onDoubleClick={(event)=>{event.stopPropagation();setChartHeight(360);}} onPointerDown={(event)=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);resizeRef.current={axis:'height',start:event.clientY,size:chartHeight};}} onPointerMove={(event)=>{event.stopPropagation();const resize=resizeRef.current;if(!resize||resize.axis!=='height')return;setChartHeight(clamp(resize.size+event.clientY-resize.start,260,680));}} onPointerUp={(event)=>{event.stopPropagation();resizeRef.current=null;}} onPointerCancel={()=>{resizeRef.current=null;}}><GripHorizontal size={16}/><span>{zh?'上下调整高度':'Resize height'}</span></div>
    <div className="sm-width-resizer" role="separator" aria-orientation="vertical" aria-label={zh?'调整绘图宽度':'Resize plot width'} title={zh?'左右拖动调整宽度，双击恢复自适应':'Drag horizontally to resize width; double-click to fit'} onDoubleClick={(event)=>{event.stopPropagation();setChartWidth(null);}} onPointerDown={(event)=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);resizeRef.current={axis:'width',start:event.clientX,size:shellRef.current?.getBoundingClientRect().width??720};}} onPointerMove={(event)=>{event.stopPropagation();const resize=resizeRef.current;if(!resize||resize.axis!=='width')return;const available=shellRef.current?.parentElement?.clientWidth??1600;setChartWidth(clamp(resize.size+event.clientX-resize.start,360,available));}} onPointerUp={(event)=>{event.stopPropagation();resizeRef.current=null;}} onPointerCancel={()=>{resizeRef.current=null;}}><GripVertical size={15}/></div>
  </div>;
}

function GaugeDemo({ value, zh }: { value: number; zh: boolean }) {
  const normalized = clamp(Math.abs(value), 0, 100);
  const circumference = 251.3;
  return <div className="sm-gauge-demo"><svg viewBox="0 0 100 100" aria-label={`${zh?'仪表值':'Gauge value'} ${normalized.toFixed(0)}`}><circle cx="50" cy="50" r="40" className="track"/><circle cx="50" cy="50" r="40" className="value" strokeDasharray={circumference} strokeDashoffset={circumference*(1-normalized/100)}/></svg><div><strong>{normalized.toFixed(0)}</strong><span>{zh?'百分比':'percent'}</span></div></div>;
}

function TelemetryImuPanel({ latest, detectedFields, zh, compact=false }: { latest:number[]; detectedFields:string[]; zh:boolean; compact?:boolean }) {
  const [fields,setFields]=useState([0,1,2]);
  const [scale,setScale]=useState(1);
  useEffect(()=>{if(!detectedFields.length)return;setFields(['euler.roll','euler.pitch','euler.yaw'].map((name,index)=>{const found=detectedFields.indexOf(name);return found>=0?found:Math.min(index,detectedFields.length-1);}));},[detectedFields]);
  const angles=fields.map((field,index)=>Number.isFinite(latest[field])?latest[field]:[-18,12,28][index]);
  const [roll,pitch,yaw]=angles;
  return <article className={`sm-workspace-imu ${compact?'compact':''}`}>
    <div className="sm-workspace-imu-head"><div><span>IMU</span><strong>{zh?'三轴欧拉角姿态':'3-axis Euler orientation'}</strong></div><div className="sm-imu-tools"><button onClick={()=>setScale((value)=>clamp(value-.1,.55,1.65))} aria-label={zh?'缩小 IMU':'Zoom out IMU'}><ZoomOut size={14}/></button><b>{Math.round(scale*100)}%</b><button onClick={()=>setScale((value)=>clamp(value+.1,.55,1.65))} aria-label={zh?'放大 IMU':'Zoom in IMU'}><ZoomIn size={14}/></button><button onClick={()=>setScale(1)} aria-label={zh?'重置 IMU 缩放':'Reset IMU zoom'}><Maximize2 size={14}/></button></div></div>
    <div className="sm-workspace-imu-body"><div className="sm-cube-scene sm-workspace-cube"><div className="sm-cube" style={{transform:`scale(${scale}) rotateX(${-pitch}deg) rotateY(${yaw}deg) rotateZ(${roll}deg)`}}><div className="front">FRONT</div><div className="back">BACK</div><div className="right">X+</div><div className="left">X−</div><div className="top">Z+</div><div className="bottom">Z−</div></div><div className="sm-axis-key"><i className="x">X</i><i className="y">Y</i><i className="z">Z</i></div></div><div className="sm-euler-bindings">{['Roll','Pitch','Yaw'].map((axis,index)=><label key={axis}><span>{zh?['横滚','俯仰','偏航'][index]:axis}<b>{angles[index].toFixed(1)}°</b></span><select value={fields[index]} onChange={(event)=>setFields((current)=>current.map((field,fieldIndex)=>fieldIndex===index?Number(event.target.value):field))} disabled={!detectedFields.length}>{detectedFields.length?detectedFields.map((field,fieldIndex)=><option key={`${axis}-${field}`} value={fieldIndex}>{field}</option>):<option value={index}>{zh?'演示数据':'Demo data'}</option>}</select></label>)}</div></div>
    {!compact&&<div className="sm-imu-resize-note">{zh?'拖动右下角可调整组件尺寸':'Drag the bottom-right corner to resize this component'}</div>}
  </article>;
}

function ComponentsGallery({ latest, detectedFields, zh }: { latest: number[]; detectedFields: string[]; zh: boolean }) {
  const [pressed, setPressed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [setpoint, setSetpoint] = useState([64]);
  const [pid,setPid] = useState({p:[0.8],i:[0.15],d:[0.04]});
  const [eulerFields,setEulerFields] = useState([0,1,2]);
  const [workspaceItems,setWorkspaceItems] = useState<{id:number;type:string}[]>([]);
  const workspaceId=useRef(0);
  const galleryRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{const types=['button','imu','dashboard','gauge','status','slider','pid','readout'];const cards=Array.from(galleryRef.current?.querySelectorAll<HTMLElement>('.sm-component-card')??[]);const cleanups=cards.map((card,index)=>{card.draggable=true;const handle=(event:DragEvent)=>{event.dataTransfer?.setData('application/x-web-serial-component',types[index]??'readout');if(event.dataTransfer)event.dataTransfer.effectAllowed='copy';};card.addEventListener('dragstart',handle);return()=>card.removeEventListener('dragstart',handle);});return()=>cleanups.forEach((cleanup)=>cleanup());},[]);
  useEffect(()=>{if(!detectedFields.length)return;const defaults=['euler.roll','euler.pitch','euler.yaw'].map((name,index)=>{const match=detectedFields.indexOf(name);return match>=0?match:Math.min(index,detectedFields.length-1);});setEulerFields(defaults);},[detectedFields]);
  const roll = Number.isFinite(latest[eulerFields[0]]) ? latest[eulerFields[0]] : -18;
  const pitch = Number.isFinite(latest[eulerFields[1]]) ? latest[eulerFields[1]] : 12;
  const yaw = Number.isFinite(latest[eulerFields[2]]) ? latest[eulerFields[2]] : 28;
  const x = latest[0] ?? -2.08;
  const y = latest[1] ?? -5.4;
  const componentName=(type:string)=>({button:zh?'命令按钮':'Command button',imu:zh?'3D 姿态':'3D orientation',dashboard:zh?'遥测仪表盘':'Telemetry dashboard',gauge:zh?'径向仪表':'Radial gauge',status:zh?'状态指示器':'Status indicator',slider:zh?'设定值滑块':'Setpoint slider',pid:zh?'PID 控制器':'PID controller',readout:zh?'数值读数':'Numeric readout'}[type]??type);
  const beginDrag=(event:import('react').DragEvent<HTMLElement>,type:string)=>{event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/x-web-serial-component',type);};
  const dropComponent=(event:import('react').DragEvent<HTMLDivElement>)=>{event.preventDefault();const type=event.dataTransfer.getData('application/x-web-serial-component');if(!type)return;workspaceId.current+=1;setWorkspaceItems((current)=>[...current,{id:workspaceId.current,type}]);};
  return <div className="sm-components-view" ref={galleryRef}>
    <div className="sm-page-intro"><div><p className="sm-eyebrow">{zh?'组件库':'Component library'}</p><h2>{zh?'构建设备控制界面':'Build a live control surface'}</h2><p>{zh?'用于设备命令、姿态、状态和数值遥测的可复用组件示例。':'Reusable examples for device commands, sensor orientation, status, and numeric telemetry.'}</p></div><div className="sm-library-count"><Layers3 size={17}/><strong>8</strong><span>{zh?'个示例':'examples'}</span></div></div>
    <section className={`sm-builder-canvas ${workspaceItems.length?'has-items':''}`} onDragOver={(event)=>{event.preventDefault();event.dataTransfer.dropEffect='copy';}} onDrop={dropComponent}><div className="sm-builder-head"><div><strong>{zh?'自定义组件画布':'Custom component canvas'}</strong><span>{zh?'从下方拖动组件到这里':'Drag components from the library below'}</span></div>{workspaceItems.length>0&&<button onClick={()=>setWorkspaceItems([])}>{zh?'清空画布':'Clear canvas'}</button>}</div><div className="sm-builder-grid">{workspaceItems.length?workspaceItems.map((item)=><div className="sm-builder-widget" key={item.id}><span>{componentName(item.type)}</span><strong>{item.type==='imu'?`${roll.toFixed(1)}° / ${pitch.toFixed(1)}° / ${yaw.toFixed(1)}°`:item.type==='gauge'?`${clamp(Math.abs(latest[3]??72),0,100).toFixed(0)}%`:item.type==='status'?(enabled?(zh?'已就绪':'Ready'):(zh?'空闲':'Idle')):item.type==='slider'?`${setpoint[0]}%`:item.type==='button'?(pressed?'HIGH':'LOW'):item.type==='dashboard'?'3 metrics':x.toFixed(3)}</strong><button aria-label={zh?`删除${componentName(item.type)}`:`Remove ${componentName(item.type)}`} onClick={()=>setWorkspaceItems((current)=>current.filter((entry)=>entry.id!==item.id))}>×</button></div>):<div className="sm-builder-empty"><Layers3 size={22}/><span>{zh?'拖入组件开始布局':'Drop a component here to start your layout'}</span></div>}</div></section>
    <div className="sm-component-grid">
      <article draggable onDragStart={(event)=>beginDrag(event,'button')} className="sm-component-card sm-component-featured"><div className="sm-component-head"><div className="sm-component-icon"><Cpu size={18}/></div><div><strong>{zh?'命令按钮':'Command button'}</strong><span>{zh?'数字控制':'Digital control'}</span></div><code>BUTTON</code></div><div className="sm-button-stage"><Button className={pressed?'is-active':''} onClick={()=>setPressed((value)=>!value)}>{pressed?(zh?'输出已激活':'Output active'):(zh?'触发输出':'Trigger output')}</Button><span>{pressed?'HIGH':'LOW'}</span></div><p>{zh?'可用于复位、校准、继电器控制或发送固件能够识别的文本命令。':'Use a button for reset, calibration, relay control, or any text command your firmware understands.'}</p></article>
      <article draggable onDragStart={(event)=>beginDrag(event,'imu')} className="sm-component-card sm-component-featured sm-imu-card"><div className="sm-component-head"><div className="sm-component-icon"><Activity size={18}/></div><div><strong>{zh?'3D 欧拉角姿态':'3D Euler orientation'}</strong><span>{zh?'横滚 · 俯仰 · 偏航':'Roll · Pitch · Yaw'}</span></div><code>IMU</code></div><div className="sm-imu-stage"><div className="sm-cube-scene"><div className="sm-cube" style={{transform:`rotateX(${-pitch}deg) rotateY(${yaw}deg) rotateZ(${roll}deg)`}}><div className="front">FRONT</div><div className="back">BACK</div><div className="right">X+</div><div className="left">X−</div><div className="top">Z+</div><div className="bottom">Z−</div></div><div className="sm-axis-key"><i className="x">X</i><i className="y">Y</i><i className="z">Z</i></div></div><div className="sm-euler-bindings">{['Roll','Pitch','Yaw'].map((axis,index)=><label key={axis}><span>{zh?['横滚','俯仰','偏航'][index]:axis}<b>{[roll,pitch,yaw][index].toFixed(1)}°</b></span><select value={eulerFields[index]} onChange={(event)=>setEulerFields((current)=>current.map((field,fieldIndex)=>fieldIndex===index?Number(event.target.value):field))} disabled={!detectedFields.length}>{detectedFields.length?detectedFields.map((field,fieldIndex)=><option key={`${axis}-${field}`} value={fieldIndex}>{field}</option>):<option value={index}>{zh?'演示':'Demo'} {axis.toLowerCase()}</option>}</select></label>)}</div></div><p>{zh?'将横滚、俯仰和偏航分别绑定到任意三个数值字段，方块会按照角度值持续旋转。':'Bind Roll, Pitch, and Yaw to any three numeric serial fields. The cube updates continuously from Euler angles in degrees.'}</p></article>
      <article className="sm-component-card sm-component-wide"><div className="sm-component-head"><div className="sm-component-icon"><Gauge size={18}/></div><div><strong>{zh?'遥测仪表盘':'Telemetry dashboard'}</strong><span>{zh?'系统概览':'System overview'}</span></div><code>DASHBOARD</code></div><div className="sm-mini-dashboard"><div><span>{zh?'温度':'Temperature'}</span><strong>{Math.abs(x*3+24).toFixed(1)}<small>°C</small></strong><i className="ok">{zh?'正常':'Nominal'}</i></div><div><span>{zh?'总线电压':'Bus voltage'}</span><strong>{Math.abs(y/2+12).toFixed(2)}<small>V</small></strong><i>{zh?'实时':'Live'}</i></div><div><span>{zh?'采样率':'Samples'}</span><strong>120<small>Hz</small></strong><i className="ok">{zh?'稳定':'Stable'}</i></div></div><p>{zh?'将关键指标组织成易读的系统概览，同时保留底层串口数据流。':'Group key metrics into a readable system snapshot without hiding the underlying serial stream.'}</p></article>
      <article className="sm-component-card"><div className="sm-component-head"><div className="sm-component-icon"><Gauge size={18}/></div><div><strong>{zh?'径向仪表':'Radial gauge'}</strong><span>{zh?'有界数值':'Bounded value'}</span></div></div><GaugeDemo value={latest[3]??72} zh={zh}/></article>
      <article className="sm-component-card"><div className="sm-component-head"><div className="sm-component-icon"><Radio size={18}/></div><div><strong>{zh?'状态指示器':'Status indicator'}</strong><span>{zh?'布尔状态':'Boolean state'}</span></div></div><div className="sm-status-demo"><span className={enabled?'on':''}/><div><strong>{enabled?(zh?'设备已就绪':'Device ready'):(zh?'设备空闲':'Device idle')}</strong><small>{enabled?(zh?'正在接收遥测':'Receiving telemetry'):(zh?'输出已禁用':'Output disabled')}</small></div><Switch checked={enabled} onCheckedChange={setEnabled}/></div></article>
      <article className="sm-component-card"><div className="sm-component-head"><div className="sm-component-icon"><SlidersHorizontal size={18}/></div><div><strong>{zh?'设定值滑块':'Setpoint slider'}</strong><span>{zh?'数值命令':'Numeric command'}</span></div></div><div className="sm-slider-demo"><div><span>{zh?'目标值':'Target'}</span><strong>{setpoint[0]}%</strong></div><Slider value={setpoint} onValueChange={setSetpoint} min={0} max={100}/></div></article>
      <article className="sm-component-card sm-pid-card"><div className="sm-component-head"><div className="sm-component-icon"><SlidersHorizontal size={18}/></div><div><strong>{zh?'PID 控制器':'PID controller'}</strong><span>{zh?'比例 · 积分 · 微分':'Proportional · Integral · Derivative'}</span></div><code>PID</code></div><div className="sm-pid-controls">{(['p','i','d'] as const).map((term)=><label key={term}><span>{term.toUpperCase()}<b>{pid[term][0].toFixed(3)}</b></span><Slider value={pid[term]} onValueChange={(value)=>setPid((current)=>({...current,[term]:value}))} min={0} max={term==='p'?10:2} step={0.001}/></label>)}</div><p>{zh?'用于实时调整 P、I、D 参数；可拖入画布作为控制面板的 PID 组件。':'Tune P, I, and D values interactively, then drag the controller onto the custom canvas.'}</p></article>
      <article className="sm-component-card"><div className="sm-component-head"><div className="sm-component-icon"><Braces size={18}/></div><div><strong>{zh?'数值读数':'Numeric readout'}</strong><span>{zh?'高精度数值':'Precision value'}</span></div></div><div className="sm-readout"><span>accel.x</span><strong>{x.toFixed(6)}</strong><small>m/s²</small></div></article>
    </div>
  </div>;
}

export default function SerialWorkspace() {
  const [activeView,setActiveView] = useState<WorkspaceView>('monitor');
  const [baudRate,setBaudRate] = useState(115200);
  const [connected,setConnected] = useState(false);
  const [demo,setDemo] = useState(false);
  const [plotPaused,setPlotPaused] = useState(false);
  const [terminalPaused,setTerminalPaused] = useState(false);
  const [autoScroll,setAutoScroll] = useState(true);
  const [darkMode,setDarkMode] = useState(false);
  const [language,setLanguage] = useState<'en'|'zh'>('en');
  const [receiveEncoding,setReceiveEncoding] = useState<'utf-8'|'gbk'>('utf-8');
  const [displayFormat,setDisplayFormat] = useState<'text'|'hex'>('text');
  const [sendFormat,setSendFormat] = useState<'text'|'hex'>('text');
  const [copied,setCopied] = useState(false);
  const [visualMode,setVisualMode] = useState<'plot'|'imu'|'split'>('plot');
  const [sidebarImu,setSidebarImu] = useState(false);
  const [browserSupported,setBrowserSupported] = useState(false);
  const [points,setPoints] = useState<DataPoint[]>([]);
  const [detectedFields,setDetectedFields] = useState<string[]>([]);
  const [plots,setPlots] = useState<PlotConfig[]>([{id:1,name:'Plot 1',color:PLOT_COLORS[0],field:0},{id:2,name:'Plot 2',color:PLOT_COLORS[1],field:1},{id:3,name:'Plot 3',color:PLOT_COLORS[2],field:2}]);
  const [logs,setLogs] = useState<LogLine[]>([{id:1,time:'--:--:--',direction:'SYS',text:'Ready. Integer, decimal, scientific, labeled, and JSON numeric data are supported.'}]);
  const [liveFragment,setLiveFragment] = useState('');
  const [message,setMessage] = useState('');
  const [bytesReceived,setBytesReceived] = useState(0);
  const [error,setError] = useState('');
  const [plotWindow,setPlotWindow] = useState(120);
  const [panOffset,setPanOffset] = useState(0);
  const [verticalPan,setVerticalPan] = useState(0);
  const portRef = useRef<BrowserSerialPort|null>(null);
  const readerRef = useRef<SerialReader|null>(null);
  const pointIndex = useRef(0);
  const partialLine = useRef('');
  const partialBytes = useRef<number[]>([]);
  const receiveEncodingRef = useRef<'utf-8'|'gbk'>('utf-8');
  const lastFragment = useRef('');
  const plotPausedRef = useRef(false);
  const terminalPausedRef = useRef(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const demoTimerRef = useRef<number|null>(null);
  const nextPlotId = useRef(4);
  const pendingLogsRef = useRef<LogLine[]>([]);
  const pendingPointsRef = useRef<DataPoint[]>([]);
  const detectedFieldsRef = useRef<string[]>([]);

  useEffect(()=>{plotPausedRef.current=plotPaused;},[plotPaused]);
  useEffect(()=>{terminalPausedRef.current=terminalPaused;},[terminalPaused]);
  useEffect(()=>{receiveEncodingRef.current=receiveEncoding;},[receiveEncoding]);
  useEffect(()=>{setBrowserSupported(Boolean(navigator.serial));},[]);
  useEffect(()=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';setLogs((current)=>current.map((line)=>line.id===1?{...line,text:language==='zh'?'已就绪。支持整数、小数、科学计数法、带标签数值和 JSON 数值数据。':'Ready. Integer, decimal, scientific, labeled, and JSON numeric data are supported.'}:line));},[language]);
  const appendLog = useCallback((direction:LogLine['direction'],text:string,rawHex?:string)=>{pendingLogsRef.current.push({id:Date.now()+Math.random(),time:now(),direction,text,rawHex});if(pendingLogsRef.current.length>MAX_PENDING_LOGS)pendingLogsRef.current.splice(0,pendingLogsRef.current.length-MAX_PENDING_LOGS);},[]);
  const ingestLine = useCallback((line:string,showInTerminal=true,rawHex?:string)=>{const clean=line.trim();if(!clean)return;if(showInTerminal)appendLog('RX',clean,rawHex);if(plotPausedRef.current)return;const parsed=parseSerialFields(clean);if(!parsed.values.length)return;if(detectedFieldsRef.current.join('\u0000')!==parsed.labels.join('\u0000')){detectedFieldsRef.current=parsed.labels;setDetectedFields(parsed.labels);setPlots((current)=>current.map((plot,index)=>({...plot,field:plot.field<parsed.labels.length?plot.field:Math.min(index,parsed.labels.length-1)})));}pointIndex.current+=1;pendingPointsRef.current.push({index:pointIndex.current,values:parsed.values});},[appendLog]);
  useEffect(()=>{const timer=window.setInterval(()=>{if(!terminalPausedRef.current&&pendingLogsRef.current.length){const batch=pendingLogsRef.current.splice(0);setLogs((current)=>[...current,...batch].slice(-MAX_LOG_LINES));}if(pendingPointsRef.current.length){const batch=pendingPointsRef.current.splice(0);setPoints((current)=>[...current,...batch].slice(-MAX_POINTS));setPanOffset((offset)=>offset>0?offset+batch.length:0);}const fragment=partialLine.current.slice(-4096);if(!terminalPausedRef.current&&fragment!==lastFragment.current){lastFragment.current=fragment;setLiveFragment(fragment);}},80);return()=>window.clearInterval(timer);},[]);

  const readLoop = useCallback(async(port:BrowserSerialPort)=>{if(!port.readable)return;const reader=port.readable.getReader();readerRef.current=reader;const decode=(bytes:number[])=>{try{return new TextDecoder(receiveEncodingRef.current).decode(new Uint8Array(bytes));}catch{return new TextDecoder('utf-8').decode(new Uint8Array(bytes));}};try{while(true){const{value,done}=await reader.read();if(done)break;if(!value)continue;setBytesReceived((total)=>total+value.byteLength);for(const byte of value){if(byte===10||byte===13){const frame=partialBytes.current.splice(0);if(frame.length){const text=decode(frame);ingestLine(text,true,bytesToHex(frame));}}else partialBytes.current.push(byte);}partialLine.current=decode(partialBytes.current);}}catch(readError){if(portRef.current)setError(readError instanceof Error?readError.message:'Serial read failed.');}finally{if(partialBytes.current.length){const frame=partialBytes.current.splice(0);const text=decode(frame);if(text.trim())appendLog('RX',text.trim(),bytesToHex(frame));}partialLine.current='';setLiveFragment('');reader.releaseLock();readerRef.current=null;}},[appendLog,ingestLine]);
  const connect=async()=>{setError('');if(!navigator.serial)return setError('Web Serial is unavailable. Use Chrome or Edge over HTTPS or localhost.');try{const port=await navigator.serial.requestPort();await port.open({baudRate});portRef.current=port;setConnected(true);appendLog('SYS',`Connected at ${baudRate} baud.`);void readLoop(port);}catch(connectError){setError(connectError instanceof Error?connectError.message:'Could not open the serial port.');}};
  const disconnect=useCallback(async()=>{const port=portRef.current;try{await readerRef.current?.cancel();await port?.close();}catch{/* Browser may release an unplugged reader. */}readerRef.current=null;portRef.current=null;setConnected(false);appendLog('SYS','Disconnected.');},[appendLog]);
  useEffect(()=>()=>{void readerRef.current?.cancel();},[]);
  const stopDemo=useCallback((announce=true)=>{if(demoTimerRef.current!==null){window.clearInterval(demoTimerRef.current);demoTimerRef.current=null;}setDemo(false);if(announce)appendLog('SYS','Demo stream stopped.');},[appendLog]);
  const toggleDemo=()=>{if(demoTimerRef.current!==null)return stopDemo();setDemo(true);appendLog('SYS','Demo stream started.');demoTimerRef.current=window.setInterval(()=>{const t=Date.now()/720;ingestLine(`accel(m/s^2) x=${(Math.sin(t)*8).toFixed(3)} y=${(Math.cos(t*.72)*7).toFixed(3)} z=${(8.6+Math.sin(t*.45)).toFixed(3)} gyro(rad/s) x=${(Math.sin(t*.4)*2).toFixed(3)} y=${(Math.cos(t*.55)*3).toFixed(3)} z=${(Math.sin(t*.8)*1.5).toFixed(3)} euler(deg) roll=${(Math.sin(t*.32)*55).toFixed(2)} pitch=${(Math.cos(t*.41)*35).toFixed(2)} yaw=${(((t*22)%360)-180).toFixed(2)}`,true);},120);};
  useEffect(()=>()=>{if(demoTimerRef.current!==null)window.clearInterval(demoTimerRef.current);},[]);
  useEffect(()=>{if(autoScroll&&!terminalPaused)terminalRef.current?.scrollTo({top:terminalRef.current.scrollHeight});},[logs,liveFragment,autoScroll,terminalPaused]);
  useEffect(()=>{if(!document.modelContext?.registerTool)return;const lifecycle=new AbortController();void Promise.resolve(document.modelContext.registerTool({name:'clear_monitor_data',title:'Clear monitor data',description:'Clear plot samples and terminal output.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:()=>{pendingLogsRef.current=[];pendingPointsRef.current=[];setPoints([]);setLogs([]);setBytesReceived(0);return{cleared:true};}},{signal:lifecycle.signal})).catch(()=>undefined);return()=>lifecycle.abort();},[]);

  const sendMessage=async()=>{const text=message.trim();if(!text)return;if(!portRef.current?.writable)return setError('Connect a serial device before sending data.');let payload:Uint8Array;try{payload=sendFormat==='hex'?parseHex(text):new TextEncoder().encode(`${text}\n`);}catch(sendError){setError(sendError instanceof Error?sendError.message:'Invalid HEX data.');return;}const writer=portRef.current.writable.getWriter();try{await writer.write(payload);appendLog('TX',sendFormat==='hex'?bytesToHex(payload):text,bytesToHex(payload));setMessage('');}finally{writer.releaseLock();}};
  const displayedLog=(line:LogLine)=>displayFormat==='hex'?(line.rawHex??bytesToHex(new TextEncoder().encode(line.text))):line.text;
  const copyTerminal=async()=>{const content=[...logs.map((line)=>`${line.time} ${line.direction} ${displayedLog(line)}`),liveFragment?`RX ${displayFormat==='hex'?bytesToHex(new TextEncoder().encode(liveFragment)):liveFragment}`:''].filter(Boolean).join('\n');try{await navigator.clipboard.writeText(content);setCopied(true);window.setTimeout(()=>setCopied(false),1500);}catch{setError('Could not copy terminal output.');}};
  const latest=points.at(-1)?.values??[];
  const values=useMemo(()=>plots.map((plot)=>Number.isFinite(latest[plot.field])?latest[plot.field].toFixed(2):'—'),[latest,plots]);
  const addPlot=()=>setPlots((current)=>{const id=nextPlotId.current++;const nextUnusedField=detectedFields.findIndex((_,field)=>!current.some((plot)=>plot.field===field));return[...current,{id,name:`Plot ${id}`,color:PLOT_COLORS[(id-1)%PLOT_COLORS.length],field:nextUnusedField>=0?nextUnusedField:0}];});
  const addAllFields=()=>setPlots((current)=>{const used=new Set(current.map((plot)=>plot.field));return[...current,...detectedFields.flatMap((_,field)=>{if(used.has(field))return[];const id=nextPlotId.current++;return[{id,name:`Plot ${id}`,color:PLOT_COLORS[(id-1)%PLOT_COLORS.length],field}];})];});
  const clearTerminal=()=>{pendingLogsRef.current=[];partialLine.current='';setLiveFragment('');setLogs([]);};
  const zh=language==='zh';
  const statusText=connected?(zh?'已连接':'Connected'):demo?(zh?'演示数据':'Demo stream'):(zh?'未连接':'Disconnected');
  const maxPanOffset=Math.max(0,points.length-Math.min(plotWindow,points.length));

  const terminalPanel=<Tabs defaultValue="terminal" className="sm-terminal sm-card">
    <div className="sm-terminal-head"><TabsList><TabsTrigger value="terminal">{zh?'终端':'Terminal'}</TabsTrigger><TabsTrigger value="format">{zh?'数据格式':'Data format'}</TabsTrigger></TabsList><div className="sm-terminal-actions"><span className={connected||demo?'streaming':''}><i/>{terminalPaused?(zh?'输出已暂停':'Output paused'):connected||demo?(zh?'RX 实时':'RX live'):(zh?'RX 空闲':'RX idle')}</span><span><ArrowDownToLine size={14}/>{bytesReceived.toLocaleString()} {zh?'字节':'bytes'}</span><select className="sm-terminal-select" value={receiveEncoding} onChange={(event)=>setReceiveEncoding(event.target.value as 'utf-8'|'gbk')} aria-label={zh?'接收编码':'Receive encoding'}><option value="utf-8">UTF-8</option><option value="gbk">GBK / GB2312</option></select><select className="sm-terminal-select" value={displayFormat} onChange={(event)=>setDisplayFormat(event.target.value as 'text'|'hex')} aria-label={zh?'显示格式':'Display format'}><option value="text">{zh?'文本':'Text'}</option><option value="hex">HEX</option></select><Button variant="ghost" size="sm" onClick={copyTerminal}><Copy size={14}/>{copied?(zh?'已复制':'Copied'):(zh?'复制':'Copy')}</Button><Button variant="ghost" size="sm" onClick={()=>setTerminalPaused((value)=>!value)}>{terminalPaused?<Play size={14}/>:<Pause size={14}/>} {terminalPaused?(zh?'继续':'Resume'):(zh?'暂停':'Pause')}</Button><Button variant="ghost" size="sm" onClick={clearTerminal}><Eraser size={14}/>{zh?'清空':'Clear'}</Button></div></div>
    <TabsContent value="terminal" className="sm-terminal-content"><div className="sm-output" ref={terminalRef} aria-live="polite" onScroll={(event)=>{const element=event.currentTarget;setAutoScroll(element.scrollHeight-element.scrollTop-element.clientHeight<28);}}>{logs.map((line)=><div className="sm-log" key={line.id}><time>{line.time}</time><b className={line.direction.toLowerCase()}>{line.direction}</b><code>{displayedLog(line)}</code></div>)}{liveFragment&&<div className="sm-log sm-fragment"><time>{now()}</time><b className="rx">RX</b><code>{displayFormat==='hex'?bytesToHex(new TextEncoder().encode(liveFragment)):liveFragment}<span className="sm-caret"/></code></div>}{!logs.length&&!liveFragment&&<div className="sm-terminal-empty"><TerminalSquare size={20}/><span>{zh?'等待串口输出':'Waiting for serial output'}</span></div>}</div><div className="sm-terminal-footer"><button className={autoScroll?'active':''} onClick={()=>setAutoScroll((value)=>!value)}>{zh?'自动滚动':'Auto-scroll'} {autoScroll?(zh?'开启':'on'):(zh?'关闭':'off')}</button><span>{logs.length} {zh?'行已保留':'lines retained'}</span></div><div className="sm-send"><div className="sm-send-mode"><button className={sendFormat==='text'?'active':''} onClick={()=>setSendFormat('text')}>{zh?'字符串':'String'}</button><button className={sendFormat==='hex'?'active':''} onClick={()=>setSendFormat('hex')}>HEX</button></div><Input value={message} onChange={(event)=>setMessage(event.target.value)} onKeyDown={(event)=>event.key==='Enter'&&void sendMessage()} placeholder={sendFormat==='hex'?(zh?'输入 HEX 字节，例如 01 0A FF':'Enter HEX bytes, e.g. 01 0A FF'):(zh?'输入命令并按 Enter':'Type a command and press Enter')} aria-label={zh?'串口命令':'Serial command'}/><Button variant="outline" size="icon" className="sm-send-clear" onClick={()=>setMessage('')} disabled={!message} aria-label={zh?'清除发送内容':'Clear send input'}><Eraser size={15}/></Button><Button onClick={sendMessage}><Send size={16}/>{zh?'发送':'Send'}</Button></div></TabsContent>
    <TabsContent value="format" className="sm-format">
      <div className="sm-format-intro"><div className="sm-component-icon"><Braces size={18}/></div><div><strong>{zh?'当前解析器真实支持的格式':'Formats the current parser actually supports'}</strong><p>{zh?'解析器会逐行尝试文本 JSON、带标签的键值对，最后尝试分隔数值。只提取有限的整数或浮点数。':'Each completed text line is tried as JSON, labeled key/value text, then delimited numbers. Only finite integers and floating-point values are extracted.'}</p></div></div>
      <div className="sm-format-warning"><strong>{zh?'协议范围':'Protocol scope'}</strong><span>{zh?'当前版本仅支持 UTF-8/ASCII 文本帧，包括分隔数值、带名称字段和 JSON。尚未实现任何二进制浮点帧或原始字节流解析。':'This release accepts UTF-8/ASCII text frames: delimited values, named fields, and JSON. Binary floating-point frames and raw byte-stream parsing are not implemented.'}</span></div>
      <div className="sm-format-grid">
        <div className="sm-code-example"><span>{zh?'Arduino：CSV 数值':'Arduino: CSV values'}</span><pre><code>{'Serial.print(ax, 3);\nSerial.print(",");\nSerial.print(ay, 3);\nSerial.print(",");\nSerial.println(az, 3);'}</code></pre><p>{zh?'终端输出示例：':'Serial output:'} <code>-2.077,-5.402,8.956</code></p></div>
        <div className="sm-code-example"><span>{zh?'C/C++：带名称字段':'C/C++: named fields'}</span><pre><code>{'printf("accel.x=%.3f accel.y=%.3f accel.z=%.3f\\r\\n",\n       ax, ay, az);'}</code></pre><p>{zh?'生成可直接绑定的':'Creates directly bindable'} <code>accel.x</code>、<code>accel.y</code>、<code>accel.z</code>.</p></div>
        <div className="sm-code-example"><span>{zh?'Arduino：欧拉角':'Arduino: Euler angles'}</span><pre><code>{'Serial.print("euler.roll="); Serial.print(roll, 2);\nSerial.print(" euler.pitch="); Serial.print(pitch, 2);\nSerial.print(" euler.yaw="); Serial.println(yaw, 2);'}</code></pre><p>{zh?'可分别绑定到 3D IMU 的横滚、俯仰和偏航。':'Bind the three fields to Roll, Pitch, and Yaw in the 3D IMU.'}</p></div>
        <div className="sm-code-example"><span>{zh?'JSON 文本帧':'JSON text frame'}</span><pre><code>{'Serial.printf("{\\\"temp\\\":%.2f,\\\"voltage\\\":%.3f}\\n",\n              temperature, voltage);'}</code></pre><p>{zh?'JSON 可以嵌套；例如':'JSON may be nested; for example'} <code>power.voltage</code> {zh?'会成为字段名。':'becomes a field name.'}</p></div>
      </div>
      <div className="sm-format-note"><strong>{zh?'分帧规则':'Framing rule'}</strong><span>{zh?'每个样本必须以 LF、CR 或 CRLF 结尾。没有换行的数据会先作为终端实时片段显示，收到行尾后才会参与绘图解析。':'Every sample must end with LF, CR, or CRLF. Data without a line ending remains a live Terminal fragment and is parsed for plotting only after its line ending arrives.'}</span></div>
    </TabsContent>
  </Tabs>;

  return <main className={`sm-shell ${darkMode?'dark':''} visual-${visualMode}`}>
    <header className="sm-topbar"><div className="sm-brand"><div className="sm-brand-mark"><Radio size={19}/></div><div><h1>Web Serial Monitor</h1><p>{zh?'设备数据工作台':'Device data workspace'}</p></div></div><div className="sm-connection-strip"><label className="sm-baud"><span>{zh?'波特率':'Baud'}</span><select value={baudRate} onChange={(event)=>setBaudRate(Number(event.target.value))} disabled={connected}>{[9600,19200,38400,57600,115200,230400,460800,921600].map((rate)=><option key={rate}>{rate}</option>)}</select></label><div className={`sm-status ${connected||demo?'online':''}`}><span/>{statusText}</div><Button variant="outline" className="sm-lang-toggle" onClick={()=>setLanguage((current)=>current==='en'?'zh':'en')} aria-label={zh?'Switch to English':'Switch to Chinese'}>{zh?'EN':'Chinese'}</Button><Button variant="outline" size="icon" className="sm-theme-toggle" onClick={()=>setDarkMode((current)=>!current)} aria-label={darkMode?(zh?'使用浅色主题':'Use light theme'):(zh?'使用深色主题':'Use dark theme')}>{darkMode?<Sun size={16}/>:<Moon size={16}/>}</Button><Button className="sm-connect" onClick={connected?disconnect:connect}>{connected?<Unplug size={16}/>:<Usb size={16}/>} {connected?(zh?'断开连接':'Disconnect'):(zh?'连接设备':'Connect device')}</Button></div></header>
    <nav className="sm-mobile-nav" aria-label={zh?'工作区':'Workspace'}><button className={activeView==='monitor'?'active':''} onClick={()=>setActiveView('monitor')}><LineChart size={16}/>{zh?'遥测工作台':'Telemetry Studio'}</button><button className={activeView==='components'?'active':''} onClick={()=>setActiveView('components')}><Layers3 size={16}/>{zh?'组件':'Components'}</button></nav>
    <div className="sm-workspace"><aside className="sm-sidebar"><div className="sm-sidebar-section"><p className="sm-eyebrow">{zh?'工作区':'Workspace'}</p><button className={`sm-nav ${activeView==='monitor'?'active':''}`} onClick={()=>setActiveView('monitor')}><LineChart size={18}/><span>{zh?'遥测工作台':'Telemetry Studio'}</span><i className={connected||demo?'live':''}>{connected||demo?(zh?'实时':'Live'):''}</i></button><button className={`sm-nav ${activeView==='components'?'active':''}`} onClick={()=>setActiveView('components')}><Layers3 size={18}/><span>{zh?'组件':'Components'}</span><i>8</i></button></div>
      {activeView==='monitor'?<div className="sm-sidebar-section grow"><div className="sm-section-row"><p className="sm-eyebrow">{zh?'绘图绑定':'Plot bindings'}</p><div className="sm-binding-actions">{detectedFields.length>0&&<Button variant="ghost" size="sm" className="sm-add-plot" onClick={addAllFields}>{zh?'全部添加':'Add all'}</Button>}<Button variant="ghost" size="sm" className="sm-add-plot" onClick={addPlot}><Plus size={14}/>{zh?'添加':'Add'}</Button></div></div><p className="sm-channel-help">{detectedFields.length?(zh?`检测到 ${detectedFields.length} 个数值字段`:`${detectedFields.length} numeric fields detected`):(zh?'连接设备后自动发现字段':'Connect a device to discover fields')}</p>{plots.map((plot,index)=><div className="sm-channel" key={plot.id}><span style={{background:plot.color}}/><label>{zh?`曲线 ${index+1}`:plot.name}</label><select value={plot.field} onChange={(event)=>setPlots((current)=>current.map((item)=>item.id===plot.id?{...item,field:Number(event.target.value)}:item))} disabled={!detectedFields.length}>{detectedFields.length?detectedFields.map((fieldName,field)=><option value={field} key={`${fieldName}-${field}`}>{fieldName}</option>):<option>{zh?'等待数据':'Waiting for data'}</option>}</select><strong>{values[index]}</strong><button className="sm-remove-plot" onClick={()=>setPlots((current)=>current.filter((item)=>item.id!==plot.id))} aria-label={zh?`删除曲线 ${index+1}`:`Remove ${plot.name}`}><Trash2 size={13}/></button></div>)}{!plots.length&&<div className="sm-no-plots">{zh?'尚未添加曲线':'No plots added'}</div>}</div>:<div className="sm-sidebar-context grow"><p className="sm-eyebrow">{zh?'组件库':'Library'}</p><p>{zh?'在每个显示组件中选择数据字段；即使未连接设备，输出控件也可交互。':'Select data fields inside each display component. Output controls remain interactive without a device.'}</p><div className="sm-library-tags"><span>{zh?'输入':'Input'}</span><span>{zh?'运动':'Motion'}</span><span>{zh?'状态':'Status'}</span><span>{zh?'指标':'Metrics'}</span></div></div>}
      {activeView==='monitor'&&<div className="sm-layout-tools"><p className="sm-eyebrow">{zh?'工作台显示':'Studio display'}</p><div className="sm-layout-buttons"><button className={visualMode==='plot'?'active':''} onClick={()=>setVisualMode('plot')}>{zh?'曲线':'Plot'}</button><button className={visualMode==='imu'?'active':''} onClick={()=>setVisualMode('imu')}>IMU</button><button className={visualMode==='split'?'active':''} onClick={()=>setVisualMode('split')}>{zh?'并排':'Split'}</button></div><button className={`sm-dock-toggle ${sidebarImu?'active':''}`} onClick={()=>setSidebarImu((value)=>!value)}><Layers3 size={13}/>{sidebarImu?(zh?'从左侧移除 IMU':'Remove IMU from left'):(zh?'将 IMU 停靠在左侧':'Dock IMU on left')}</button>{sidebarImu&&<TelemetryImuPanel latest={latest} detectedFields={detectedFields} zh={zh} compact/>}</div>}
      <div className="sm-device"><Plug size={18}/><div><strong>Web Serial</strong><span>{browserSupported?(zh?'当前浏览器可用':'Available in this browser'):(zh?'需要 Chrome 或 Edge':'Chrome or Edge required')}</span></div></div></aside>
      <section className="sm-main">{activeView==='monitor'&&<><div className="sm-page-intro sm-monitor-intro"><div><p className="sm-eyebrow">{zh?'实时遥测':'Live telemetry'}</p><h2>{zh?'遥测工作台':'Telemetry Studio'}</h2><p>{zh?'在同一工作台中观察波形、原始数据和设备命令。':'Explore signals, raw serial data, and device commands in one focused workspace.'}</p></div><div className="sm-actions"><Button variant="outline" size="sm" onClick={toggleDemo} disabled={connected}>{demo?<CircleStop size={15}/>:<Play size={15}/>} {demo?(zh?'停止演示':'Stop demo'):(zh?'运行演示':'Run demo')}</Button><Button variant="outline" size="icon-sm" aria-label={plotPaused?(zh?'继续绘图':'Resume plot'):(zh?'暂停绘图':'Pause plot')} onClick={()=>setPlotPaused((value)=>!value)}>{plotPaused?<Play size={15}/>:<Pause size={15}/>}</Button></div></div><div className="sm-card sm-plot-card"><div className="sm-plot-toolbar"><div className="sm-legend">{plots.length?plots.map((plot,index)=><span key={plot.id}><i style={{background:plot.color}}/>{detectedFields[plot.field]||(zh?`字段 ${plot.field+1}`:`Field ${plot.field+1}`)}</span>):<span>{zh?'没有活动曲线':'No active plots'}</span>}</div><div className="sm-plot-controls"><span>{zh?`${Math.min(plotWindow,points.length||plotWindow)} 个样本窗口`:`${Math.min(plotWindow,points.length||plotWindow)} sample window`}</span><Button variant="ghost" size="icon-sm" aria-label={zh?'放大':'Zoom in'} onClick={()=>setPlotWindow((value)=>clamp(Math.round(value*.8),20,MAX_POINTS))}><ZoomIn size={15}/></Button><Button variant="ghost" size="icon-sm" aria-label={zh?'缩小':'Zoom out'} onClick={()=>setPlotWindow((value)=>clamp(Math.round(value*1.25),20,MAX_POINTS))}><ZoomOut size={15}/></Button><Button variant="ghost" size="icon-sm" aria-label={zh?'显示全部样本':'Fit all samples'} onClick={()=>{setPlotWindow(MAX_POINTS);setPanOffset(0);setVerticalPan(0);}}><Maximize2 size={15}/></Button><Button variant="ghost" size="icon-sm" aria-label={zh?'重置绘图视图':'Reset plot view'} onClick={()=>{setPlotWindow(120);setPanOffset(0);setVerticalPan(0);}}><RotateCcw size={15}/></Button></div></div><LivePlot points={points} plots={plots} windowSize={plotWindow} panOffset={panOffset} verticalPan={verticalPan} zh={zh} onWindowSize={(value)=>{setPlotWindow(value);setPanOffset((offset)=>clamp(offset,0,Math.max(0,points.length-value)));}} onPanOffset={setPanOffset} onVerticalPan={setVerticalPan}/><div className="sm-range-bar"><MoveHorizontal size={14}/><span>{zh?'历史':'History'}</span><input aria-label={zh?'绘图历史位置':'Plot history position'} type="range" min="0" max={maxPanOffset} value={clamp(panOffset,0,maxPanOffset)} onChange={(event)=>setPanOffset(Number(event.target.value))}/><button onClick={()=>setPanOffset(0)} disabled={panOffset===0}>{zh?'跳转到实时':'Jump to live'}</button></div></div>{terminalPanel}</>}
        {activeView==='monitor'&&visualMode!=='plot'&&<div className="sm-imu-workspace-slot"><TelemetryImuPanel latest={latest} detectedFields={detectedFields} zh={zh}/></div>}
        {activeView==='components'&&<ComponentsGallery latest={latest} detectedFields={detectedFields} zh={zh}/>} {error&&<div className="sm-error" role="alert">{error}<button onClick={()=>setError('')}>{zh?'关闭':'Dismiss'}</button></div>}</section>
    </div>
  </main>;
}
