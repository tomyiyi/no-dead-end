import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectStrings, evaluateHookPayload, renderHookOutput } from '../src/hook.js';

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
