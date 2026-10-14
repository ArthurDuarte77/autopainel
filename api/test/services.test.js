import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appraise, average, matches, toCSV, parseBRL } from '../src/services.js';

test('appraise: max price and profit (prototype example)', () => {
  const a = appraise(98950);
  assert.equal(a.max_price, 79323);
  assert.equal(a.est_profit, 11874);
  assert.equal(appraise(98950, { margin_pct: '', prep_cost: 0 }).max_price, 83123);
});

test('average ignores empty/zero values', () => {
  assert.equal(average([100, 0, null, '200']), 150);
  assert.equal(average([]), 0);
});

test('parseBRL', () => assert.equal(parseBRL('R$ 98.950,50'), 98950.5));

test('matches lead criteria against stock', () => {
  const v = { brand: 'Toyota', model: 'Corolla XEi', body_type: 'Sedã', fuel: 'Flex', year: 2022, price: 128900, status: 'Disponível' };
  assert.ok(matches({ brand: 'toyota', model: 'corolla' }, v));
  assert.ok(matches({ body_type: 'Seda', price_max: 130000 }, v));
  assert.ok(!matches({ brand: 'Toyota', price_max: 100000 }, v));
  assert.ok(!matches({ year_min: 2023 }, v));
  assert.ok(!matches({}, v), 'no criteria = no match');
  assert.ok(!matches({ brand: 'Toyota' }, { ...v, status: 'Vendido' }));
});

test('toCSV: headers, escaping, BOM', () => {
  const csv = toCSV([{ a: 'x;y', b: 'he said "hi"' }], [['a', 'Coluna A'], 'b']);
  assert.equal(csv, '﻿Coluna A;b\n"x;y";"he said ""hi"""');
});
