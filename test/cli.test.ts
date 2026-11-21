import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('cli check：死胡同退出码 1', () => {
  const result = run(['check', '这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout) as { deadEnd: boolean };
  assert.equal(payload.deadEnd, true);
});

test('cli check：有出口的拒绝退出码 0', () => {
  const result = run(['check', '我无法替你登录，但可以打开 https://www.kaggle.com/account/login 后交给你。']);
  assert.equal(result.status, 0);
});

test('cli plan --json：产出可机器消费的恢复计划', () => {
  const result = run(['plan', '--ask', '那你用 kaggle 去登录，我有账号的', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout) as { gapClass: string; nextAction: string };
  assert.equal(plan.gapClass, 'EXECUTION');
  assert.match(plan.nextAction, /browser_waiting_for_user_interaction/);
});

test('cli plan 缺 --ask：退出码 2 且不输出计划', () => {
  const result = run(['plan']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout.trim(), '');
});

test('cli 未知参数：退出码 2', () => {
  const result = run(['plan', '--ask', '查下金价', '--bogus']);
  assert.equal(result.status, 2);
});
