// KS161 / ASK-INTENT
// Focused tests for the BI-agent ask-intent object extractor.

import assert from 'node:assert/strict';
import test from 'node:test';

import { objectFromMessage, technicalFamily } from '../services/bi-agent/src/ask-intent.mjs';

test('extracts the schema-qualified object from a dependencies ask', () => {
  assert.deepStrictEqual(objectFromMessage('Dependencies of dbo.orders'), {name: 'dbo.orders'});
});

test('extracts the schema-qualified object from an impact ask', () => {
  assert.deepStrictEqual(objectFromMessage('Impact of table sales.orders'), {name: 'sales.orders'});
});

test('extracts the bare object from a uses ask', () => {
  assert.deepStrictEqual(objectFromMessage('Which table uses orders?'), {name: 'orders'});
});

test('preserves direct adjacency', () => {
  assert.deepStrictEqual(objectFromMessage('Table sales.orders'), {name: 'sales.orders'});
});

test('resolves the named function from a stored-logic ask', () => {
  assert.deepStrictEqual(objectFromMessage('Signature of function CALC_TAX'), {name: 'CALC_TAX'});
});

test('missing objects fail closed to null', () => {
  for (const message of [
    'Dependencies of',
    'Impact of',
    'Signature of function',
    'Which table uses?',
    'Impact',
  ]) {
    assert.equal(objectFromMessage(message), null, message);
  }
});

test('trailing connectors fail closed to null', () => {
  for (const message of [
    'Dependencies of of',
    'Impact of table',
    'Signature of function of',
    'Which table uses of?',
  ]) {
    assert.equal(objectFromMessage(message), null, message);
  }
});

test('connector words are never captured as object names', () => {
  const captured = [
    objectFromMessage('Dependencies of dbo.orders')?.name,
    objectFromMessage('Impact of table sales.orders')?.name,
    objectFromMessage('Which table uses orders?')?.name,
  ];
  for (const name of captured) {
    assert.notEqual(name, 'of', name);
    assert.notEqual(name, 'uses', name);
    assert.notEqual(name, 'table', name);
  }
});

test('technical family routing stays exact', () => {
  assert.equal(technicalFamily('Dependencies of dbo.orders'), 'dependencies');
  assert.equal(technicalFamily('Signature of function CALC_TAX'), 'stored_logic_signatures');
  assert.equal(technicalFamily('Rows of dbo.orders'), 'row_estimates_freshness');
  assert.equal(technicalFamily('status'), null);
});