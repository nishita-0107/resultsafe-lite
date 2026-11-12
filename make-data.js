const crypto = require('crypto');
const fs = require('fs');
let out = 'roll,name,hash,maths,physics,networks\n';
for (let i = 1; i <= 30; i++) {
  const roll = 'CS' + String(i).padStart(3, '0');
  const pin = String(1000 + i);
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  const m = () => 40 + Math.floor(Math.random() * 60);
  out += `${roll},Student ${i},${salt}:${hash},${m()},${m()},${m()}\n`;
}
fs.writeFileSync('results.csv', out);
console.log('results.csv created. CS001 has PIN 1001');