import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectStrings, evaluateHookPayload, readTranscriptReplies, renderHookOutput } from '../src/hook.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('hook：Gemini 形状的负载能拦下死胡同', () => {
  const decision = evaluateHookPayload({
    event: 'AfterAgent',
    llm_response: '这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。',
  });
  assert.equal(decision.block, true);
  assert.ok(decision.reason && decision.nextAction);
});

test('hook：有出口的回复放行', () => {
  const decision = evaluateHookPayload({
    llm_response: '我无法替你登录，你打开 https://www.kaggle.com/account/login 登录完我继续。',
  });
  assert.equal(decision.block, false);
});

test('hook：嵌套结构里也能挖出回复文本', () => {
  const long = '这是一段足够长的嵌套回复文本内容，用来验证递归提取是否生效';
  const strings = collectStrings({ a: { b: [{ c: long }] } });
  assert.ok(strings.includes(long));
});

test('hook：跳过 command/path 等非回复字段', () => {
  const strings = collectStrings({ command: '这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。' });
  assert.equal(strings.length, 0);
});

test('hook：输出符合 block 协议', () => {
  const output = renderHookOutput(
    { block: true, reason: '理由', nextAction: '动作' },
    'gemini',
  );
  const parsed = JSON.parse(output) as { decision: string; systemMessage: string };
  assert.equal(parsed.decision, 'block');
  assert.match(parsed.systemMessage, /动作/);
});

test('hook CLI：命中时退出码 2', () => {
  const payload = JSON.stringify({
    llm_response: '这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。',
  });
  const result = spawnSync(process.execPath, [cli, 'hook'], { input: payload, encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /"decision": "block"/);
});

test('hook CLI：空输入不打扰，退出码 0', () => {
  const result = spawnSync(process.execPath, [cli, 'hook'], { input: '', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

function writeTranscript(entries: Array<{ source: string; content: string }>): string {
  const file = join(tmpdir(), `nd-transcript-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
  writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');
  return file;
}

test('Antigravity 负载：用户自己说的话不算助手拒答（不误判）', () => {
  const decision = evaluateHookPayload({
    hookEventName: 'Stop',
    lastUserInput: '请原样重复：这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。',
  });
  assert.equal(decision.block, false);
});

test('Antigravity 负载：从 transcriptPath 抓到助手最后一条死胡同', () => {
  const transcript = writeTranscript([
    { source: 'USER_EXPLICIT', content: '一个很长很长的用户提问内容，用来占位。' },
    { source: 'MODEL', content: '我无法就此展开讨论。' },
  ]);
  const decision = evaluateHookPayload({ hookEventName: 'Stop', transcriptPath: transcript });
  assert.equal(decision.block, true);
  assert.match(decision.offending ?? '', /无法就此展开讨论/);
});

test('Antigravity 负载：transcript 里最后一条有出口就放行', () => {
  const transcript = writeTranscript([
    { source: 'MODEL', content: '我无法替你登录，你打开 https://www.kaggle.com/account/login 登录完我继续。' },
  ]);
  const decision = evaluateHookPayload({ hookEventName: 'Stop', transcriptPath: transcript });
  assert.equal(decision.block, false);
});

test('readTranscriptReplies：只取 MODEL 且足够长的内容', () => {
  const transcript = writeTranscript([
    { source: 'USER_EXPLICIT', content: '用户的一段足够长的输入文本内容用于占位' },
    { source: 'MODEL', content: '短' },
    { source: 'MODEL', content: '这是一条足够长的助手回复，用于验证过滤逻辑是否生效' },
  ]);
  const replies = readTranscriptReplies({ transcriptPath: transcript });
  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? '', /过滤逻辑/);
});
