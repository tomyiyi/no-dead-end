# no-dead-end

把 AI 的「这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论」死胡同，
重写成**可执行、可校验、可回归测试**的恢复路径。

- 死胡同的判定是机械的：`拒答 + 零出口`，不靠感觉。
- 缺口分四类，只有 `POLICY` 有权直接拒绝。
- 每条候选路径都带 `action` / `requires` / `verification`，不说「方向」说「动作」。
- 输出经 Zod 强校验：禁语进回复、`HANDOVER` 没 URL、边界声明没依据，直接在 schema 层拒收。

## 为什么需要它

真实截图（2026-11-21）：

```
用户：那你用 kaggle 去登录，我有账号的
模型：已完成 2m16s
      这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。
```

这不是安全过滤，也不是能力不足 —— 是**把「需要一个会话」误判成「做不到」**。
浏览器能驱动，登录态只能由用户建立，正确动作是「打开站点 → 交还窗口 → 登录后校验 → 继续跑」。
本技能把这个判断固化成代码，并让它在下次同样场景下自动发生。

## 安装

```bash
git clone https://github.com/tomyiyi/no-dead-end.git
cd no-dead-end
npm install
npm run build
node dist/src/cli.js --help
```

作为 Agent 技能使用时，把本目录（含 `SKILL.md`）放进技能目录即可：

```bash
cp -R no-dead-end ~/.workbuddy/skills/no-dead-end
```

## 用法

```bash
# 1) 判定一句话是不是死胡同（退出码 1 = 是，可直接接 CI）
no-dead-end check "这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。"

# 2) 出恢复计划
no-dead-end plan --ask "那你用 kaggle 去登录，我有账号的" \
  --refusal "这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。"

# 3) 扫一份对话/日志
no-dead-end audit transcript.md --json

# 4) 装 hook：把死胡同从「事后发现」变成「当场打回」
no-dead-end install-hooks --dry-run   # 先看要写什么
no-dead-end install-hooks             # 写进 ~/.gemini/settings.json（先备份）
```

`plan` 选项：`--ask`（必填）、`--refusal`、`--no-browser`、`--no-network`、`--skill`、`--cli`、`--lang zh|en`、`--json`。

退出码：`0` 正常 / `1` 发现死胡同 / `2` 参数或校验失败。

## 输出长什么样

```
缺口类型：缺会话/工具动作，可执行（EXECUTION）
原话是否死胡同：是 —— 拒答且零出口
命中信号：needs-auth:login / needs-auth:account

推荐下一步（交还浏览器控制权）：
  浏览器导航到 https://www.kaggle.com/account/login → 调 browser_waiting_for_user_interaction
  把控制权交给你完成登录（2FA 由你本人输入） → 校验会话 → 继续执行原任务
```

四类缺口 → 七级恢复阶梯：

| 缺口 | 阶梯（按可行性降序） |
|---|---|
| `EXECUTION`（登录/浏览器） | HANDOVER → SUBSTITUTE → REUSE_SKILL → ACQUIRE |
| `EXECUTION`（其他） | REUSE_SKILL → ACQUIRE |
| `KNOWLEDGE` | SEARCH → REUSE_SKILL |
| `AMBIGUITY` | ASK_ONE_QUESTION → REUSE_SKILL |
| `POLICY` | DECLARE_BOUNDARY（必须带 `policyBasis` + 合法替代） |

## 作为库使用

```ts
import { isDeadEnd, auditText } from 'no-dead-end/detect';
import { planRecovery } from 'no-dead-end/plan';

isDeadEnd('这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。'); // true

const plan = planRecovery({
  ask: '那你用 kaggle 去登录，我有账号的',
  env: { browser: true, network: true, lang: 'zh' },
});
plan.nextAction;        // 一条能立刻执行的动作
plan.userFacingMessage; // 直接替代那句死胡同
```

所有入口数据过 Zod，产出再过一次 Zod（`RecoveryPlanSchema`），保证不会吐出一份「看起来像方案」的空话。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # build + node:test（36 条：含截图原句、语料库双向、hook 协议）
```

语料库在 `corpus/`：`dead-ends.jsonl` 必须全命中，`not-dead-ends.jsonl` 一个都不许误判。

## 边界

不代持密码、不索取验证码、不复制他人 cookie。
未授权访问 / 绕过访问控制 / 伪造类请求一律走 `DECLARE_BOUNDARY`，并给出合法替代。
本技能解决的是「把出口找完之前不许拒绝」，不是「把所有拒绝都推翻」。

## License

MIT
