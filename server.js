const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE = process.env.TABLE || 'resultsafe-results';
const BUCKET = process.env.BUCKET || 'resultsafe-uploads-978924369107';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3 = new S3Client({ region: REGION });

// Fallback copy of the marks, used only if DynamoDB cannot be reached.
const fallback = Object.create(null);
try {
  fs.readFileSync(path.join(__dirname, 'results.csv'), 'utf8').trim().split('\n').slice(1).forEach(line => {
    const [roll, name, hash, maths, physics, networks] = line.trim().split(',');
    fallback[roll] = { name, hash, marks: { Maths: maths, Physics: physics, Networks: networks } };
  });
} catch (e) { console.error('no fallback csv', e.message); }

const ROLL_OK = /^[A-Za-z0-9]{1,10}$/; // no underscore: reserved items start with "__"
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

// ---------- look and feel ----------
const css = `
:root{--neon:#2df5c0;--ink:#f2f2f2;--mute:#77777b;--line:#232326}
*{box-sizing:border-box}
body{margin:0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#050505;color:var(--ink);min-height:100vh}
header{max-width:520px;margin:0 auto;padding:60px 20px 0}
.logo{font-size:14px;font-weight:600;letter-spacing:7px;text-transform:uppercase}
.logo i{display:none}
.tag{color:var(--mute);margin:10px 0 0;font-size:11px;letter-spacing:3px;text-transform:uppercase}
main{max-width:520px;margin:56px auto 0;padding:0 20px}
.card{animation:fade .6s ease both}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
h2{margin:0 0 8px;font-size:36px;font-weight:300;letter-spacing:-.5px}
.muted{color:var(--mute);font-size:14px;line-height:1.5}
code{color:var(--neon);font-size:13px}
form{margin-top:28px}
input{width:100%;padding:16px 0 12px;margin:6px 0 14px;border:0;border-bottom:1px solid #2e2e32;border-radius:0;background:transparent;color:var(--ink);font-size:17px;outline:none;transition:border-color .25s,box-shadow .25s}
input::placeholder{color:#55555a}
input:focus{border-bottom-color:var(--neon);box-shadow:0 1px 0 var(--neon)}
input[type=file]{font-size:14px;color:var(--mute);padding:14px 0}
button,.btn{display:block;width:100%;padding:15px;margin-top:22px;border:1px solid var(--ink);border-radius:0;font:600 12px 'Segoe UI',system-ui,sans-serif;letter-spacing:3px;text-transform:uppercase;color:var(--ink);background:transparent;cursor:pointer;text-decoration:none;text-align:center;transition:.25s}
button:hover,.btn:hover{background:var(--neon);border-color:var(--neon);color:#050505;box-shadow:0 0 22px #2df5c055}
.btn.ghost,button.ghost{border-color:#2e2e32;color:var(--mute)}
.btn.ghost:hover,button.ghost:hover{border-color:var(--neon);color:var(--neon);background:transparent;box-shadow:none}
.err{color:#ff6b86;font-size:14px;margin:16px 0 0}
.ok{color:var(--neon);font-size:14px;margin:16px 0 0;line-height:1.6}
.who{padding-bottom:26px;border-bottom:1px solid var(--line)}
.who h2{margin:0;font-size:40px}
.av{display:none}
.row{margin:28px 0}
.row .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--mute)}
.row .top span:last-child{font-size:26px;font-weight:300;letter-spacing:0;color:var(--ink)}
.bar{height:2px;background:#1b1b1e}
.bar span{display:block;height:100%;background:var(--neon);box-shadow:0 0 10px #2df5c088;animation:grow 1.1s cubic-bezier(.2,.8,.2,1) both}
@keyframes grow{from{width:0}}
.total{display:flex;justify-content:space-between;align-items:baseline;margin:36px 0 8px;padding-top:24px;border-top:1px solid var(--line);font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--mute)}
.total span:last-child{font-size:44px;font-weight:200;letter-spacing:-1px;color:var(--ink)}
.stats{display:grid;grid-template-columns:1fr 1fr;margin:30px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.stat{padding:26px 0;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--mute)}
.stat+.stat{padding-left:28px;border-left:1px solid var(--line)}
.stat b{display:block;font-size:52px;font-weight:200;letter-spacing:-2px;color:var(--ink);margin-bottom:6px}
h3{margin:32px 0 6px;font-size:12px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--ink)}
a{color:var(--neon);text-decoration:none;border-bottom:1px solid #2df5c055}
a.btn{border-bottom:1px solid var(--ink)}
footer{max-width:520px;margin:0 auto;padding:64px 20px 40px;color:#47474b;font-size:11px;letter-spacing:2px;text-transform:uppercase}
`;
const page = body => `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ResultSafe</title><style>${css}</style></head><body><header><div class='logo'><i></i>ResultSafe</div><p class='tag'>Student results portal</p></header>
<main>${body}</main><footer>Served by ${esc(os.hostname())}</footer></body></html>`;
const form = (msg = '') => page(`<div class='card'><h2>Student login</h2><p class='muted'>Enter your roll number and PIN.</p>${msg ? `<div class='err'>${esc(msg)}</div>` : ''}
<form method='post' action='/result'><input name='roll' placeholder='Roll number' maxlength='10' autocomplete='off' required><input name='pin' type='password' placeholder='PIN' maxlength='12' required><button>View result</button></form>
<p class='muted' style='margin-top:30px'><a href='/admin'>Teacher login</a></p></div>`);

