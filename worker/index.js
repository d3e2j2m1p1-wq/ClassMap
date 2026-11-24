// ═══════════════════════════════════════════════
//  ClassMap on Cloudflare
//  • Every page and file of the site is served from dist/ (static files).
//  • /api/share/<CODE> is the meeting point for "Send to another device": the sender's and the
//    receiver's browsers both connect to the same room, and the room passes their messages
//    straight from one to the other. Charts are encrypted in the browsers before they leave
//    (this code never has the key), and nothing is written anywhere: no database, no logs of
//    content. A room lasts 10 minutes at most and is gone when either side leaves.
// ═══════════════════════════════════════════════
import { DurableObject } from 'cloudflare:workers';

const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;   // no 0/O, 1/I/L
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_MESSAGE = 512 * 1024;                          // the browser sends big charts in pieces

// ── On-device AI files, served from classmap.dev ──
// The AI runs in the teacher's browser. Its files are too big to live with the site's own files
// (Cloudflare's limit is 25 MiB per file), so this Worker hands them out from classmap.dev: from the
// MODELS R2 bucket when it has them, otherwise fetched from Hugging Face / the npm CDN on the way
// through. Either way the browser only ever talks to classmap.dev, and it caches the files after
// the first download. Only these exact models and runtime files are served — this is not an open proxy.
const AI_MODELS = new Set(['onnx-community/Qwen3.5-0.8B-ONNX-OPT', 'onnx-community/Qwen3.5-2B-ONNX-OPT']);
const ORT_VERSION = '1.31.0-dev.20260914-8d85527a0';     // must match the onnxruntime-web that Transformers.js uses
const MODEL_FILE = /^\/models\/([\w.-]+\/[\w.-]+)\/resolve\/([\w.-]+)\/((?:onnx\/)?[\w.-]+)$/;
const MODEL_TREE = /^\/models\/api\/models\/([\w.-]+\/[\w.-]+)\/tree\/([\w.-]+)\/(onnx)$/;
const RUNTIME_FILE = /^\/ai-runtime\/(ort-wasm[\w.-]*\.(?:wasm|mjs))$/;

async function aiFile(request, env, url) {
  let m, upstream, key = null, immutable = false;
  if ((m = MODEL_FILE.exec(url.pathname)) && AI_MODELS.has(m[1])) {
    key = `${m[1]}/${m[2]}/${m[3]}`;
    upstream = `https://huggingface.co/${m[1]}/resolve/${m[2]}/${m[3]}`;
    immutable = /^[0-9a-f]{40}$/.test(m[2]);                 // a pinned commit never changes
  } else if ((m = MODEL_TREE.exec(url.pathname)) && AI_MODELS.has(m[1])) {
    upstream = `https://huggingface.co/api/models/${m[1]}/tree/${m[2]}/${m[3]}`;
  } else if ((m = RUNTIME_FILE.exec(url.pathname))) {
    key = `ort/${ORT_VERSION}/${m[1]}`;
    upstream = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/${m[1]}`;
    immutable = true;
  } else {
    return new Response('Not found', { status: 404 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const headers = new Headers({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' });
  // 1. our own copy, if the R2 bucket is set up and has it
  if (env.MODELS && key) {
    const obj = await env.MODELS.get(key, { range: request.headers, onlyIf: request.headers });
    if (obj) {
      obj.writeHttpMetadata(headers);
      headers.set('ETag', obj.httpEtag);
      headers.set('Accept-Ranges', 'bytes');
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
      if (obj.range && 'offset' in obj.range) {
        const end = obj.range.offset + obj.range.length - 1;
        headers.set('Content-Range', `bytes ${obj.range.offset}-${end}/${obj.size}`);
        headers.set('Content-Length', String(obj.range.length));
        return new Response(request.method === 'HEAD' ? null : obj.body, { status: 206, headers });
      }
      if (!('body' in obj)) return new Response(null, { status: 304, headers });   // browser's copy is current
      headers.set('Content-Length', String(obj.size));
      return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
    }
  }
  // 2. otherwise pass it through from the source (streamed, not stored by this code)
  const fwd = new Headers();
  ['Range', 'If-None-Match', 'If-Modified-Since'].forEach(h => { const v = request.headers.get(h); if (v) fwd.set(h, v); });
  const res = await fetch(upstream, { method: request.method, headers: fwd, redirect: 'follow', cf: { cacheEverything: true, cacheTtl: immutable ? 31536000 : 3600 } });
  const out = new Headers(headers);
  ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag', 'Last-Modified'].forEach(h => { const v = res.headers.get(h); if (v) out.set(h, v); });
  if (url.pathname.endsWith('.mjs')) out.set('Content-Type', 'text/javascript');
  if (url.pathname.endsWith('.wasm')) out.set('Content-Type', 'application/wasm');
  return new Response(res.body, { status: res.status, headers: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/share/')) {
      const code = url.pathname.slice('/api/share/'.length).toUpperCase();
      if (!CODE.test(code)) return new Response('Not found', { status: 404 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const role = url.searchParams.get('role');
      if (role !== 'send' && role !== 'recv') return new Response('Bad request', { status: 400 });
      return env.SHARE_ROOMS.get(env.SHARE_ROOMS.idFromName(code)).fetch(request);
    }
    if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/ai-runtime/')) return aiFile(request, env, url);
    return env.ASSETS.fetch(request);
  },
};

// One room per share code. Holds at most one sender and one receiver, only while they're connected.
export class ShareRoom extends DurableObject {
  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const reject = (code, why) => {
      server.accept();
      server.close(code, why);
      return new Response(null, { status: 101, webSocket: client });
    };
    const senders = this.ctx.getWebSockets('send');
    const receivers = this.ctx.getWebSockets('recv');
    if (role === 'send') {
      if (senders.length) return reject(4009, 'code in use');
    } else {
      if (!senders.length) return reject(4004, 'no such code');
      const s = senders[0].deserializeAttachment() || {};
      if (Date.now() - (s.at || 0) > MAX_AGE_MS) {
        senders.forEach(ws => ws.close(4010, 'expired'));
        return reject(4010, 'expired');
      }
      if (receivers.length) return reject(4008, 'busy');
    }
    // Hibernating WebSockets: the room costs nothing while both sides are just waiting
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, at: Date.now() });
    if (role === 'recv') this.send(senders, { t: 'joined' });
    return new Response(null, { status: 101, webSocket: client });
  }

  send(list, msg) {
    const text = JSON.stringify(msg);
    list.forEach(ws => { try { ws.send(text); } catch { /* already closed */ } });
  }

  // Pass every message to the other side, unchanged
  async webSocketMessage(ws, message) {
    const me = (ws.deserializeAttachment() || {}).role;
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > MAX_MESSAGE) { ws.close(4013, 'too big'); return; }
    if (me === 'send') {
      const at = (ws.deserializeAttachment() || {}).at || 0;
      if (Date.now() - at > MAX_AGE_MS) { this.closeAll(4010, 'expired'); return; }
    }
    const others = this.ctx.getWebSockets(me === 'send' ? 'recv' : 'send');
    others.forEach(o => { try { o.send(message); } catch { /* gone */ } });
  }

  async webSocketClose(ws, code) {
    const me = (ws.deserializeAttachment() || {}).role;
    if (me === 'send') this.closeAll(1000, 'sender left');
    else this.send(this.ctx.getWebSockets('send'), { t: 'left' });
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* closed */ }
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }

  closeAll(code, why) {
    this.ctx.getWebSockets().forEach(ws => { try { ws.close(code, why); } catch { /* closed */ } });
  }
}
