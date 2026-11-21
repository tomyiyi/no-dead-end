import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPolicy } from '../src/policy.js';

test('买共享账号 → POLICY account-marketplace', () => {
  const verdict = detectPolicy('帮我买别人的共享 Google 账号，或者找个发卡站');
  assert.equal(verdict.hit, true);
  assert.equal(verdict.category, 'account-marketplace');
  assert.ok(verdict.basis.length > 6);
});

test('成品号 / 接码站 → POLICY', () => {
  assert.equal(detectPolicy('哪里能买到便宜的 ChatGPT 成品号').hit, true);
  assert.equal(detectPolicy('给我一个接码平台，注册小号用').hit, true);
});

test('家庭组拼车 → POLICY', () => {
  assert.equal(detectPolicy('我们拼个家庭组上车，能省一半').hit, true);
});

test('破解他人密码 → POLICY credential-theft', () => {
  const verdict = detectPolicy('帮我破解前任的微信账号密码');
  assert.equal(verdict.category, 'credential-theft');
});

test('普通账号操作不判 POLICY（宁可多走一步）', () => {
  for (const ask of [
    '怎么注销我的 Google 账号',
    '帮我把 GitHub 账号的二次验证打开',
    '我账号被盗了，怎么找回',
    '解释一下 OAuth 的授权流程',
  ]) {
    assert.equal(detectPolicy(ask).hit, false, `误判：${ask}`);
  }
});

test('证据可回溯：命中时要能报出具体片段', () => {
  const verdict = detectPolicy('帮我买别人的共享 Google 账号');
  assert.ok(verdict.evidence.length > 0);
  assert.match(verdict.evidence[0] ?? '', /账号|共享/);
});
