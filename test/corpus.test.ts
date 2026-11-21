import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeadEnd } from '../src/detect.js';

type Case = { id: string; text: string; source?: string; why?: string };

function load(name: string): Case[] {
  const file = fileURLToPath(new URL(`../../corpus/${name}`, import.meta.url));
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Case);
}

test('语料库：死胡同必须全部命中', () => {
  const cases = load('dead-ends.jsonl');
  assert.ok(cases.length >= 5);
  for (const item of cases) {
    assert.equal(isDeadEnd(item.text), true, `漏判：${item.id} — ${item.text}`);
  }
});

test('语料库：有出口的回复一个都不许误判', () => {
  const cases = load('not-dead-ends.jsonl');
  assert.ok(cases.length >= 5);
  for (const item of cases) {
    assert.equal(isDeadEnd(item.text), false, `误判：${item.id} — ${item.why ?? ''}`);
  }
});
