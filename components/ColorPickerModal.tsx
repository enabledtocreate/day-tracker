'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';

/** Random color visible on schedule background: HSL with S 50-75%, L 40-55% */
export function randomScheduleFriendlyColor(): string {
  const h = Math.floor(Math.random() * 360);
  const s = 50 + Math.floor(Math.random() * 26);
  const l = 40 + Math.floor(Math.random() * 16);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Convert hsl( H, S%, L% ) to #rrggbb for input[type=color] */
function hslToHex(hsl: string): string {
  const m = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!m) return '#888888';
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  let r: number; let g: number; let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 'hsl(200, 60%, 50%)';
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0; let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  value: string;
  onSelect: (color: string) => void;
};

export function ColorPickerModal({ open, onClose, value, onSelect }: Props) {
  const initialHex = value ? (value.startsWith('#') ? value : hslToHex(value)) : '#708090';
  const [hex, setHex] = useState(initialHex);

  useEffect(() => {
    setHex(value ? (value.startsWith('#') ? value : hslToHex(value)) : '#708090');
  }, [open, value]);

  const handleRandom = () => {
    const hsl = randomScheduleFriendlyColor();
    setHex(hslToHex(hsl));
  };

  const handleApply = () => {
    const hsl = hex.startsWith('hsl') ? hex : hexToHsl(hex);
    onSelect(hsl);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose color"
      actions={
        <>
          <Button onClick={handleApply}>Apply</Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <input
            type="color"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            style={{ width: 56, height: 36, padding: 0, border: '1px solid var(--border)', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{hex}</span>
        </div>
        <Button onClick={handleRandom}>Random (schedule-visible)</Button>
      </div>
    </Modal>
  );
}
