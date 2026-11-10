// Local stand-in for the Supabase API gateway, used only by the integration tests.
//   /rest/v1/*    -> PostgREST (the same data API Supabase runs)
//   /auth/v1/*    -> minimal email + password sign-in that issues Supabase-style JWTs
//   /storage/v1/* -> in-memory image storage for the theme uploader
// Start: node supabase/test/local-gateway.mjs   (env: PGRST_URL, JWT_SECRET, PORT)
import http from 'node:http';
import crypto from 'node:crypto';

const PGRST = process.env.PGRST_URL || 'http://127.0.0.1:3001';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-local-test-secret-123456';
const PORT = Number(process.env.PORT || 54321);
const USERS = {
  'therapist@example.test': {id: '11111111-1111-1111-1111-111111111111', password: 'therapist-pass-123'},
  'helper@example.test':    {id: '22222222-2222-2222-2222-222222222222', password: 'helper-pass-123'},
  'parent@example.test':    {id: '33333333-3333-3333-3333-333333333333', password: 'parent-pass-123'},
};
const files = new Map();
// MFA (authenticator app codes): factors per user id, and open challenges. Cleared by POST /test/reset.
const factors = new Map(), challenges = new Map();
const userFactors = id => factors.get(id) || [];
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32decode = s => { let bits = '', out = []; for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
function totp(secret, step){
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const totpOk = (secret, code) => { const t = Math.floor(Date.now() / 30000); return [-1, 0, 1].some(d => totp(secret, t + d) === String(code)); };

const b64u = b => Buffer.from(b).toString('base64url');
function sign(payload){
  const h = b64u(JSON.stringify({alg: 'HS256', typ: 'JWT'})), p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verify(tok){
  const [h, p, sig] = String(tok || '').split('.');
  if (!sig || crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== sig) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url')); return c.exp > Date.now()/1000 ? c : null;
}
function userObj(email){
  const u = USERS[email];
  return {id: u.id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {provider: 'email'}, user_metadata: {}, created_at: new Date().toISOString(),
    factors: userFactors(u.id).map(({secret, ...f}) => f)};
}
function session(email, aal = 'aal1'){
  const u = USERS[email], now = Math.floor(Date.now()/1000);
  const amr = [{method: 'password', timestamp: now}].concat(aal === 'aal2' ? [{method: 'totp', timestamp: now}] : []);
  return {access_token: sign({sub: u.id, role: 'authenticated', aud: 'authenticated', email, aal, amr, iat: now, exp: now + 3600}), token_type: 'bearer',
    expires_in: 3600, expires_at: now + 3600, refresh_token: b64u(email + '|' + aal), user: userObj(email)};
}
const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const send = (res, code, obj, type = 'application/json') => { res.writeHead(code, {'content-type': type}); res.end(type === 'application/json' ? JSON.stringify(obj) : obj); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), path = url.pathname;
  try {
    if (path.startsWith('/auth/v1/')){
      if (path === '/auth/v1/token'){
        const b = JSON.parse((await body(req)).toString() || '{}');
        if (url.searchParams.get('grant_type') === 'password'){
          const u = USERS[b.email]; if (!u || u.password !== b.password) return send(res, 400, {error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials'});
          return send(res, 200, session(b.email));
        }
        if (url.searchParams.get('grant_type') === 'refresh_token'){ const [email, aal] = Buffer.from(b.refresh_token || '', 'base64url').toString().split('|'); return USERS[email] ? send(res, 200, session(email, aal)) : send(res, 400, {error: 'invalid_grant'}); }
      }
      const claims = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (path === '/auth/v1/user') return claims ? send(res, 200, userObj(claims.email)) : send(res, 401, {msg: 'invalid JWT'});
      if (path === '/auth/v1/factors' && req.method === 'POST'){
        if (!claims) return send(res, 401, {msg: 'invalid JWT'});
        const b = JSON.parse((await body(req)).toString() || '{}'), list = userFactors(claims.sub);
        if (list.some(f => f.friendly_name === b.friendly_name)) return send(res, 422, {code: 'mfa_factor_name_conflict', msg: 'A factor with this friendly name already exists'});
        const secret = Array.from(crypto.randomBytes(20), x => B32[x & 31]).join(''), id = crypto.randomUUID(), now = new Date().toISOString();
        factors.set(claims.sub, list.concat({id, friendly_name: b.friendly_name, factor_type: 'totp', status: 'unverified', created_at: now, updated_at: now, secret}));
        const uri = `otpauth://totp/${encodeURIComponent(b.issuer || 'local')}:${encodeURIComponent(claims.email)}?secret=${secret}&issuer=${encodeURIComponent(b.issuer || 'local')}`;
        return send(res, 200, {id, type: 'totp', friendly_name: b.friendly_name, totp: {qr_code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000000"/></svg>', secret, uri}});
      }
      const fm = path.match(/^\/auth\/v1\/factors\/([^/]+)(\/challenge|\/verify)?$/);
      if (fm){
        if (!claims) return send(res, 401, {msg: 'invalid JWT'});
        const list = userFactors(claims.sub), f = list.find(x => x.id === fm[1]);
        if (!f) return send(res, 404, {code: 'mfa_factor_not_found', msg: 'Factor not found'});
        if (!fm[2] && req.method === 'DELETE'){ factors.set(claims.sub, list.filter(x => x !== f)); return send(res, 200, {id: f.id}); }
        if (fm[2] === '/challenge'){ const id = crypto.randomUUID(); challenges.set(id, f.id); return send(res, 200, {id, type: 'totp', expires_at: Math.floor(Date.now()/1000) + 300}); }
        if (fm[2] === '/verify'){
          const b = JSON.parse((await body(req)).toString() || '{}');
          if (challenges.get(b.challenge_id) !== f.id) return send(res, 422, {code: 'mfa_challenge_expired', msg: 'Challenge not found'});
          if (!totpOk(f.secret, b.code)) return send(res, 422, {code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered'});
          challenges.delete(b.challenge_id); f.status = 'verified';
          return send(res, 200, session(claims.email, 'aal2'));
        }
      }
      if (path === '/auth/v1/logout'){ res.writeHead(204); return res.end(); }
      if (path === '/auth/v1/recover') return send(res, 200, {});
      return send(res, 404, {msg: 'not implemented'});
    }
    if (path === '/test/reset' && req.method === 'POST'){ factors.clear(); challenges.clear(); return send(res, 200, {}); }
    if (path === '/test/totp'){ // test helper: the current code for a user's newest factor (local stand-in only)
      const u = USERS[url.searchParams.get('email')], f = u && userFactors(u.id).at(-1);
      return f ? send(res, 200, {code: totp(f.secret, Math.floor(Date.now() / 30000))}) : send(res, 404, {});
    }
    if (path.startsWith('/storage/v1/')){
      const pub = path.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
      if (pub && req.method === 'GET'){ const f = files.get(pub[1] + '/' + pub[2]); if (!f) return send(res, 404, {}); res.writeHead(200, {'content-type': f.type}); return res.end(f.data); }
      const auth = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
      const up = path.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
      if (up && req.method === 'POST'){ if (!auth) return send(res, 403, {message: 'not allowed'}); files.set(up[1] + '/' + up[2], {type: req.headers['content-type'], data: await body(req)}); return send(res, 200, {Key: up[1] + '/' + up[2]}); }
      const del = path.match(/^\/storage\/v1\/object\/([^/]+)$/);
      if (del && req.method === 'DELETE'){ if (!auth) return send(res, 403, {}); const b = JSON.parse((await body(req)).toString() || '{}'); for (const p of b.prefixes || []) files.delete(del[1] + '/' + p); return send(res, 200, []); }
      return send(res, 404, {});
    }
    if (path.startsWith('/rest/v1/')){
      const headers = {...req.headers}; delete headers.host; delete headers.apikey; delete headers['content-length'];
      if (!/^Bearer [^.]+\.[^.]+\.[^.]+$/.test(headers.authorization || '')) delete headers.authorization; // publishable key -> anonymous, like Supabase
      const r = await fetch(PGRST + path.slice('/rest/v1'.length) + url.search, {method: req.method, headers, body: ['GET','HEAD'].includes(req.method) ? undefined : await body(req)});
      const out = Buffer.from(await r.arrayBuffer()), h = {};
      for (const k of ['content-type', 'content-range', 'preference-applied']) if (r.headers.get(k)) h[k] = r.headers.get(k);
      res.writeHead(r.status, h); return res.end(out);
    }
    send(res, 404, {});
  } catch (e) { send(res, 500, {message: String(e)}); }
}).listen(PORT, '127.0.0.1', () => console.log('gateway on', PORT));
