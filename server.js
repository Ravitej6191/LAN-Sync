// LAN Share - zero dependencies. Run: node server.js   (add --no-open to skip opening the browser)
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { exec } = require('child_process');

// LANSHARE_* variables exist only so the app can be tested safely (other port/folder, fake second device); normal use sets none of them.
const TEST = process.env.LANSHARE_TEST === '1';
const PORT = +process.env.LANSHARE_PORT || 3000;
const DIR = process.env.LANSHARE_DIR || path.join(__dirname, 'shared');
const MIN_FREE = +process.env.LANSHARE_MIN_FREE || 1e9;     // refuse uploads that would leave less than this free on the disk
const TICK = +process.env.LANSHARE_TICK_MS || 60e3;         // how often the auto-delete check runs
fs.mkdirSync(DIR, { recursive: true });
const P = f => path.join(DIR, f);

const qrcode = require('./qrcode.js');

// ---------- small helpers ----------
const safe = n => {
  let s = path.basename(String(n || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').replace(/[. ]+$/, '') || 'file';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s;      // Windows reserved device names
  return s;
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
// fs.rmSync(..., {force:true}) silently does nothing for some non-ASCII names on Windows, so use unlink and report failures
const rm = p => { try { fs.unlinkSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return true; console.error('could not delete:', e.code, p); return false; } };
const load = (f, def) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch (e) { return def; } };
const save = (f, v) => fs.writeFileSync(P(f), JSON.stringify(v));
const readBody = req => new Promise(ok => { const parts = []; let n = 0; req.on('data', c => { parts.push(c); n += c.length; if (n > 1e6) req.destroy(); }); req.on('end', () => ok(Buffer.concat(parts).toString('utf8'))); });
const crc32 = (buf, prev) => zlib.crc32 ? zlib.crc32(buf, prev) : slowCrc(buf, prev);
let CRC_T; function slowCrc(buf, prev = 0) { if (!CRC_T) { CRC_T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } } let c = ~prev; for (const b of buf) c = CRC_T[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; }

const MIME = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp', avif:'image/avif',
  mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', mkv:'video/x-matroska', mp3:'audio/mpeg', wav:'audio/wav', m4a:'audio/mp4', ogg:'audio/ogg', aac:'audio/aac', flac:'audio/flac',
  pdf:'application/pdf', txt:'text/plain; charset=utf-8' };

// ---------- network / devices ----------
const myIps = new Set(['127.0.0.1', '::1']);
for (const list of Object.values(os.networkInterfaces())) for (const i of list) myIps.add(i.address);
const realIp = req => (req.socket.remoteAddress || '').replace('::ffff:', '');
const clientIp = req => (TEST && req.headers['x-test-ip']) ? String(req.headers['x-test-ip']) : realIp(req);
const isHost = req => TEST ? (!req.headers['x-test-ip'] && myIps.has(realIp(req))) : myIps.has(realIp(req));
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out.sort((a, b) => /\/\/192\.168\./.test(b) - /\/\/192\.168\./.test(a));
}
// a name that keeps working when the router hands the PC a new IP (mDNS: PCNAME.local)
const hostLabel = () => os.hostname().split('.')[0].replace(/[^A-Za-z0-9-]/g, '-');
const nameUrls = () => [`http://${hostLabel()}.local:${PORT}`];

