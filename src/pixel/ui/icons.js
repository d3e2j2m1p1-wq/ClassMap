// Hand-drawn style icons for ClassMap Pixel (our own; ink strokes in the ClassMap look)
const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  brush: svg('<path d="M4.5 19.5l1.2-4.3L15.6 5.3a2.1 2.1 0 0 1 3 0l.1.1a2.1 2.1 0 0 1 0 3L8.8 18.3z"/><path d="M13.8 7.1l3.1 3.1"/><path d="M4.5 19.5l3.9-1"/>'),
  eraser: svg('<path d="M8.6 19.5L4.2 15a1.9 1.9 0 0 1 0-2.7l8.3-8.3a1.9 1.9 0 0 1 2.7 0l4.3 4.3a1.9 1.9 0 0 1 0 2.7l-8.6 8.5z"/><path d="M8.3 8.3l7.4 7.4"/><path d="M12 19.5h8"/>'),
  line: svg('<path d="M6.5 17.5l11-11"/><rect x="3" y="17" width="4" height="4" rx="0.6" fill="currentColor" stroke="none"/><rect x="17" y="3" width="4" height="4" rx="0.6" fill="currentColor" stroke="none"/>'),
  shape: svg('<rect x="3.5" y="10.5" width="10" height="10" rx="1.6"/><circle cx="15.5" cy="8.5" r="5"/>'),
  bucket: svg('<path d="M4.5 11.5L11 5l7.5 7.5L12 19z"/><path d="M4.5 11.5h14"/><path d="M11 5L8.5 2.5"/><path d="M20.5 15.5c0 1.4-1 2.2-1 3.2a1 1 0 0 0 2 0c0-1-1-1.8-1-3.2z" fill="currentColor"/>'),
  dropper: svg('<path d="M15.2 4.2a2.4 2.4 0 0 1 3.4 0l1.2 1.2a2.4 2.4 0 0 1 0 3.4L17.6 11 13 6.4z"/><path d="M12 5.4l6.6 6.6"/><path d="M14.4 8.6L6.8 16.2 5.6 19.6l-1.1 1.1M6.8 16.2l3.4-1.2 7-7"/>'),
  undo: svg('<path d="M9 13.5L4.5 9 9 4.5"/><path d="M4.5 9h10a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="M15 13.5L19.5 9 15 4.5"/><path d="M19.5 9h-10a5.5 5.5 0 0 0 0 11H13"/>'),
  swap: svg('<path d="M7 4.5L4.5 7 7 9.5"/><path d="M4.5 7h11a4 4 0 0 1 4 4"/><path d="M17 19.5l2.5-2.5L17 14.5"/><path d="M19.5 17h-11a4 4 0 0 1-4-4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.6"/>'),
  download: svg('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  upload: svg('<path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2"/>'),
  back: svg('<path d="M14.5 5.5L8 12l6.5 6.5"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
  eye: svg('<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  grid: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>'),
  palette: svg('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-1 1.5-2.1-.5-1.3.2-2.4 1.6-2.4h1.7a3.7 3.7 0 0 0 3.7-3.7C20.5 7 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.3" r="1.2" fill="currentColor"/><circle cx="15" cy="7.6" r="1.2" fill="currentColor"/>'),
  trash: svg('<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 12.5h9l1-12.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  share: svg('<path d="M12 15V4"/><path d="M8 7.5L12 3.5l4 4"/><path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5H16"/>'),
};

export const TOOL_INFO = {
  brush: { label: 'Brush', key: 'B' },
  eraser: { label: 'Eraser', key: 'E' },
  line: { label: 'Line', key: 'L' },
  shape: { label: 'Shape', key: 'U' },
  bucket: { label: 'Color bucket', key: 'G' },
  dropper: { label: 'Eye dropper', key: 'I' },
};
