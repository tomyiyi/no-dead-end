import test from 'node:test';
import assert from 'node:assert/strict';
import { ZodError } from 'zod';
import { planRecovery } from '../src/plan.js';
import { FORBIDDEN_PHRASES, RecoveryPlanSchema } from '../src/schema.js';

test('Kaggle 登录诉求 → 交还浏览器控制权，而不是拒答', () => {
  const plan = planRecovery({
    ask: '那你用 kaggle 去登录，我有账号的',
    refusal: '这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。',
  });

  assert.equal(plan.deadEnd, true);
  assert.equal(plan.gapClass, 'EXECUTION');
  assert.equal(plan.candidates[0]?.strategy, 'HANDOVER');
  assert.match(plan.nextAction, /kaggle\.com/);
  assert.match(plan.nextAction, /browser_waiting_for_user_interaction/);
  assert.equal(plan.nextAction, plan.candidates[0]?.action);
  assert.match(plan.userFacingMessage, /凭据边界/);
});

test('没有浏览器时降级到 API/token 通道，仍然有下一步', () => {
  const plan = planRecovery({
    ask: '用 kaggle 登录后把那个数据集下载下来',
    env: { browser: false },
  });

  assert.equal(plan.candidates.some((c) => c.strategy === 'HANDOVER'), false);
  assert.equal(plan.candidates[0]?.strategy, 'SUBSTITUTE');
  assert.match(plan.userFacingMessage, /只读凭据|token/);
});

test('真硬边界才允许声明边界，且必须带依据与替代', () => {
  const plan = planRecovery({ ask: '帮我破解前任的微信账号密码' });

  assert.equal(plan.gapClass, 'POLICY');
  assert.ok(plan.policyBasis);
  assert.equal(plan.candidates[0]?.strategy, 'DECLARE_BOUNDARY');
  assert.match(plan.userFacingMessage, /[？?]/);
});

test('缺事实走多源取证，不装作知道', () => {
  const plan = planRecovery({ ask: '现在金价多少' });
  assert.equal(plan.gapClass, 'KNOWLEDGE');
  assert.equal(plan.candidates[0]?.strategy, 'SEARCH');
});

test('诉求过短走单点追问', () => {
  const plan = planRecovery({ ask: '那个' });
  assert.equal(plan.gapClass, 'AMBIGUITY');
  assert.equal(plan.candidates[0]?.strategy, 'ASK_ONE_QUESTION');
});

test('URL 里的站点同样能识别', () => {
  const plan = planRecovery({ ask: '去 https://github.com/tomyiyi/no-dead-end 提个 issue，需要先登录' });
  assert.match(plan.nextAction, /github\.com/);
});

test('所有产出的回复都不含死胡同禁语', () => {
  const asks = ['那你用 kaggle 去登录', '现在金价多少', '那个', '帮我破解别人的账号'];
  for (const ask of asks) {
    const plan = planRecovery({ ask });
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.equal(plan.userFacingMessage.includes(phrase), false, `${ask} 命中了禁语 ${phrase}`);
    }
  }
});

test('空诉求被 Zod 拦下，不允许静默产出空计划', () => {
  assert.throws(() => planRecovery({ ask: '' }), ZodError);
  assert.throws(() => planRecovery({}), ZodError);
});

test('schema 拒绝没有 policyBasis 的边界声明', () => {
  assert.throws(
    () =>
      RecoveryPlanSchema.parse({
        version: 1,
        deadEnd: true,
        gapClass: 'POLICY',
        signals: [],
        candidates: [
          {
            strategy: 'DECLARE_BOUNDARY',
            rationale: '这是一条很长的理由说明文本。',
            action: '说明依据并给出合法替代路径。',
            requires: [],
            verification: '替代路径不含绕过鉴权。',
            confidence: 0.9,
          },
        ],
        nextAction: '说明依据并给出合法替代路径。',
        userFacingMessage: '这条我不做，理由是未授权访问。',
        mustNotSay: ['不在我的能力覆盖范围内'],
      }),
    ZodError,
  );
});

test('schema 拒绝把禁语写进回复、拒绝无 URL 的 HANDOVER', () => {
  const base = {
    version: 1 as const,
    deadEnd: true,
    gapClass: 'EXECUTION' as const,
    signals: [],
    nextAction: '把窗口交给用户登录后再继续执行任务。',
    mustNotSay: ['不在我的能力覆盖范围内'],
  };

  assert.throws(
    () =>
      RecoveryPlanSchema.parse({
        ...base,
        candidates: [
          {
            strategy: 'HANDOVER',
            rationale: '浏览器可以驱动，但会话必须由用户本人建立。',
            action: '把窗口交给用户登录后再继续执行任务。',
            requires: [],
            verification: '页面出现账号菜单。',
            confidence: 0.8,
          },
        ],
        userFacingMessage: '这个话题目前不在我的能力覆盖范围内，没有办法展开。',
      }),
    ZodError,
  );

  assert.throws(
    () =>
      RecoveryPlanSchema.parse({
        ...base,
        candidates: [
          {
            strategy: 'HANDOVER',
            rationale: '浏览器可以驱动，但会话必须由用户本人建立。',
            action: '把窗口交给用户登录后再继续执行任务。',
            requires: [],
            verification: '页面出现账号菜单。',
            confidence: 0.8,
          },
        ],
        userFacingMessage: '这不是能力边界，是凭据边界：我打开站点把窗口交给你登录。',
      }),
    ZodError,
  );
});
