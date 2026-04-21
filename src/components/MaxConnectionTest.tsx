import { useState, useCallback, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Layers, TestTube, Zap, Smartphone } from 'lucide-react';

interface Props { deviceCount: number; connectedCount: number; onTest: () => Promise<{ attempted: number; connected: number; errors: string[] }>; }

const MaxConnectionTest = memo(function MaxConnectionTest({ deviceCount, connectedCount, onTest }: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ attempted: number; connected: number; errors: string[] } | null>(null);
  const [history, setHistory] = useState<{ count: number; time: string }[]>([]);

  const handleTest = useCallback(async () => {
    setTesting(true); setResult(null);
    try {
      const res = await onTest();
      setResult(res);
      if (res.connected > 0) setHistory((p) => [...p, { count: res.connected, time: new Date().toLocaleTimeString() }].slice(-10));
    } catch (e: unknown) { setResult({ attempted: 0, connected: 0, errors: ['Test failed: ' + (e instanceof Error ? e.message : String(e))] }); }
    finally { setTesting(false); }
  }, [onTest]);

  return (
    <Card className="bg-white border-slate-200 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 text-slate-700"><TestTube className="w-4 h-4" />Max Connection Test</CardTitle>
          <Badge variant="outline" className="text-xs bg-white"><Smartphone className="w-3 h-3 mr-1" />Phone BT Limit</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">Paired: {deviceCount}</span>
          <span className={connectedCount > 0 ? 'text-green-700 font-bold' : 'text-slate-700'}>Connected: {connectedCount}</span>
        </div>
        <Progress value={deviceCount > 0 ? (connectedCount / deviceCount) * 100 : 0} className="h-2" />
        <div className="text-xs text-slate-500">Typical BLE limits: Android 3-7, iOS 2-5 connections</div>
        <Button size="sm" className="w-full" onClick={handleTest} disabled={testing || deviceCount === 0}>
          {testing ? <><Zap className="w-4 h-4 mr-2 animate-pulse" /> Testing...</> : <><Layers className="w-4 h-4 mr-2" /> Connect All & Test Limit</>}
        </Button>
        {result && (
          <Alert className={result.connected > 0 ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}>
            <AlertDescription className="text-xs space-y-1">
              <div className="font-bold text-slate-900">Connected: {result.connected} / {result.attempted} attempted</div>
              {result.errors.length > 0 && <div className="text-red-600">{result.errors.slice(0, 3).map((e, i) => (<div key={i}>• {e}</div>))}{result.errors.length > 3 && <div>+{result.errors.length - 3} more</div>}</div>}
            </AlertDescription>
          </Alert>
        )}
        {history.length > 0 && (
          <div className="text-xs space-y-0.5">
            <div className="text-slate-500 font-semibold">History:</div>
            {history.map((h, i) => (<div key={i} className="flex justify-between"><span className="text-slate-500">{h.time}</span><span className="text-green-700 font-bold">{h.count} connected</span></div>))}
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default MaxConnectionTest;
