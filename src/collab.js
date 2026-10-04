// Peer-to-peer collaboration over WebRTC data channels, with no server of ours: the host makes an
// invite code, the guest answers with a reply code, and the two are exchanged by any channel
// (chat, e-mail). Once connected, notebook changes flow both ways; the host relays between
// several guests.
//
// Consistency: every cell carries a version (Lamport clock, peer id). A change is applied only if
// its version is newer than the cell's, so concurrent edits of the same cell converge to the same
// result on every peer (last writer wins, ties broken by peer id).
//
// Network: on one local network the peers' own addresses suffice. Across networks a STUN server
// is needed to discover public addresses; it is used only if the user opts in (it sees the IP
// address). Some restrictive NATs need a relay (TURN), which is not provided.

const deflate = async (text) => {
  const buf = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let bin = ''; buf.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const inflate = async (code) => {
  const bin = atob(code.trim().replace(/-/g, '+').replace(/_/g, '/'));
  const stream = new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
};

export class Collab {
  // hooks: snapshot() → notebook state with cell uids; applyOp(op) applies a remote change;
  // onStatus({ peers, role }) reports connection changes.
  constructor(hooks) {
    this.hooks = hooks;
    this.peers = new Set();          // open data channels
    this.pending = null;             // the host's connection awaiting a reply code
    this.conns = [];                 // every RTCPeerConnection, kept referenced while open
    this.role = null;
    this.id = Math.random().toString(36).slice(2, 10);
    this.clock = 0;
  }
  connection(stun) {
    const pc = new RTCPeerConnection(this.config(stun));
    this.conns.push(pc);
    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.conns = this.conns.filter(c => c !== pc);
      this.hooks.onState?.(pc.connectionState);
    });
    return pc;
  }
  config(stun) { return { iceServers: stun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [] }; }
  async gather(pc) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise(res => {
      const t = setTimeout(res, 4000);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  wire(channel) {
    channel.onopen = () => {
      this.peers.add(channel);
      if (this.role === 'host') channel.send(JSON.stringify({ t: 'state', state: this.hooks.snapshot(), clock: this.clock }));
      this.status();
    };
    channel.onclose = () => { this.peers.delete(channel); this.status(); };
    channel.onmessage = (e) => {
      let op; try { op = JSON.parse(e.data); } catch { return; }
      if (!op || typeof op !== 'object' || typeof op.t !== 'string') return;
      if (op.t === 'state' && this.role !== 'guest') return;      // only the host sends the whole notebook
      if (Number.isFinite(op.clock)) this.clock = Math.max(this.clock, op.clock);
      this.hooks.applyOp(op);
      if (this.role === 'host') for (const p of this.peers) if (p !== channel && p.readyState === 'open') p.send(e.data);      // relay to the other guests
    };
  }
  status() { this.hooks.onStatus?.({ peers: this.peers.size, role: this.role }); }

  // Host: a new invite (one per guest).
  async invite({ stun = false } = {}) {
    this.role = 'host';
    const pc = this.connection(stun);
    this.wire(pc.createDataChannel('cassycas'));
    await pc.setLocalDescription(await pc.createOffer());
    await this.gather(pc);
    this.pending = pc;
    return 'CAS1.' + await deflate(JSON.stringify({ sdp: pc.localDescription.sdp, stun }));
  }
  // Host: complete the connection with the guest's reply.
  async accept(reply) {
    if (!this.pending) throw new Error('Make an invite first.');
    const msg = JSON.parse(await inflate(reply.replace(/^CAS1R\./, '')));
    await this.pending.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    this.pending = null;
  }
  // Guest: answer an invite; returns the reply code for the host.
  async join(invite) {
    this.role = 'guest';
    const msg = JSON.parse(await inflate(invite.replace(/^CAS1\./, '')));
    const pc = this.connection(msg.stun);
    pc.ondatachannel = (e) => this.wire(e.channel);
    await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.gather(pc);
    return 'CAS1R.' + await deflate(JSON.stringify({ sdp: pc.localDescription.sdp }));
  }
  // A local change: stamp it and send it to every peer.
  stamp() { this.clock++; return [this.clock, this.id]; }
  send(op) {
    if (!this.peers.size) return;
    const data = JSON.stringify({ ...op, clock: this.clock, from: this.id });
    for (const p of this.peers) if (p.readyState === 'open') p.send(data);
  }
  get connected() { return this.peers.size > 0; }
}

// Is version a newer than version b? Versions are [clock, peer id].
export const newer = (a, b) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
