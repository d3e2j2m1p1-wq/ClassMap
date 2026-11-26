// Built-in palettes — all made for ClassMap Pixel (none copied from other apps)
import { hsvToRgb, rgbaToHex } from './color.js';

// Ramps that shift hue as they darken (cooler shadows, warmer highlights), as pixel artists do
function ramps() {
  const out = ['#1a1423', '#3d3645', '#6e6577', '#a59cab', '#d9d2da', '#ffffff'];
  for (const h of [355, 22, 45, 95, 160, 195, 225, 270, 320, 28]) {
    const brown = h === 28;
    const shades = brown ? [[0.55, 0.32], [0.5, 0.55], [0.38, 0.78]] : [[0.78, 0.42], [0.72, 0.78], [0.42, 0.98]];
    shades.forEach(([s, v], i) => out.push(rgbaToHex(hsvToRgb(h + (1 - i) * 12, s, v))));
  }
  return out;
}

export const BUILT_IN = [
  { name: 'ClassMap', colors: ['#2b1d1a', '#5a4740', '#8a746a', '#cfbc9b', '#f7efdf', '#fff8ec', '#08525f', '#0e8a9e', '#7fd0dc', '#3fe0d0', '#d93f4c', '#f25f6b', '#f8b4be', '#b86e0c', '#f5b544', '#ffd66b', '#1c8c5e', '#4fd69c', '#6e4fc0', '#b9a3ff'] },
  { name: 'Schoolyard 36', colors: ramps() },
  { name: 'Lake at night', colors: ['#0a2233', '#0e3445', '#1b4656', '#1f4442', '#2a7482', '#4fb3c4', '#7fd0dc', '#ddf5ef', '#fff3cf', '#ffd66b', '#ffd39c', '#f2876e', '#e58a74', '#8acb9f'] },
  { name: 'Four greens', colors: ['#0f2a1b', '#2f5a32', '#6b9a3b', '#c8d97a'] },
  { name: 'Grayscale 8', colors: ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff'] },
];
