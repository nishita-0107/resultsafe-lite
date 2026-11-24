const assert = require('assert');
const fs = require('fs');
const lines = fs.readFileSync('results.csv', 'utf8').trim().split('\n');
assert.strictEqual(lines.length, 31);
assert.strictEqual(lines[0], 'roll,name,hash,maths,physics,networks');
console.log('tests passed');