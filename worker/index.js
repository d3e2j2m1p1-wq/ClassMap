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
