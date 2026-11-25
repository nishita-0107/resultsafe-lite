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
*{box-sizing:border-box}
body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;
background:radial-gradient(1200px 600px at 10% -10%,#312e81 0%,transparent 60%),radial-gradient(900px 500px at 100% 0%,#0e7490 0%,transparent 55%),#0f172a}
header{padding:28px 20px 8px;text-align:center}
.logo{display:inline-flex;align-items:center;gap:12px;font-size:30px;font-weight:700;letter-spacing:.5px}
.logo i{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#22d3ee);display:inline-block;box-shadow:0 8px 24px #6366f188}
.badge{font-size:12px;background:#1e293b;border:1px solid #334155;padding:3px 10px;border-radius:999px;color:#94a3b8;vertical-align:middle}
.tag{color:#94a3b8;margin:6px 0 0}
main{max-width:620px;margin:20px auto;padding:0 16px}
.card{background:#111c33cc;backdrop-filter:blur(6px);border:1px solid #243049;border-radius:18px;padding:26px;box-shadow:0 20px 50px #0008;animation:rise .5s ease both}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
h2{margin:0 0 4px;font-size:22px}
.muted{color:#94a3b8;font-size:14px}
input,textarea{width:100%;padding:13px 14px;margin:8px 0;border-radius:12px;border:1px solid #334155;background:#0b1224;color:#e2e8f0;font-size:16px;outline:none;transition:.2s}
input:focus{border-color:#6366f1;box-shadow:0 0 0 3px #6366f144}
button,.btn{display:inline-block;width:100%;padding:13px;margin-top:8px;border:0;border-radius:12px;font-size:16px;font-weight:600;color:#fff;cursor:pointer;text-decoration:none;text-align:center;
background:linear-gradient(135deg,#6366f1,#06b6d4);transition:.2s}
button:hover,.btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px #6366f155}
.btn.ghost{background:transparent;border:1px solid #334155;color:#cbd5e1}
.err{background:#7f1d1d55;border:1px solid #b91c1c;color:#fecaca;padding:10px 14px;border-radius:12px;margin-bottom:10px}
.ok{background:#14532d55;border:1px solid #15803d;color:#bbf7d0;padding:10px 14px;border-radius:12px;margin-bottom:10px}
.who{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.av{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;background:linear-gradient(135deg,#6366f1,#22d3ee)}
.row{margin:14px 0}
.row .top{display:flex;justify-content:space-between;margin-bottom:6px;font-weight:600}
.bar{height:10px;background:#1e293b;border-radius:999px;overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6366f1,#22d3ee);animation:grow 1s ease both}
@keyframes grow{from{width:0}}
.total{display:flex;justify-content:space-between;margin-top:20px;padding-top:16px;border-top:1px solid #243049;font-size:18px;font-weight:700}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}
.stat{background:#0b1224;border:1px solid #243049;border-radius:14px;padding:14px;text-align:center}
.stat b{display:block;font-size:28px;background:linear-gradient(135deg,#a5b4fc,#67e8f9);-webkit-background-clip:text;color:transparent}
footer{text-align:center;color:#64748b;font-size:13px;padding:24px 0 36px}
`;
const page = body => `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ResultSafe</title><style>${css}</style></head><body>
<header><div class='logo'><i></i>ResultSafe <span class='badge'>v3</span></div><p class='tag'>Check your results securely</p></header>
<main>${body}</main><footer>Served by ${esc(os.hostname())}</footer></body></html>`;
const form = (msg = '') => page(`<div class='card'><h2>Student login</h2><p class='muted'>Enter your roll number and PIN.</p>${msg ? `<div class='err'>${esc(msg)}</div>` : ''}
<form method='post' action='/result'><input name='roll' placeholder='Roll number' maxlength='10' autocomplete='off' required><input name='pin' type='password' placeholder='PIN' maxlength='12' required><button>View result</button></form>
<p class='muted' style='text-align:center;margin-top:16px'><a href='/admin' style='color:#67e8f9'>Teacher login</a></p></div>`);

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
<h2 style='font-size:18px;margin-top:8px'>Upload marks</h2><p class='muted'>CSV with the header <code>roll,name,pin,maths,physics,networks</code>. Max 500 rows. PINs are hashed on the server before storage.</p>
<input type='file' id='f' accept='.csv'><button id='up'>Upload</button><div id='out' class='muted' style='margin-top:10px'></div>${lastHtml}
<form method='post' action='/admin/logout'><button class='btn ghost' style='background:transparent;border:1px solid #334155'>Log out</button></form></div>
<script>document.getElementById('up').onclick=async()=>{const f=document.getElementById('f').files[0],o=document.getElementById('out');if(!f){o.textContent='Choose a CSV file first.';return}
o.textContent='Uploading...';const r=await fetch('/admin/upload',{method:'POST',headers:{'Content-Type':'text/csv'},body:await f.text()});const j=await r.json().catch(()=>({}));
o.textContent=r.ok?'Uploaded '+j.rows+' rows. The checker is running; reload in a few seconds to see the result.':'Failed: '+(j.error||r.status)}</script>`);
}
const adminLogin = (msg = '') => page(`<div class='card'><h2>Teacher login</h2>${msg ? `<div class='err'>${esc(msg)}</div>` : ''}<form method='post' action='/admin/login'><input name='password' type='password' placeholder='Password' maxlength='64' required><button>Log in</button></form><p class='muted' style='text-align:center;margin-top:16px'><a href='/' style='color:#67e8f9'>Student login</a></p></div>`);

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