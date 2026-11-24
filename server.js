const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const students = Object.create(null);
fs.readFileSync(path.join(__dirname, 'results.csv'), 'utf8').trim().split('\n').slice(1).forEach(line => {
  const [roll, name, hash, maths, physics, networks] = line.trim().split(',');
  students[roll] = { name, hash, marks: { Maths: maths, Physics: physics, Networks: networks } };
});

const esc = s => String(s).replace(/[&<>]/g, c => '&#' + c.charCodeAt(0) + ';');
const page = body => `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ResultSafe</title><style>body{font-family:sans-serif;max-width:560px;margin:40px auto;padding:0 16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}small{color:#666}</style></head><body><h1>ResultSafe v2</h1>${body}<hr><small>Served by ${esc(os.hostname())}</small></body></html>`;
const form = (msg = '') => page(`<p>${esc(msg)}</p><form method='post' action='/result'><input name='roll' placeholder='Roll number' maxlength='10' required> <input name='pin' type='password' placeholder='PIN' maxlength='12' required> <button>View result</button></form>`);

function checkPin(pin, stored, cb) {
  const [salt, hash] = stored.split(':');
  crypto.scrypt(pin, salt, 32, (err, key) => {
    cb(!err && crypto.timingSafeEqual(Buffer.from(key.toString('hex')), Buffer.from(hash)));
  });
}

function readBody(req, cb) {
  let data = '';
  req.on('data', chunk => { data += chunk; if (data.length > 1024) req.destroy(); });
  req.on('end', () => cb(new URLSearchParams(data)));
}

http.createServer((req, res) => {
  if (req.url === '/health') return res.end('OK');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.method === 'POST' && req.url === '/result') {
    return readBody(req, p => {
      const s = students[p.get('roll')];
      if (!s) { res.statusCode = 401; return res.end(form('Invalid roll number or PIN')); }
      checkPin(p.get('pin') || '', s.hash, ok => {
        if (!ok) { res.statusCode = 401; return res.end(form('Invalid roll number or PIN')); }
        const rows = Object.entries(s.marks).map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('');
        res.end(page(`<h2>${esc(s.name)}</h2><table><tr><th>Subject</th><th>Marks</th></tr>${rows}</table><p><a href='/'>Back</a></p>`));
      });
    });
  }
  res.end(form());
}).listen(process.env.PORT || 3000, () => console.log('ResultSafe Lite running'));