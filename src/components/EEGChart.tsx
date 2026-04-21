import { useRef, useEffect, memo } from 'react';
import type { NeiryDevice } from '@/types/bluetooth';

interface Props { device: NeiryDevice | null; }

// Darker colors for visibility on light background
const COLORS = ['#15803d', '#0369a1', '#7c3aed', '#b45309'];
const MAX_POINTS = 400;
const CANVAS_HEIGHT = 250;

const EEGChart = memo(function EEGChart({ device }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dataRef = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    if (!device) return;
    const map = new Map<string, number[]>();
    for (const pt of device.eegBuffer) {
      if (!map.has(pt.channel)) map.set(pt.channel, []);
      map.get(pt.channel)!.push(pt.value);
    }
    for (const [ch, arr] of map) {
      if (arr.length > MAX_POINTS) map.set(ch, arr.slice(-MAX_POINTS));
    }
    dataRef.current = map;
  }, [device?.eegBuffer.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const channels = device?.settings.channels || [];
      const height = Math.max(CANVAS_HEIGHT, channels.length * 60 + 30);

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Light background
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);

      if (!device || channels.length === 0) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Select a connected device to view EEG', width / 2, height / 2);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Grid lines (light)
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < width; x += 50) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, height); ctx.stroke(); }

      // Stats bar
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, 0, width, 20);
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `${device.name} | Pkts:${device.stats.packetsReceived} Loss:${device.stats.packetLossPercent.toFixed(1)}% Rate:${device.stats.effectiveSampleRate.toFixed(0)}Hz`,
        5, 14
      );

      const chHeight = (height - 25) / channels.length;
      const data = dataRef.current;

      channels.forEach((ch, i) => {
        const arr = data.get(ch) || [];
        const yBase = i * chHeight + chHeight / 2 + 22;
        const color = COLORS[i % COLORS.length];

        // Label
        ctx.fillStyle = color;
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(ch, 5, yBase - chHeight / 2 + 12);

        // Baseline
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(30, yBase); ctx.lineTo(width, yBase); ctx.stroke();

        if (arr.length < 2) return;

        const recent = arr.slice(-150);
        const maxAmp = Math.max(...recent.map(Math.abs), 10);
        const scale = (chHeight * 0.35) / maxAmp;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const step = (width - 35) / Math.min(arr.length, MAX_POINTS);
        const startIdx = Math.max(0, arr.length - MAX_POINTS);
        for (let j = startIdx; j < arr.length; j++) {
          const x = 30 + (j - startIdx) * step;
          const y = yBase - arr[j] * scale;
          if (j === startIdx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${arr[arr.length - 1].toFixed(1)} uV`, width - 5, yBase - chHeight / 2 + 12);
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [device?.id]);

  return (
    <div className="w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shadow-sm">
      <canvas ref={canvasRef} style={{ width: '100%', height: `${CANVAS_HEIGHT}px` }} />
    </div>
  );
});

export default EEGChart;