// ---------- helpers ----------
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, (e, k) => e ? no(e) : ok(k.toString('hex'))));
async function checkPin(pin, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const got = Buffer.from(await scrypt(pin, salt));
  const want = Buffer.from(hash);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function readBody(req, limit) {
  return new Promise((ok, no) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) { no(new Error('too big')); req.destroy(); } });
    req.on('end', () => ok(data));
    req.on('error', no);
  });
}
async function getStudent(roll) {
  if (!ROLL_OK.test(roll || '')) return null;
  try {
    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { roll } }));
    if (!r.Item) return null;
    const i = r.Item;
    return { name: i.name, hash: i.hash, marks: { Maths: i.maths, Physics: i.physics, Networks: i.networks } };
  } catch (e) {
    console.error('DynamoDB read failed, using fallback:', e.message);
    return fallback[roll] || null;
  }
}
let adminCache = { at: 0, hash: null };
async function getAdminHash() {
  if (Date.now() - adminCache.at < 30000) return adminCache.hash;
  try {
    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { roll: '__admin__' } }));
    adminCache = { at: Date.now(), hash: r.Item ? r.Item.hash : null };
  } catch (e) { console.error('admin read failed', e.message); adminCache = { at: Date.now(), hash: null }; }
  return adminCache.hash;
}
// Admin session = expiry + HMAC keyed with the admin hash stored in DynamoDB,
// so a login on one server is valid on every other server behind the load balancer.
const sign = (hash, exp) => crypto.createHmac('sha256', hash).update(String(exp)).digest('hex');
async function isAdmin(req) {
  const m = /(?:^|; )rs_admin=(\d+)\.([0-9a-f]{64})/.exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  const hash = await getAdminHash();
  if (!hash) return false;
  return crypto.timingSafeEqual(Buffer.from(sign(hash, m[1])), Buffer.from(m[2]));
}
const bump = () => ddb.send(new UpdateCommand({ TableName: TABLE, Key: { roll: '__stats__' }, UpdateExpression: 'ADD views :one', ExpressionAttributeValues: { ':one': 1 } })).catch(e => console.error('stats', e.message));

// ---------- pages ----------
function resultPage(s) {
  const entries = Object.entries(s.marks);
  const total = entries.reduce((a, [, v]) => a + (Number(v) || 0), 0);
  const rows = entries.map(([k, v]) => `<div class='row'><div class='top'><span>${esc(k)}</span><span>${esc(v)}</span></div><div class='bar'><span style='width:${Math.max(0, Math.min(100, Number(v) || 0))}%'></span></div></div>`).join('');
  return page(`<div class='card'><div class='who'><div class='av'>${esc((s.name || '?')[0].toUpperCase())}</div><div><h2>${esc(s.name)}</h2><div class='muted'>Your result</div></div></div>${rows}
<div class='total'><span>Total</span><span>${total} / ${entries.length * 100}</span></div><a class='btn ghost' href='/'>Back</a></div>`);
}
async function adminPage(msg, kind) {
  let views = 0, students = 0, last = null;
  try {
    const st = await ddb.send(new GetCommand({ TableName: TABLE, Key: { roll: '__stats__' } }));
    views = (st.Item && st.Item.views) || 0;
    const lu = await ddb.send(new GetCommand({ TableName: TABLE, Key: { roll: '__lastupload__' } }));
    last = lu.Item || null;
    let key; do {
      const sc = await ddb.send(new ScanCommand({ TableName: TABLE, ProjectionExpression: 'roll', ExclusiveStartKey: key }));
      students += sc.Items.filter(i => !i.roll.startsWith('__')).length; key = sc.LastEvaluatedKey;
    } while (key);
  } catch (e) { msg = 'Could not read DynamoDB: ' + e.message; kind = 'err'; }
  const lastHtml = last ? `<div class='${last.status === 'LOADED' ? 'ok' : 'err'}'><b>Last upload: ${esc(last.status)}</b><br>${esc(last.file || '')} at ${esc(last.time || '')}${last.count ? '<br>' + esc(last.count) + ' students loaded' : ''}${(last.errors || []).map(x => '<br>' + esc(x)).join('')}</div>` : `<p class='muted'>No upload yet.</p>`;
  return page(`<div class='card'><h2>Teacher dashboard</h2>${msg ? `<div class='${kind || 'ok'}'>${esc(msg)}</div>` : ''}
<div class='stats'><div class='stat'><b>${students}</b>students</div><div class='stat'><b>${views}</b>results viewed</div></div>
<h3>Upload marks</h3><p class='muted'>CSV with the header <code>roll,name,pin,maths,physics,networks</code>. Max 500 rows. PINs are hashed on the server before storage.</p>
<input type='file' id='f' accept='.csv'><button id='up'>Upload</button><div id='out' class='muted' style='margin-top:10px'></div>${lastHtml}
<form method='post' action='/admin/logout'><button class='ghost'>Log out</button></form></div>
<script>document.getElementById('up').onclick=async()=>{const f=document.getElementById('f').files[0],o=document.getElementById('out');if(!f){o.textContent='Choose a CSV file first.';return}
o.textContent='Uploading...';const r=await fetch('/admin/upload',{method:'POST',headers:{'Content-Type':'text/csv'},body:await f.text()});const j=await r.json().catch(()=>({}));
o.textContent=r.ok?'Uploaded '+j.rows+' rows. The checker is running; reload in a few seconds to see the result.':'Failed: '+(j.error||r.status)}</script>`);
}
const adminLogin = (msg = '') => page(`<div class='card'><h2>Teacher login</h2>${msg ? `<div class='err'>${esc(msg)}</div>` : ''}<form method='post' action='/admin/login'><input name='password' type='password' placeholder='Password' maxlength='64' required><button>Log in</button></form><p class='muted' style='margin-top:30px'><a href='/'>Student login</a></p></div>`);

