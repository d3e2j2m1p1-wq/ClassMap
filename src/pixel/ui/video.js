// ═══════════════════════════════════════════════
//  Video files (WebM, or MP4 where the browser makes it — Safari) from a list of pictures,
//  using the browser's own recorder. Recording runs in real time, so a 5-second clip takes
//  5 seconds; a progress bar shows how far along it is.
// ═══════════════════════════════════════════════

const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export function videoType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return TYPES.find(t => MediaRecorder.isTypeSupported(t)) || null;
}
export const videoExt = type => (type?.startsWith('video/mp4') ? 'mp4' : 'webm');

// frames: [{ pixels (w × h RGBA), ms }]; scale: whole-number enlargement (crisp)
// Returns a Blob. onProgress(0…1); signal (AbortSignal) stops early.
export async function recordVideo(frames, w, h, { scale = 1, onProgress, signal, background = null } = {}) {
  const type = videoType();
  if (!type) throw new Error("This browser can't make video files. Try Chrome, Edge, Firefox or Safari 14.1+.");
  // video encoders want even sizes
  const W = Math.max(2, Math.round(w * scale / 2) * 2), H = Math.max(2, Math.round(h * scale / 2) * 2);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  const src = document.createElement('canvas'); src.width = w; src.height = h;
  const sg = src.getContext('2d');
  const stream = out.captureStream(0), track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  const draw = f => {
    g.clearRect(0, 0, W, H);
    if (background) { g.fillStyle = background; g.fillRect(0, 0, W, H); }
    sg.putImageData(new ImageData(f.pixels, w, h), 0, 0);
    g.drawImage(src, 0, 0, W, H);
    track.requestFrame?.();
  };
  draw(frames[0]);
  rec.start();
  const total = frames.reduce((a, f) => a + f.ms, 0);
  let elapsed = 0;
  for (const f of frames) {
    if (signal?.aborted) break;
    draw(f);
    await new Promise(r => setTimeout(r, f.ms));
    elapsed += f.ms;
    onProgress?.(elapsed / total);
  }
  draw(frames.at(-1));
  await new Promise(r => setTimeout(r, 120));
  rec.stop();
  await stopped;
  track.stop();
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  return new Blob(chunks, { type: type.split(';')[0] });
}
