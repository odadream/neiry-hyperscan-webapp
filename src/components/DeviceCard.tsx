import { useState, memo, useCallback } from 'react';
import type { NeiryDevice } from '@/types/bluetooth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Activity, Battery, CircleOff, Play, Scan, Signal, Square, Trash2, Zap
} from 'lucide-react';

interface Props {
  device: NeiryDevice;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onValidate: (id: string) => void;
  onRemove: (id: string) => void;
  onExport: (id: string) => string;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const stateColors: Record<NeiryDevice['state'], string> = {
  disconnected: 'bg-gray-400', connecting: 'bg-amber-400', connected: 'bg-green-500',
  disconnecting: 'bg-orange-400', error: 'bg-red-500',
};

function DeviceCardInner({ device, onConnect, onDisconnect, onStart, onStop, onValidate, onRemove, onExport, isSelected, onSelect }: Props) {
  const [validating, setValidating] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const handleValidate = useCallback(async () => {
    setValidating(true); await onValidate(device.id); setValidating(false);
  }, [onValidate, device.id]);

  const handleExport = useCallback(() => {
    const csv = onExport(device.id);
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eeg_${device.name.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [onExport, device.name, device.id]);

  const connected = device.state === 'connected';
  const canConnect = device.state === 'disconnected' || device.state === 'error';
  const canStart = connected && !device.isStreaming;
  const canStop = device.isStreaming;

  return (
    <Card
      className={`transition-all cursor-pointer bg-white border-slate-200 shadow-sm hover:shadow-md ${isSelected ? 'ring-2 ring-blue-500 border-blue-300' : ''} ${device.isStreaming ? 'border-blue-400 shadow-md shadow-blue-100' : ''}`}
      onClick={() => onSelect(device.id)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${stateColors[device.state]}`} />
            <CardTitle className="text-base text-slate-900">{device.name}</CardTitle>
            <Badge variant="outline" className="text-xs bg-slate-50">{device.deviceType}</Badge>
          </div>
          {device.isStreaming && (
            <Badge className="bg-blue-500 text-white animate-pulse"><Activity className="w-3 h-3 mr-1" /> STREAM</Badge>
          )}
        </div>
        <div className="text-xs text-slate-400">{device.address.slice(0, 24)}...</div>
      </CardHeader>

      <CardContent className="space-y-3">
        {device.batteryLevel !== null && (
          <div className="flex items-center gap-2 text-sm">
            <Battery className={`w-4 h-4 ${device.batteryLevel > 20 ? 'text-green-600' : 'text-red-500'}`} />
            <Progress value={device.batteryLevel} className="h-2 flex-1" />
            <span className="text-xs w-10 text-right text-slate-600">{device.batteryLevel}%</span>
          </div>
        )}

        {connected && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-50 rounded p-2 border border-slate-100">
              <div className="text-slate-500">Packets</div>
              <div className="font-mono font-bold text-lg text-slate-900">{device.stats.packetsReceived}</div>
            </div>
            <div className="bg-slate-50 rounded p-2 border border-slate-100">
              <div className="text-slate-500">Loss</div>
              <div className={`font-mono font-bold text-lg ${device.stats.packetLossPercent > 1 ? 'text-red-600' : 'text-green-600'}`}>
                {device.stats.packetLossPercent.toFixed(1)}%
              </div>
            </div>
            <div className="bg-slate-50 rounded p-2 border border-slate-100">
              <div className="text-slate-500">Rate</div>
              <div className="font-mono font-bold text-slate-900">{device.stats.effectiveSampleRate.toFixed(0)} Hz</div>
            </div>
            <div className="bg-slate-50 rounded p-2 border border-slate-100">
              <div className="text-slate-500">Buffer</div>
              <div className="font-mono font-bold text-slate-900">{device.eegBuffer.length}</div>
            </div>
          </div>
        )}

        {device.validationResult && (
          <div className="flex gap-1 flex-wrap text-xs">
            {Object.entries(device.validationResult.characteristicsFound).map(([name, found]) => (
              <Badge key={name} variant={found ? 'default' : 'destructive'} className="text-[10px]">{found ? '✓' : '✗'} {name}</Badge>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {canConnect && <Button size="sm" onClick={(e) => { e.stopPropagation(); onConnect(device.id); }}><Zap className="w-3 h-3 mr-1" /> Connect</Button>}
          {connected && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onDisconnect(device.id); }}><CircleOff className="w-3 h-3 mr-1" /> Disconnect</Button>}
          {canStart && <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={(e) => { e.stopPropagation(); onStart(device.id); }}><Play className="w-3 h-3 mr-1" /> Start</Button>}
          {canStop && <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); onStop(device.id); }}><Square className="w-3 h-3 mr-1" /> Stop</Button>}
          {connected && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleValidate(); }} disabled={validating}><Scan className="w-3 h-3 mr-1" /> {validating ? '...' : 'Validate'}</Button>}
          {device.eegBuffer.length > 0 && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); handleExport(); }}><Signal className="w-3 h-3 mr-1" /> Export</Button>}
          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); onRemove(device.id); }}><Trash2 className="w-3 h-3" /></Button>
        </div>

        {device.log.length > 0 && (
          <>
            <Button size="sm" variant="ghost" className="text-xs w-full text-slate-500 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); setShowLog(!showLog); }}>
              {showLog ? 'Hide' : 'Show'} Log ({device.log.length})
            </Button>
            {showLog && (
              <div className="bg-slate-50 rounded p-2 text-[10px] font-mono max-h-32 overflow-y-auto space-y-0.5 border border-slate-100">
                {device.log.slice(-20).map((entry, i) => (
                  <div key={i} className={entry.level === 'error' ? 'text-red-600' : entry.level === 'success' ? 'text-green-600' : 'text-slate-600'}>
                    [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.message}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default memo(DeviceCardInner, (prev, next) => {
  const d1 = prev.device, d2 = next.device;
  return (
    d1.id === d2.id && d1.state === d2.state && d1.isStreaming === d2.isStreaming &&
    d1.batteryLevel === d2.batteryLevel && d1.stats.packetsReceived === d2.stats.packetsReceived &&
    d1.stats.packetLossPercent === d2.stats.packetLossPercent && d1.eegBuffer.length === d2.eegBuffer.length &&
    d1.log.length === d2.log.length && prev.isSelected === next.isSelected
  );
});
