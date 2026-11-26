// ═══════════════════════════════════════════════
//  Pencil, finger, mouse and keyboard on the canvas.
//   • Pencil / mouse draw. Fingers draw too, until a pencil is used ("auto"), then they navigate.
//   • Two fingers: pan and pinch. Quick taps: 2 fingers = undo, 3 = redo, 4 = hide the panels.
//     Holding 2 or 3 fingers still repeats undo / redo. A quick pinch in fits the canvas.
//   • Long press while drawing = eye dropper. Palm touches are ignored while the pencil is down.
//   • Drag the round symmetry handle to move the centre.
// ═══════════════════════════════════════════════
import { state, emit, fingersDraw, store, saveSettings } from './state.js';
import { TOOLS } from './tools.js';
import { actionFor } from './keymap.js';
import { symCenter } from './symmetry.js';

const TAP_MS = 280, TAP_MOVE = 12, HOLD_MS = 550, LONG_MOVE = 5;

export function initInput(view, actions) {
  const el = view.stage;
  const pts = new Map();          // pointerId → { x, y, x0, y0, type }
  let mode = null;                // 'draw' | 'pan' | 'gesture' | 'sym'
  let drawId = null, drawType = null, drawStart = 0, tool = null;
  let g = null;                   // gesture in progress
  let longT = 0, holdT = 0, repeatT = 0;
  let spaceDown = false, altDown = false;

  const toolNow = () => TOOLS[state.tool];
  const pointFrom = e => {
    const [fx, fy] = view.toSprite(e.clientX, e.clientY);
    const [sx, sy] = view.local(e.clientX, e.clientY);
    return {
      fx, fy, x: Math.floor(fx), y: Math.floor(fy), sx, sy, touch: e.pointerType === 'touch',
      pressure: e.pointerType === 'pen' ? (e.pressure || 0.5) : null,
      shift: e.shiftKey, alt: e.altKey, secondary: e.button === 2 || (e.buttons & 2) === 2,
    };
  };

  const setHover = e => {
    if (!e) { view.hover = null; emit('cursor', null); view.request(); return; }
    const p = pointFrom(e);
    view.hover = [p.x, p.y];
    emit('cursor', p);
    if (state.tool === 'select' && view.selPreview?.kind === 'polygon') TOOLS.select.move(p);
    view.request();
  };

  // ── drawing ──
  function startDraw(e) {
    mode = 'draw'; drawId = e.pointerId; drawType = e.pointerType; drawStart = performance.now();
    tool = toolNow();
    const p = pointFrom(e);
    p.secondary = e.button === 2;
    tool.down(p);
    view.hover = null;
    if (state.settings.longPress && e.pointerType !== 'mouse' && ['brush', 'eraser', 'line', 'shape'].includes(state.tool)) {
      longT = setTimeout(() => {
        const q = pts.get(drawId);
        if (mode !== 'draw' || !q || Math.hypot(q.x - q.x0, q.y - q.y0) > LONG_MOVE) return;
        tool.cancel();                                  // forget the dot the press made
        state.tempTool = 'dropper'; emit('tool');
        tool = TOOLS.dropper;
        tool.down(pointFrom({ clientX: q.x, clientY: q.y, pointerType: drawType, button: 0, buttons: 1 }));
      }, state.settings.longPressMs || 480);
    }
  }
  function moveDraw(e) {
    const evs = e.getCoalescedEvents?.() || [];
    for (const ev of (evs.length ? evs : [e])) tool.move(pointFrom(ev));
  }
  function endDraw(cancel, e) {
    clearTimeout(longT);
    if (cancel) tool.cancel(); else tool.up(e ? pointFrom(e) : null);
    if (tool === TOOLS.dropper && state.tempTool === 'dropper' && !altDown) { state.tempTool = null; emit('tool'); }
    mode = null; drawId = null; tool = null;
  }

  // ── two-or-more-finger gestures ──
  const touchCount = () => [...pts.values()].filter(p => p.type === 'touch').length;
  const centroid = () => {
    const a = [...pts.values()].filter(p => p.type === 'touch').slice(0, 2);
    const [x, y] = view.local((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
    return { x, y, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1 };
  };
  function startGesture() {
    if (mode === 'draw') {
      // a second finger right after the first one began a stroke: it was a gesture, not a dot
      if (drawType === 'touch' && performance.now() - drawStart < 300) endDraw(true);
      else return;
    }
    mode = 'gesture';
    const c = centroid();
    g = { t0: performance.now(), max: touchCount(), moved: 0, c0: c, last: c, z0: view.zoom, held: false };
    clearTimeout(holdT);
    if (state.settings.undoGestures === false) return;
    holdT = setTimeout(() => {
      if (!g || g.moved > TAP_MOVE) return;
      g.held = true;
      const act = g.max >= 3 ? actions.redo : actions.undo;
      act();
      repeatT = setInterval(act, 130);
    }, HOLD_MS);
  }
  function moveGesture() {
    if (touchCount() < 2) return;
    const c = centroid();
    g.moved = Math.max(g.moved, Math.hypot(c.x - g.c0.x, c.y - g.c0.y), Math.abs(c.d - g.c0.d));
    if (g.moved > TAP_MOVE) { clearTimeout(holdT); clearInterval(repeatT); }
    if (g.held || g.max >= 3) { g.last = c; return; }
    view.pan(c.x - g.last.x, c.y - g.last.y);
    view.setZoom(g.z0 * c.d / g.c0.d, c.x, c.y);
    g.last = c;
  }
  function endGesture() {
    clearTimeout(holdT); clearInterval(repeatT);
    const dt = performance.now() - g.t0;
    if (!g.held && dt < TAP_MS && g.moved < TAP_MOVE) {
      if (g.max === 2 && state.settings.undoGestures !== false) actions.undo();
      else if (g.max === 3 && state.settings.undoGestures !== false) actions.redo();
      else if (g.max >= 4) actions.toggleUI();
    } else if (!g.held && dt < 320 && g.last.d / g.c0.d < 0.7) {
      view.fit();                                       // quick pinch in
    } else if (g.max === 2 && g.moved > TAP_MOVE) view.settleZoom(g.last.x, g.last.y);
    g = null; mode = null;
  }

  // the symmetry centre handle
  const onSymHandle = e => {
    const c = view.symHandle(); if (!c) return false;
    const [sx, sy] = view.local(e.clientX, e.clientY);
    return Math.hypot(sx - c[0], sy - c[1]) < (e.pointerType === 'touch' ? 20 : 12);
  };
  function moveSym(e) {
    const sp = state.sprite, [fx, fy] = view.toSprite(e.clientX, e.clientY), S = state.settings.symmetry;
    S.cx = Math.max(0, Math.min(1, Math.round(fx * 2) / 2 / sp.width));
    S.cy = Math.max(0, Math.min(1, Math.round(fy * 2) / 2 / sp.height));
    view.request();
  }

  el.addEventListener('pointerdown', e => {
    if (e.target !== view.canvas) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers (tests) */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, type: e.pointerType });
    actions.closePopovers();

    if (e.pointerType === 'pen' && !state.sawPen) { state.sawPen = true; store('pixel:sawPen', true); }
    if (e.pointerType === 'touch') {
      if (mode === 'draw' && drawType === 'pen') return;           // palm while drawing
      const n = touchCount();
      if (n >= 2) { if (mode !== 'gesture') startGesture(); else g.max = Math.max(g.max, n); return; }
    }
    if (mode === 'gesture') return;
    if (e.pointerType === 'pen' && mode === 'draw' && drawType === 'touch') endDraw(true);  // the pencil wins over a finger
    if (onSymHandle(e) && (e.pointerType !== 'touch' || fingersDraw())) { mode = 'sym'; drawId = e.pointerId; return; }
    if (e.pointerType === 'touch') {
      if (fingersDraw()) startDraw(e); else { mode = 'pan'; drawId = e.pointerId; }
      return;
    }
    if (e.pointerType === 'mouse' && (e.button === 1 || spaceDown)) { mode = 'pan'; drawId = e.pointerId; return; }
    if (e.pointerType === 'pen' || e.button === 0 || e.button === 2) startDraw(e);
  });

  el.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId);
    const dx = p ? e.clientX - p.x : 0, dy = p ? e.clientY - p.y : 0;
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (mode === 'draw' && e.pointerId === drawId) { moveDraw(e); emit('cursor', pointFrom(e)); return; }
    if (mode === 'pan' && e.pointerId === drawId) { view.pan(dx, dy); return; }
    if (mode === 'sym' && e.pointerId === drawId) { moveSym(e); return; }
    if (mode === 'gesture') { moveGesture(); return; }
    if (!p && (e.pointerType === 'mouse' || e.pointerType === 'pen')) setHover(e);  // hovering
  });

  const lift = e => {
    if (!pts.has(e.pointerId)) return;
    if (mode === 'draw' && e.pointerId === drawId) endDraw(e.type === 'pointercancel', e);
    else if ((mode === 'pan' || mode === 'sym') && e.pointerId === drawId) { if (mode === 'sym') saveSettings(); mode = null; }
    pts.delete(e.pointerId);
    if (mode === 'gesture' && touchCount() === 0) endGesture();
    if (!pts.size && e.pointerType !== 'touch' && e.type !== 'pointercancel') setHover(e);
  };
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);
  el.addEventListener('pointerleave', () => { if (!pts.size) setHover(null); });
  el.addEventListener('contextmenu', e => e.preventDefault());
  for (const ev of ['gesturestart', 'gesturechange']) el.addEventListener(ev, e => e.preventDefault());
  el.addEventListener('dblclick', e => { if (state.tool === 'select' && state.opts.shape === 'polygon') { e.preventDefault(); TOOLS.select.finishPolygon(); } });

  // ── wheel / trackpad: pinch or Ctrl+wheel zooms, a mouse wheel notch zooms, two-finger scroll pans ──
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = view.local(e.clientX, e.clientY);
    const notch = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey) view.setZoom(view.zoom * Math.exp(-e.deltaY * 0.01), sx, sy);
    else if (notch) view.step(e.deltaY < 0 ? 1 : -1, sx, sy);
    else view.pan(-e.deltaX, -e.deltaY);
  }, { passive: false });

  // ── keyboard ──
  const typing = e => e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('.px-overlay');
  addEventListener('keydown', e => {
    if (!state.sprite || document.getElementById('editor').hidden || typing(e)) return;
    const k = e.key;
    if (k === ' ' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); spaceDown = true; el.classList.add('panning'); return; }
    if (k === 'Alt') { e.preventDefault(); if (!altDown && mode !== 'draw' && !state.transform) { altDown = true; state.tempTool = 'dropper'; emit('tool'); } return; }
    if (k.startsWith('Arrow') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const n = e.shiftKey ? 10 : 1, d = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[k];
      e.preventDefault(); actions.nudge(...d); return;
    }
    const id = actionFor(e);
    if (!id) return;
    if (id === 'paste' && (e.ctrlKey || e.metaKey) && k.toLowerCase() === 'v') return;   // the browser's paste event brings the clipboard
    e.preventDefault();
    actions.run(id);
  });
  addEventListener('keyup', e => {
    if (e.key === ' ') { spaceDown = false; el.classList.remove('panning'); }
    if (e.key === 'Alt' && altDown) { altDown = false; if (mode !== 'draw') { state.tempTool = null; emit('tool'); } }
  });
  addEventListener('blur', () => { spaceDown = false; if (altDown) { altDown = false; state.tempTool = null; emit('tool'); } });

  return { symCenter };
}
