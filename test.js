const assert = require('assert');
const fs = require('fs');
const lines = fs.readFileSync('results.csv', 'utf8').trim().split('\n');
assert.strictEqual(lines.length, 31);
assert.strictEqual(lines[0], 'roll,name,hash,maths,physics,networks');
lines.slice(1).forEach(l => {
  const c = l.split(',');
  assert.strictEqual(c.length, 6, 'six columns: ' + l);
  assert.ok(/^[A-Za-z0-9]{1,10}$/.test(c[0]), 'roll format: ' + c[0]);
  assert.ok(/^[^:,\s]{1,64}:[0-9a-f]{64}$/.test(c[2]), 'hash format: ' + c[0]);
});
console.log('tests passed');