// ---------- optional HTTPS (encrypted) on a second port, using a self-signed certificate made on first run ----------
const HTTPS_PORT = +process.env.LANSHARE_HTTPS_PORT || 3443;
const CERT_DIR = process.env.LANSHARE_CERT_DIR || path.join(__dirname, 'cert');
const secureUrls = () => [...lanUrls().map(u => u.replace('http://', 'https://').replace(':' + PORT, ':' + HTTPS_PORT)), ...nameUrls().map(u => u.replace('http://', 'https://').replace(':' + PORT, ':' + HTTPS_PORT))];
function loadCert() {
  const pfx = path.join(CERT_DIR, 'lanshare.pfx'), pass = path.join(CERT_DIR, 'lanshare.pass');
  try {
    if (!fs.existsSync(pfx) && process.platform === 'win32' && !TEST) {      // Windows has the tool to make one; elsewhere HTTPS stays off
      fs.mkdirSync(CERT_DIR, { recursive: true });
      const pw = require('crypto').randomBytes(12).toString('hex'); fs.writeFileSync(pass, pw);
      const dns = ['localhost', os.hostname(), hostLabel() + '.local'].map(d => 'DNS=' + d);
      const ips = [...myIps].filter(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)).map(a => 'IPAddress=' + a);
      const ps = `$c = New-SelfSignedCertificate -Subject 'CN=LAN Share' -TextExtension @('2.5.29.17={text}${[...dns, ...ips].join('&')}') -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddYears(5) -KeyAlgorithm RSA -KeyLength 2048; ` +
        `Export-PfxCertificate -Cert $c -FilePath '${pfx}' -Password (ConvertTo-SecureString '${pw}' -AsPlainText -Force) | Out-Null; Remove-Item ('Cert:\\CurrentUser\\My\\' + $c.Thumbprint) -Force`;
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe', timeout: 30000 });
    }
    return fs.existsSync(pfx) ? { pfx: fs.readFileSync(pfx), passphrase: fs.readFileSync(pass, 'utf8').trim() } : null;
  } catch (e) { console.error('  (HTTPS not available:', String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' ').slice(0, 300) + ')'); return null; }
}
const STATIC = {
  '/manifest.webmanifest': ['app/manifest.webmanifest', 'application/manifest+json'],
  '/favicon.ico': ['app/icon-192.png', 'image/png'], '/favicon.png': ['app/icon-192.png', 'image/png'],
  '/icon-192.png': ['app/icon-192.png', 'image/png'], '/icon-512.png': ['app/icon-512.png', 'image/png'],
  '/icon-maskable.png': ['app/icon-maskable.png', 'image/png'], '/apple-touch-icon.png': ['app/apple-touch-icon.png', 'image/png'],
  '/sw.js': ['app/sw.js', 'text/javascript'],
};
const guessName = ua => {
  ua = String(ua || '');
  const o = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone'
    : /Windows/.test(ua) ? 'Windows PC' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return b ? `${o} · ${b}` : o;
};

// ---------- persisted state ----------
const settings = Object.assign({ ask: false, cleanHours: 0, pin: '' }, load('.settings.json', {}));
const pinTries = new Map();   // ip -> { n, until }  (stops guessing the 4-digit PIN)
const approved = new Set(load('.approved.json', []));
const blocked = new Map();                       // ip -> expiry (Infinity = permanent)
for (const ip of load('.blocked.json', [])) blocked.set(ip, Infinity);
const saveBlocked = () => save('.blocked.json', [...blocked].filter(([, t]) => t === Infinity).map(([ip]) => ip));
const isBlocked = ip => { const t = blocked.get(ip); if (t === undefined) return false; if (Date.now() > t) { blocked.delete(ip); return false; } return true; };
const REVOKE_MS = 10 * 60 * 1000;

let snippets = load('.snippets.json', null);
if (!snippets) {                                  // migrate the old single note
  snippets = [];
  try { const old = fs.readFileSync(P('.note.txt'), 'utf8').trim(); if (old) snippets.push({ id: 'old', text: old, time: Date.now() }); } catch (e) {}
  save('.snippets.json', snippets);
}

const seen = new Map();      // key -> { t, name, ip }
const pending = new Map();   // ip -> { t, name }

// ---------- files, folders, private sends ----------
// meta[fileName] = { folder, to, toName, from, fromName }. "to" makes a file/note visible only to the sender, that device and the PC.
let meta = load('.meta.json', {});
let folders = load('.folders.json', []);
const saveMeta = () => save('.meta.json', meta);
const saveFolders = () => save('.folders.json', folders);
const devName = id => (seen.get(id) || {}).name || (id === 'host' ? 'This PC' : 'Device');
const canSee = (m, me) => !m || !m.to || me === 'host' || m.to === me || m.from === me;
const cleanFolder = n => String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
const findFolder = n => folders.find(f => f.toLowerCase() === String(n || '').trim().toLowerCase());
const setMeta = (name, patch) => {
  const m = Object.assign({}, meta[name], patch);
  for (const k of Object.keys(m)) if (m[k] === '' || m[k] === undefined || m[k] === null) delete m[k];
  if (Object.keys(m).length) meta[name] = m; else delete meta[name];
};
const listFiles = (me) => fs.readdirSync(DIR).filter(f => !f.startsWith('.')).map(f => {
  const s = fs.statSync(P(f)), m = meta[f] || {};
  return { name: f, size: s.size, time: s.mtimeMs, folder: m.folder, to: m.to, toName: m.toName, from: m.from, fromName: m.fromName };
}).filter(f => me === undefined || canSee(f, me)).sort((a, b) => b.time - a.time);

