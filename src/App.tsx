import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useBluetooth } from '@/hooks/useBluetooth';
import { logger } from '@/lib/logger';
import { BUILD_VERSION, BUILD_DATE, BUILD_EMOJIS } from '@/lib/version';
import type { LogEntry, EEGLogEntry } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bluetooth, BluetoothOff, CircleOff, Copy, Download, FileText,
  Plus, Play, Signal, Smartphone, Square, Trash, Zap
} from 'lucide-react';
import './App.css';

const DeviceCard = lazy(() => import('@/components/DeviceCard'));
const EEGChart = lazy(() => import('@/components/EEGChart'));
const MaxConnectionTest = lazy(() => import('@/components/MaxConnectionTest'));

function LazyWrap({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="h-4 bg-slate-200/50 rounded animate-pulse" />}>{children}</Suspense>;
}

function EEGDataLogPanel() {
  const [entries, setEntries] = useState<EEGLogEntry[]>(logger.eegGetEntries());

  useEffect(() => {
    let mounted = true;
    const unsub = logger.eegSubscribe((all) => { if (mounted) setEntries([...all]); });
    return () => { mounted = false; unsub(); };
  }, []);

  return (
    <Card className="bg-white border-slate-200 shadow-sm">
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1 text-slate-700">
            <Signal className="w-3.5 h-3.5 text-purple-600" />EEG Data Log ({entries.length})
          </CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => logger.eegDownload()}><Download className="w-3 h-3" />Download</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 text-slate-500" onClick={() => { logger.eegClear(); setEntries([]); }}><Trash className="w-3 h-3" />Clear</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-40 rounded bg-purple-50/50 border border-purple-100 p-2">
          <div className="text-[10px] font-mono space-y-0.5">
            {entries.length === 0 && <div className="text-slate-400">No EEG data yet. Start streaming to capture raw packets.</div>}
            {entries.map((e, i) => {
              const t = new Date(e.ts);
              const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}.${String(t.getMilliseconds()).padStart(3,'0')}`;
              return (
                <div key={i} className="text-purple-800">
                  <span className="text-purple-400">{ts}</span>
                  <span className="text-purple-500 ml-1">[{e.deviceName}]</span>
                  <span className="text-slate-600 ml-1">{e.hex}</span>
                  <span className="text-slate-400 ml-1">({e.bytes}b)</span>
                  {e.packetNum !== undefined && <span className="text-slate-500 ml-1">pkt={e.packetNum}</span>}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>(logger.getEntries());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsub = logger.subscribe((all) => { if (mounted) setEntries([...all]); });
    return () => { mounted = false; unsub(); };
  }, []);

  const handleCopy = useCallback(async () => {
    if (await logger.copyToClipboard()) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }, []);

  return (
    <Card className="bg-white border-slate-200 shadow-sm">
      <CardHeader className="pb-2 pt-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-1 text-slate-700"><FileText className="w-3.5 h-3.5" />Debug Log ({entries.length})</CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={handleCopy}>
              {copied ? <FileText className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={() => logger.download()}><Download className="w-3 h-3" />Download</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 text-slate-500" onClick={() => { logger.clear(); setEntries([]); }}><Trash className="w-3 h-3" />Clear</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-48 rounded bg-slate-50 border border-slate-200 p-2">
          <div className="text-[10px] font-mono space-y-0.5">
            {entries.length === 0 && <div className="text-slate-400">No logs yet. Add a device and connect.</div>}
            {entries.map((entry, i) => {
              const t = new Date(entry.ts);
              const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}.${String(t.getMilliseconds()).padStart(3,'0')}`;
              const color = entry.level === 'error' ? 'text-red-600' : entry.level === 'warn' ? 'text-amber-600' : entry.level === 'success' ? 'text-green-600' : entry.level === 'tx' ? 'text-violet-600' : 'text-slate-700';
              return (<div key={i} className={color}><span className="text-slate-400">{ts}</span><span className="text-slate-400 ml-1">[{entry.level.toUpperCase()}]</span><span className="text-slate-400 ml-1">[{entry.tag}]</span><span className="ml-1">{entry.msg}</span></div>);
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default function App() {
  const bt = useBluetooth();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [logCopied, setLogCopied] = useState(false);

  const { selectedDeviceData, connectedCount, streamingCount } = useMemo(() => ({
    selectedDeviceData: bt.devices.find((d) => d.id === selectedDevice) || null,
    connectedCount: bt.devices.filter((d) => d.state === 'connected').length,
    streamingCount: bt.devices.filter((d) => d.isStreaming).length,
  }), [bt.devices, selectedDevice]);

  useEffect(() => { logger.info('UI', 'App mounted'); }, []);

  const handleScan = useCallback(async () => {
    logger.info('UI', 'Scanning...');
    try { const dev = await bt.scanDevice(); if (dev) logger.success('UI', `Found: ${dev.name}`); }
    catch (e: unknown) { logger.error('UI', e instanceof Error ? e.message : String(e)); }
  }, [bt]);

  const handleCopyLogsTop = useCallback(async () => {
    if (await logger.copyToClipboard()) { setLogCopied(true); setTimeout(() => setLogCopied(false), 2000); }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            {bt.isSupported ? <Bluetooth className="w-6 h-6 text-blue-600" /> : <BluetoothOff className="w-6 h-6 text-red-500" />}
            <div>
              <h1 className="text-base font-bold leading-tight text-slate-900">Neiry BT Diagnostics</h1>
              <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                <span>v{BUILD_VERSION}</span>
                <span className="text-slate-300">|</span>
                <span>{BUILD_DATE}</span>
                <span className="text-slate-300">|</span>
                <span>{BUILD_EMOJIS}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] gap-1 bg-white"><Smartphone className="w-3 h-3" />{bt.devices.length}</Badge>
            <Badge variant="outline" className={`text-[10px] gap-1 bg-white ${connectedCount > 0 ? 'text-green-700 border-green-400' : ''}`}><Zap className="w-3 h-3" />{connectedCount}</Badge>
            <Badge variant="outline" className={`text-[10px] gap-1 bg-white ${streamingCount > 0 ? 'text-blue-700 border-blue-400' : ''}`}><Signal className="w-3 h-3" />{streamingCount}</Badge>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" onClick={handleCopyLogsTop}>
              {logCopied ? <FileText className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}{logCopied ? 'Copied!' : 'Copy Logs'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] gap-1" onClick={() => logger.download()}><Download className="w-3 h-3" />Download</Button>
          </div>
        </div>
      </header>

      {!bt.isSupported && (
        <div className="max-w-7xl mx-auto px-3 mt-3">
          <Card className="border-red-300 bg-red-50"><CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <BluetoothOff className="w-6 h-6 text-red-500 mt-0.5" />
              <div className="text-sm"><h3 className="font-bold text-red-600">Web Bluetooth Not Supported</h3><p className="text-slate-600 mt-1">Use Chrome on Android, or Chrome/Edge on desktop.</p></div>
            </div>
          </CardContent></Card>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-3 py-3">
        {/* Controls */}
        <Card className="mb-3 bg-white border-slate-200 shadow-sm"><CardContent className="pt-3 pb-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Button onClick={handleScan} disabled={!bt.isSupported || bt.isScanning} size="sm" className="gap-1"><Plus className="w-3.5 h-3.5" />{bt.isScanning ? 'Scanning...' : 'Add Device'}</Button>
            <Button variant="outline" onClick={() => bt.connectAll()} disabled={bt.devices.length === 0} size="sm" className="gap-1"><Zap className="w-3.5 h-3.5" />Connect All</Button>
            <Button variant="outline" onClick={() => bt.startAll()} disabled={connectedCount === 0} size="sm" className="gap-1 bg-green-50 border-green-300 hover:bg-green-100 text-green-700"><Play className="w-3.5 h-3.5" />Start All</Button>
            <Button variant="outline" onClick={() => bt.stopAll()} disabled={streamingCount === 0} size="sm" className="gap-1 bg-red-50 border-red-300 hover:bg-red-100 text-red-700"><Square className="w-3.5 h-3.5" />Stop All</Button>
            <Button variant="ghost" size="sm" onClick={() => bt.devices.forEach((d) => bt.disconnect(d.id))} disabled={connectedCount === 0} className="gap-1 text-slate-500"><CircleOff className="w-3.5 h-3.5" />Disconnect All</Button>
          </div>
        </CardContent></Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Left — Devices */}
          <div className="space-y-3 lg:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Devices</h2>
              <Badge variant="secondary" className="text-[10px] bg-slate-100">{bt.devices.length}</Badge>
            </div>
            {bt.devices.length === 0 && (
              <Card className="border-dashed border-slate-300 bg-white"><CardContent className="pt-6 text-center">
                <Bluetooth className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No devices yet</p>
                <p className="text-xs text-slate-400 mt-1">Click &quot;Add Device&quot; to scan</p>
              </CardContent></Card>
            )}
            <div className="space-y-3">
              {bt.devices.map((device) => (
                <LazyWrap key={device.id}>
                  <DeviceCard device={device} onConnect={bt.connect} onDisconnect={bt.disconnect}
                    onStart={bt.startSignal} onStop={bt.stopSignal} onValidate={bt.validateProtocol}
                    onRemove={bt.removeDevice} onExport={bt.exportCSV}
                    isSelected={selectedDevice === device.id} onSelect={setSelectedDevice} />
                </LazyWrap>
              ))}
            </div>
            {bt.devices.length > 0 && (
              <LazyWrap><MaxConnectionTest deviceCount={bt.devices.length} connectedCount={connectedCount} onTest={bt.testMaxConnections} /></LazyWrap>
            )}
          </div>

          {/* Right — Chart + Log */}
          <div className="space-y-3 lg:col-span-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1"><Signal className="w-3 h-3" />EEG Signal</h2>
                {selectedDeviceData && <Badge variant="outline" className="text-[10px] gap-1 bg-white"><Zap className="w-3 h-3" />{selectedDeviceData.name}</Badge>}
              </div>
              <LazyWrap><EEGChart device={selectedDeviceData} /></LazyWrap>
            </div>

            <EEGDataLogPanel />

            <LogPanel />

            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader className="pb-1 pt-3"><CardTitle className="text-xs text-slate-700">Protocol Reference</CardTitle></CardHeader>
              <CardContent className="text-[10px] text-slate-500 space-y-1">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div>Service HB: <code className="text-green-700 font-mono bg-green-50 px-1 rounded">7e400001...cca95</code></div>
                  <div>Service HP: <code className="text-green-700 font-mono bg-green-50 px-1 rounded">7e400001...cca96</code></div>
                  <div>Cmd PowerDown: <code className="text-blue-700 font-mono bg-blue-50 px-1 rounded">0x01</code></div>
                  <div>Cmd Idle: <code className="text-blue-700 font-mono bg-blue-50 px-1 rounded">0x02</code></div>
                  <div>Cmd StartSig: <code className="text-blue-700 font-mono bg-blue-50 px-1 rounded">0x03</code></div>
                  <div>Cmd StartRes: <code className="text-blue-700 font-mono bg-blue-50 px-1 rounded">0x04</code></div>
                  <div>Rate: <code className="font-mono bg-slate-100 px-1 rounded">250 Hz</code></div>
                  <div>Channels: <code className="font-mono bg-slate-100 px-1 rounded">4 x 24-bit signed</code></div>
                </div>
                <div className="text-slate-400 pt-1 border-t border-slate-200">Startup: 0x01(1200ms) → 0x02(50ms) → Settings(50ms) → 0x03</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
