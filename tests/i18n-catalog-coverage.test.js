const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/js/i18n.en.json'), 'utf8'));
const hasChinese = /[\u3400-\u9fff]/;

test('English catalog covers static labels and accessibility text', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const labels = [];
  for (const match of html.matchAll(/>([^<>]+)</g)) labels.push(match[1].trim());
  for (const match of html.matchAll(/(?:title|aria-label|placeholder|alt)="([^"]+)"/g)) labels.push(match[1].replace(/&#10;/g, '\n').trim());
  const decorative = new Set(['世', '界', '和', '平']); // handled as animated letters in i18n.js
  const missing = labels.filter(label => hasChinese.test(label) && !catalog[label] && !decorative.has(label));
  assert.deepEqual([...new Set(missing)], []);
});

test('English catalog covers generated Cyber and Space visual controls', () => {
  const source = JSON.parse(fs.readFileSync(path.join(root, 'public/vendor/source-visuals/catalog.json'), 'utf8'));
  const missing = [];
  function inspect(value) {
    if (typeof value === 'string' && hasChinese.test(value) && !catalog[value]) missing.push(value);
    else if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  }
  inspect(source);
  assert.deepEqual([...new Set(missing)], []);
});