function uniqueName(n) {
  const ext = path.extname(n), base = path.basename(n, ext);
  let c = n, i = 1;
  while (fs.existsSync(P(c)) || fs.existsSync(P('.' + c + '.part'))) c = `${base} (${i++})${ext}`;
  return c;
}

const pruneMeta = () => { let ch = false; for (const n of Object.keys(meta)) if (!fs.existsSync(P(n))) { delete meta[n]; ch = true; } if (ch) saveMeta(); };
setInterval(() => {                               // auto-clean
  if (!settings.cleanHours) return;
  const cutoff = Date.now() - settings.cleanHours * (TEST ? 1000 : 3600e3);
  for (const f of listFiles()) if (f.time < cutoff) { rm(P(f.name)); delete meta[f.name]; }
  saveMeta();
}, TICK);
setInterval(() => {                               // drop abandoned half-uploads after 24 h
  for (const f of fs.readdirSync(DIR)) if (f.startsWith('.up-') && f.endsWith('.part') && Date.now() - fs.statSync(P(f)).mtimeMs > 864e5) rm(P(f));
}, 3600e3);

const crcOf = f => new Promise((ok, bad) => { let c = 0; fs.createReadStream(f).on('data', d => c = crc32(d, c)).on('end', () => ok(c >>> 0)).on('error', bad); });
const dosDT = d => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });
const pipeFile = (f, res) => new Promise((ok, bad) => { const s = fs.createReadStream(f); s.on('end', ok).on('error', bad); s.pipe(res, { end: false }); });
async function sendZip(res, names) {
  const ents = [];
  for (const raw of names) {
    const n = safe(raw), f = P(n);
    if (!fs.existsSync(f)) continue;
    const st = fs.statSync(f);
    ents.push({ n, f, size: st.size, crc: await crcOf(f), ...dosDT(st.mtime), nb: Buffer.from(n, 'utf8') });
  }
  if (!ents.length) return json(res, 404, { ok: false });
  // ZIP64 is used only when needed (any file or the archive reaching 4 GB), so small zips stay maximally compatible.
  const sum = ents.reduce((s, e) => s + e.size, 0);
  const z64 = process.env.LANSHARE_ZIP64 === '1' || ents.some(e => e.size >= 0xFFFFFFFF) || sum + ents.length * 400 >= 0xFFFFFFF0 || ents.length >= 0xFFFF;
  const LX = z64 ? 20 : 0, CX = z64 ? 28 : 0;
  let off = 0, cdSize = 0;
  for (const e of ents) { e.off = off; off += 30 + e.nb.length + LX + e.size; cdSize += 46 + e.nb.length + CX; }
  const tail = z64 ? 56 + 20 + 22 : 22;
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': off + cdSize + tail, 'Content-Disposition': 'attachment; filename="LAN-Share-files.zip"' });
  const big = z64 ? 0xFFFFFFFF : null;
  for (const e of ents) {
    const h = Buffer.alloc(30 + LX);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(z64 ? 45 : 20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt16LE(e.time, 10); h.writeUInt16LE(e.date, 12); h.writeUInt32LE(e.crc, 14);
    h.writeUInt32LE(z64 ? big : e.size, 18); h.writeUInt32LE(z64 ? big : e.size, 22);
    h.writeUInt16LE(e.nb.length, 26); h.writeUInt16LE(LX, 28);
    if (z64) { h.writeUInt16LE(1, 30); h.writeUInt16LE(16, 32); h.writeBigUInt64LE(BigInt(e.size), 34); h.writeBigUInt64LE(BigInt(e.size), 42); }
    // header layout: fixed 30 bytes, then the name, then the extra block -> write name between them
    res.write(h.subarray(0, 30)); res.write(e.nb); if (z64) res.write(h.subarray(30));
    await pipeFile(e.f, res);
  }
  for (const e of ents) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(z64 ? 45 : 20, 4); c.writeUInt16LE(z64 ? 45 : 20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(z64 ? big : e.size, 20); c.writeUInt32LE(z64 ? big : e.size, 24);
    c.writeUInt16LE(e.nb.length, 28); c.writeUInt16LE(CX, 30); c.writeUInt32LE(z64 ? big : e.off, 42);
    res.write(c); res.write(e.nb);
    if (z64) { const x = Buffer.alloc(28); x.writeUInt16LE(1, 0); x.writeUInt16LE(24, 2); x.writeBigUInt64LE(BigInt(e.size), 4); x.writeBigUInt64LE(BigInt(e.size), 12); x.writeBigUInt64LE(BigInt(e.off), 20); res.write(x); }
  }
  if (z64) {
    const r = Buffer.alloc(56);
    r.writeUInt32LE(0x06064b50, 0); r.writeBigUInt64LE(44n, 4); r.writeUInt16LE(45, 12); r.writeUInt16LE(45, 14);
    r.writeBigUInt64LE(BigInt(ents.length), 24); r.writeBigUInt64LE(BigInt(ents.length), 32); r.writeBigUInt64LE(BigInt(cdSize), 40); r.writeBigUInt64LE(BigInt(off), 48);
    const l = Buffer.alloc(20); l.writeUInt32LE(0x07064b50, 0); l.writeBigUInt64LE(BigInt(off + cdSize), 8); l.writeUInt32LE(1, 16);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0xFFFF, 8); end.writeUInt16LE(0xFFFF, 10); end.writeUInt32LE(0xFFFFFFFF, 12); end.writeUInt32LE(0xFFFFFFFF, 16);
    return res.end(Buffer.concat([r, l, end]));
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(ents.length, 8); end.writeUInt16LE(ents.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(off, 16);
  res.end(end);
}

// ---------- server ----------
const HOST_ONLY = ['/api/revoke', '/api/block', '/api/unblock', '/api/approve', '/api/deny', '/api/settings', '/api/clear'];

const tlsOptions = loadCert();
const handler = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    const ip = clientIp(req), host = isHost(req), meId = host ? 'host' : ip;

    // Block other websites from driving this server through the user's browser (CSRF) or via DNS rebinding.
    const hh = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    const hostOk = /^(\d{1,3}\.){3}\d{1,3}$/.test(hh) || hh === 'localhost' || hh === '[::1]' || hh === os.hostname().toLowerCase() || hh === hostLabel().toLowerCase() + '.local' || hh === hostLabel().toLowerCase()
      || (hh.endsWith('.ts.net') && hh.startsWith(hostLabel().toLowerCase() + '.'));   // Tailscale MagicDNS name of this PC
    let originOk = true; if (req.headers.origin) { try { originOk = new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch (e) { originOk = false; } }
    if (!hostOk || !originOk) return json(res, 403, { ok: false, error: 'bad origin' });

    if (!host && isBlocked(ip)) {
      if (p.startsWith('/api/') || p.startsWith('/files/')) return json(res, 403, { ok: false, blocked: true });
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:18px system-ui;background:#0b1020;color:#eef2ff;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h1>Access removed</h1><p style="color:#8b97b8">The owner of this PC has disconnected this device.</p></div>');
    }

    // static
    if (req.method === 'GET' && p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res); }
    if (req.method === 'GET' && p === '/qrcode.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(path.join(__dirname, 'qrcode.js')).pipe(res); }
    if (req.method === 'GET' && p === '/api/info') return json(res, 200, { urls: lanUrls(), names: nameUrls(), secure: tlsOptions ? secureUrls() : [] });
    if (req.method === 'GET' && STATIC[p]) { res.writeHead(200, { 'Content-Type': STATIC[p][1], 'Cache-Control': 'public, max-age=3600' }); return fs.createReadStream(path.join(__dirname, STATIC[p][0])).pipe(res); }

    // host-only controls
    if (HOST_ONLY.includes(p)) {
      if (!host) return json(res, 403, { ok: false });
      if (p === '/api/settings') {
        let b = {}; try { b = JSON.parse(await readBody(req)); } catch (e) {}
        if (typeof b.ask === 'boolean') settings.ask = b.ask;
        if ([0, 1, 24, 168].includes(b.cleanHours)) settings.cleanHours = b.cleanHours;
        if (typeof b.pin === 'string' && (b.pin === '' || /^\d{4}$/.test(b.pin))) settings.pin = b.pin;
        save('.settings.json', settings); return json(res, 200, { ok: true });
      }
      if (p === '/api/clear') { for (const f of listFiles()) rm(P(f.name)); meta = {}; saveMeta(); return json(res, 200, { ok: true }); }
      const target = url.searchParams.get('ip');
      if (!target || myIps.has(target)) return json(res, 400, { ok: false });
      if (p === '/api/revoke' || p === '/api/deny') { blocked.set(target, Date.now() + REVOKE_MS); approved.delete(target); }
      if (p === '/api/block') { blocked.set(target, Infinity); approved.delete(target); }
      if (p === '/api/unblock') blocked.delete(target);
      if (p === '/api/approve') approved.add(target);
      pending.delete(target); seen.delete(target);
      save('.approved.json', [...approved]); saveBlocked();
      return json(res, 200, { ok: true });
    }

    // approval gate
    const gated = !host && settings.ask && !approved.has(ip);
    if (p === '/api/join' && req.method === 'POST') {          // a waiting device enters the 4-digit PIN
      if (!gated) return json(res, 200, { ok: true });
      const t = pinTries.get(ip) || { n: 0, until: 0 };
      if (Date.now() < t.until) return json(res, 429, { ok: false, wait: Math.ceil((t.until - Date.now()) / 1000) });
      if (settings.pin && url.searchParams.get('pin') === settings.pin) { approved.add(ip); pending.delete(ip); pinTries.delete(ip); save('.approved.json', [...approved]); return json(res, 200, { ok: true }); }
      if (++t.n >= 5) { t.n = 0; t.until = Date.now() + 60e3; }
      pinTries.set(ip, t);
      return json(res, 403, { ok: false });
    }
    if (gated && p === '/api/list') {
      pending.set(ip, { t: Date.now(), name: url.searchParams.get('n') || guessName(req.headers['user-agent']) });
      return json(res, 200, { pending: true, pin: !!settings.pin });
    }
    if (gated) return json(res, 403, { ok: false, pending: true });

    if (req.method === 'GET' && p === '/api/list') {
      const now = Date.now();
      const custom = (url.searchParams.get('n') || '').trim().slice(0, 30);
      seen.set(host ? 'host' : ip, { t: now, name: host ? (custom || 'This PC') : (custom || guessName(req.headers['user-agent'])), ip: host ? null : ip });
      for (const [k, v] of seen) if (now - v.t > 7000) seen.delete(k);
      for (const [k, v] of pending) if (now - v.t > 7000) pending.delete(k);
      const devices = [...seen].map(([k, v]) => ({ id: k, name: v.name, ip: v.ip, host: k === 'host', me: k === meId })).sort((a, b) => (b.me - a.me) || (b.host - a.host));
      pruneMeta();
      const files = listFiles(meId);
      const out = { files, snippets: snippets.filter(s => canSee(s, meId)), devices, me: meId, isHost: host, used: files.reduce((s, f) => s + f.size, 0),
        folders: folders.map(n => ({ name: n, count: files.filter(f => f.folder === n).length })) };
      if (host) {
        out.settings = settings;
        out.waiting = [...pending].map(([k, v]) => ({ ip: k, name: v.name }));
        out.blocked = [...blocked].filter(([k]) => isBlocked(k)).map(([k, t]) => ({ ip: k, permanent: t === Infinity, mins: t === Infinity ? 0 : Math.ceil((t - now) / 60000) }));
      }
      return json(res, 200, out);
    }

    if (req.method === 'PUT' && p === '/api/upload') {
      const name = uniqueName(safe(url.searchParams.get('name')));
      const tmp = P('.' + name + '.part');
      const out = fs.createWriteStream(tmp);
      req.pipe(out);
      out.on('finish', () => { fs.renameSync(tmp, P(name)); json(res, 200, { ok: true, name }); });
      out.on('error', () => { rm(tmp); json(res, 500, { ok: false }); });
      req.on('aborted', () => { out.destroy(); rm(tmp); });
      return;
    }

    // resumable chunked upload: PUT chunk at offset, GET current size, POST finish, DELETE abort
    if (p === '/api/chunk' || p === '/api/finish') {
      const id = String(url.searchParams.get('id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
      if (!id) return json(res, 400, { ok: false });
      const part = P('.up-' + id + '.part');
      const cur = () => { try { return fs.statSync(part).size; } catch (e) { return 0; } };
      if (p === '/api/chunk' && req.method === 'GET') return json(res, 200, { ok: true, size: cur() });
      if (p === '/api/chunk' && req.method === 'DELETE') { rm(part); return json(res, 200, { ok: true }); }
      if (p === '/api/chunk' && req.method === 'PUT') {
        const off = Math.max(0, +url.searchParams.get('offset') || 0);
        try {                                                  // refuse uploads that would leave the PC with < 1 GB free
          const s = fs.statfsSync(DIR), free = Number(s.bavail) * Number(s.bsize);
          if (free - (+req.headers['content-length'] || 0) < MIN_FREE) { req.resume(); return json(res, 507, { ok: false, full: true }); }
        } catch (e) {}
        if (off > 0 && cur() !== off) { req.resume(); return json(res, 409, { ok: false, size: cur() }); }
        const out = fs.createWriteStream(part, { flags: off ? 'a' : 'w' });
        req.pipe(out);
        out.on('finish', () => json(res, 200, { ok: true, size: cur() }));
        out.on('error', () => json(res, 500, { ok: false }));
        req.on('aborted', () => out.end());
        return;
      }
      if (p === '/api/finish' && req.method === 'POST') {
        const total = +url.searchParams.get('total');
        if (cur() !== total) return json(res, 409, { ok: false, size: cur() });
        const name = uniqueName(safe(url.searchParams.get('name')));
        fs.renameSync(part, P(name));
        const to = String(url.searchParams.get('to') || ''), fo = findFolder(url.searchParams.get('folder'));
        const validTo = to && to !== meId && (to === 'host' || seen.has(to) || approved.has(to) || TEST);
        setMeta(name, { folder: fo || '', to: validTo ? to : '', toName: validTo ? devName(to) : '', from: validTo ? meId : '', fromName: validTo ? devName(meId) : '' });
        saveMeta();
        return json(res, 200, { ok: true, name, private: !!validTo });
      }
    }

    if (p === '/api/snippet') {
      if (req.method === 'POST') {
        const text = (await readBody(req)).slice(0, 100000);
        if (!text.trim()) return json(res, 400, { ok: false });
        const to = String(url.searchParams.get('to') || ''), validTo = to && to !== meId && (to === 'host' || seen.has(to) || approved.has(to) || TEST);
        const sn = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, time: Date.now() };
        if (validTo) Object.assign(sn, { to, toName: devName(to), from: meId, fromName: devName(meId) });
        snippets.unshift(sn);
        snippets = snippets.slice(0, 100); save('.snippets.json', snippets);
        return json(res, 200, { ok: true, id: sn.id });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        snippets = snippets.filter(s => s.id !== id || !canSee(s, meId)); save('.snippets.json', snippets);
        return json(res, 200, { ok: true });
      }
    }

    // folders (shared by everyone) and moving files into them
    if (p === '/api/folder') {
      const name = cleanFolder(url.searchParams.get('name'));
      if (req.method === 'POST') {
        if (!name) return json(res, 400, { ok: false, error: 'name' });
        if (findFolder(name)) return json(res, 409, { ok: false, error: 'exists', name: findFolder(name) });
        if (folders.length >= 200) return json(res, 400, { ok: false, error: 'too many' });
        folders.push(name); saveFolders(); return json(res, 200, { ok: true, name });
      }
      if (req.method === 'PATCH') {                                // rename
        const old = findFolder(url.searchParams.get('name')), to = cleanFolder(url.searchParams.get('to'));
        if (!old || !to) return json(res, 400, { ok: false });
        if (findFolder(to) && findFolder(to) !== old) return json(res, 409, { ok: false, error: 'exists' });
        folders = folders.map(f => f === old ? to : f); for (const n of Object.keys(meta)) if (meta[n].folder === old) meta[n].folder = to;
        saveFolders(); saveMeta(); return json(res, 200, { ok: true, name: to });
      }
      if (req.method === 'DELETE') {                               // files go back to the top level
        const old = findFolder(url.searchParams.get('name')); if (!old) return json(res, 404, { ok: false });
        folders = folders.filter(f => f !== old); for (const n of Object.keys(meta)) if (meta[n].folder === old) setMeta(n, { folder: '' });
        saveFolders(); saveMeta(); return json(res, 200, { ok: true });
      }
    }
    if (p === '/api/move' && req.method === 'POST') {
      let b = {}; try { b = JSON.parse(await readBody(req)); } catch (e) {}
      const fo = b.folder ? findFolder(b.folder) : '';
      if (b.folder && !fo) return json(res, 404, { ok: false });
      let n = 0;
      for (const raw of Array.isArray(b.names) ? b.names.slice(0, 5000) : []) {
        const name = safe(raw);
        if (fs.existsSync(P(name)) && canSee(meta[name], meId)) { setMeta(name, { folder: fo }); n++; }
      }
      saveMeta(); return json(res, 200, { ok: true, moved: n });
    }

    const visibleNames = names => names.filter(n => canSee(meta[safe(n)], meId));
    if (p === '/api/zip' && req.method === 'GET') return sendZip(res, visibleNames(url.searchParams.getAll('n')));
    if (p === '/api/zip' && req.method === 'POST') {          // POST so hundreds of selected files don't overflow the URL
      let names = []; try { names = JSON.parse(new URLSearchParams(await readBody(req)).get('names') || '[]'); } catch (e) {}
      return sendZip(res, Array.isArray(names) ? visibleNames(names.slice(0, 5000)) : []);
    }

    if (p.startsWith('/files/')) {
      const name = safe(decodeURIComponent(p.slice(7)));
      const f = P(name);
      if (!canSee(meta[name], meId)) return json(res, 404, { ok: false });      // someone else's private file looks like it doesn't exist
      if (req.method === 'DELETE') { if (!rm(f)) return json(res, 500, { ok: false }); delete meta[name]; saveMeta(); return json(res, 200, { ok: true }); }
      if (!fs.existsSync(f)) return json(res, 404, { ok: false });
      const size = fs.statSync(f).size;
      const inline = url.searchParams.has('inline');
      const type = inline ? (MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream') : 'application/octet-stream';
      const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}` };
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');   // ranges also work for downloads, so big ones can resume
      if (m) {
        let s = m[1] === '' ? Math.max(0, size - +m[2]) : +m[1], e = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], size - 1) : size - 1;
        if (s > e || s >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 });
        return fs.createReadStream(f, { start: s, end: e }).pipe(res);
      }
      res.writeHead(200, { ...head, 'Content-Length': size });
      return fs.createReadStream(f).pipe(res);
    }
    json(res, 404, { ok: false });
  } catch (e) { if (!res.headersSent) json(res, 500, { ok: false, error: e.message }); else res.end(); }
};
if (tlsOptions) {
  https.createServer(tlsOptions, handler).on('error', e => console.error('  (HTTPS port ' + HTTPS_PORT + ' unavailable: ' + e.code + ')')).listen(HTTPS_PORT, '0.0.0.0');
}
http.createServer(handler).on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `\n  Port ${PORT} is already in use. LAN Share may already be running (check your taskbar / Task Manager for node.exe).\n` : e);
  process.exit(1);
}).listen(PORT, '0.0.0.0', () => {
  const urls = lanUrls();
  console.log('\n  LAN Share is running. Scan this QR with your phone camera (same WiFi):\n');
  if (urls[0]) { const qr = qrcode(0, 'L'); qr.addData(urls[0]); qr.make(); console.log(qr.createASCII(1, 2)); }
  console.log('  Or open one of these:\n');
  urls.forEach(u => console.log('    ' + u));
  nameUrls().forEach(u => console.log('    ' + u + '   (name-based, survives IP changes)'));
  if (tlsOptions) console.log('\n  Encrypted (HTTPS, accept the one-time browser warning):\n\n    ' + secureUrls().join('\n    '));
  console.log(`\n  Files are saved in: ${DIR}\n  Press Ctrl+C to stop.\n`);
  if (process.platform === 'win32' && !process.argv.includes('--no-open')) exec(`start "" http://localhost:${PORT}`);
});
