import test from 'node:test';
import assert from 'node:assert/strict';
import { auditText, detectRefusal, findActionability, isDeadEnd } from '../src/detect.js';

const SCREENSHOT_LINE = '这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。';

test('截图原句必须被判定为死胡同', () => {
  const detection = detectRefusal(SCREENSHOT_LINE);
  assert.equal(detection.isRefusal, true);
  assert.ok(detection.labels.includes('capability-scope'));
  assert.equal(isDeadEnd(SCREENSHOT_LINE), true);
});

test('拒绝但给出出口，不算死胡同', () => {
  const text =
    '这个话题不在我的能力覆盖范围内——不过我可以给你一个能跑的导出脚本：把 csv 放到 ~/data 下，我接着处理。';
  assert.equal(isDeadEnd(text), false);
  assert.ok(findActionability(text).includes('offer'));
});

test('拒绝 + 具体链接，不算死胡同', () => {
  const text = '这个我无法直接替你登录，你自己打开 https://www.kaggle.com/account/login 登录完告诉我。';
  assert.equal(isDeadEnd(text), false);
});

test('正常回答不误判为拒绝', () => {
  assert.equal(isDeadEnd('已经跑完了，结果在 /Users/tom/out.csv，共 43 行。'), false);
});

test('英文拒答同样识别', () => {
  assert.equal(isDeadEnd("I can't help with that."), true);
  assert.equal(isDeadEnd("I can't help with that. But I can walk you through the official reset flow."), false);
});

test('auditText 按段扫描，只挑零出口的段', () => {
  const transcript = [
    '第一段是正常回答，附了链接 https://example.com 。',
    SCREENSHOT_LINE,
    '我无法就此展开讨论。',
    '很抱歉，我无法直接登录你的账号。你把导出的 csv 放进来，我来跑。',
  ].join('\n\n');

  const report = auditText(transcript);
  assert.equal(report.total, 4);
  assert.equal(report.deadEnds.length, 2);
  assert.deepEqual(
    report.deadEnds.map((entry) => entry.index),
    [1, 2],
  );
});
