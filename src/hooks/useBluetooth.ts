import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { NeiryDevice } from '@/types/bluetooth';
import { getBluetoothManager } from '@/lib/bluetooth';

export function useBluetooth() {
  const [devices, setDevices] = useState<NeiryDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const btRef = useRef(getBluetoothManager());
  const bt = btRef.current;

  // Check support once on mount
  const isSupported = useMemo(() => bt.isSupported(), [bt]);

  // Subscribe to device changes — use ref for stable callback
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  useEffect(() => {
    let mounted = true;
    bt.setOnChange((device) => {
      if (!mounted) return;
      setDevices((prev) => {
        const idx = prev.findIndex((d) => d.id === device.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = device;
          return next;
        }
        return [...prev, device];
      });
    });
    return () => { mounted = false; };
  }, [bt]);

  const scanDevice = useCallback(async () => {
    setIsScanning(true);
    try { return await bt.scanAndAdd(); }
    finally { setIsScanning(false); }
  }, [bt]);

  const connect = useCallback(async (id: string) => bt.connect(id), [bt]);
  const disconnect = useCallback(async (id: string) => bt.disconnect(id), [bt]);
  const startSignal = useCallback(async (id: string) => bt.startSignal(id), [bt]);
  const stopSignal = useCallback(async (id: string) => bt.stopSignal(id), [bt]);
  const validateProtocol = useCallback(async (id: string) => bt.validateProtocol(id), [bt]);
  const removeDevice = useCallback((id: string) => { bt.removeDevice(id); setDevices((p) => p.filter((d) => d.id !== id)); }, [bt]);
  const exportCSV = useCallback((id: string) => bt.exportCSV(id), [bt]);
  const testMaxConnections = useCallback(async () => bt.testMaxConnections(), [bt]);
  const connectAll = useCallback(async () => { for (const d of devicesRef.current) { if (d.state === 'disconnected') await bt.connect(d.id); } }, [bt]);
  const startAll = useCallback(async () => { for (const d of devicesRef.current) { if (d.state === 'connected' && !d.isStreaming) await bt.startSignal(d.id); } }, [bt]);
  const stopAll = useCallback(async () => { for (const d of devicesRef.current) { if (d.isStreaming) await bt.stopSignal(d.id); } }, [bt]);

  return useMemo(() => ({
    devices, isSupported, isScanning,
    scanDevice, connect, disconnect, startSignal, stopSignal,
    validateProtocol, removeDevice, exportCSV, testMaxConnections,
    connectAll, startAll, stopAll,
  }), [devices, isSupported, isScanning, scanDevice, connect, disconnect, startSignal, stopSignal, validateProtocol, removeDevice, exportCSV, testMaxConnections, connectAll, startAll, stopAll]);
}