async function handleUpload(req) {
  const text = await readBody(req, 200 * 1024);
  const lines = text.replace(/\r/g, '').trim().split('\n');
  if (lines[0].trim() !== 'roll,name,pin,maths,physics,networks') throw new Error('Wrong header. Expected roll,name,pin,maths,physics,networks');
  if (lines.length < 2 || lines.length > 501) throw new Error('Between 1 and 500 student rows are allowed');
  const out = ['roll,name,hash,maths,physics,networks'];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    if (c.length !== 6) throw new Error('Each row needs exactly 6 columns: ' + line.slice(0, 40));
    const [roll, name, pin, ...marks] = c.map(x => x.trim());
    if (!ROLL_OK.test(roll)) throw new Error('Bad roll number: ' + roll.slice(0, 12));
    if (!/^[0-9]{4,12}$/.test(pin)) throw new Error('PIN for ' + roll + ' must be 4 to 12 digits');
    const salt = crypto.randomBytes(8).toString('hex');
    out.push([roll, name, salt + ':' + await scrypt(pin, salt), ...marks].join(','));
  }
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'uploads/' + Date.now() + '.csv', Body: out.join('\n') + '\n', ContentType: 'text/csv' }));
  return lines.length - 1;
}

http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') return res.end('OK');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const send = (code, html) => { res.statusCode = code; res.end(html); };

    if (req.method === 'POST' && req.url === '/result') {
      const p = new URLSearchParams(await readBody(req, 1024));
      const s = await getStudent(p.get('roll'));
      if (!s || !(await checkPin(p.get('pin') || '', s.hash))) return send(401, form('Invalid roll number or PIN'));
      bump();
      return send(200, resultPage(s));
    }
    if (req.url === '/admin' && req.method === 'GET') return send(200, (await isAdmin(req)) ? await adminPage() : adminLogin());
    if (req.url === '/admin/login' && req.method === 'POST') {
      const p = new URLSearchParams(await readBody(req, 1024));
      const hash = await getAdminHash();
      if (!hash || !(await checkPin(p.get('password') || '', hash))) return send(401, adminLogin('Wrong password'));
      const exp = Date.now() + 30 * 60 * 1000;
      res.setHeader('Set-Cookie', `rs_admin=${exp}.${sign(hash, exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);
      res.statusCode = 303; res.setHeader('Location', '/admin'); return res.end();
    }
    if (req.url === '/admin/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'rs_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      res.statusCode = 303; res.setHeader('Location', '/admin'); return res.end();
    }
    if (req.url === '/admin/upload' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      if (!(await isAdmin(req))) return send(401, JSON.stringify({ error: 'Not logged in' }));
      try { return send(200, JSON.stringify({ rows: await handleUpload(req) })); }
      catch (e) { return send(400, JSON.stringify({ error: e.message })); }
    }
    send(200, form());
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end('Something went wrong'); }
  }
}).listen(process.env.PORT || 3000, () => console.log('ResultSafe running'));