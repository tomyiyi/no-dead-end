---
name: no-dead-end
description: >-
  Converts "this topic is not within my capability coverage, I can't discuss it" dead-ends into
  executable recovery paths. A dead-end is defined mechanically as refusal + zero exit; this skill
  classifies the gap (POLICY / KNOWLEDGE / EXECUTION / AMBIGUITY), then emits a Zod-validated plan
  from a fixed ladder: reuse local skill -> multi-source search -> browser handover -> API/CLI
  substitute -> acquire CLI -> ask one decisive question -> declare boundary. Use whenever an agent
  is about to say it cannot do something, when a task needs a third-party login, or when auditing
  transcripts for dead-ends. Not for judging whether a topic is sensitive.
descriptionZh: >-
  把「这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论」这类死胡同，重写成可执行的恢复路径。
  死胡同的机械定义是「拒答 + 零出口」：先分类缺口（POLICY / KNOWLEDGE / EXECUTION / AMBIGUITY），
  再按固定阶梯产出经 Zod 校验的恢复计划：复用本机技能 → 多源取证 → 交还浏览器控制权 → 换 API/CLI →
  现装能力 → 只问一个决定性参数 → 声明硬边界。
  触发：agent 要说「做不到/不在能力范围」时、任务需要第三方登录时、需要扫描对话里的死胡同时。
  不用于判断话题敏不敏感。
tags:
  - anti-dead-end
  - capability-gap
  - browser-handover
  - zod
  - refusal-recovery
level: user
agent_created: true
---

# no-dead-end：不许停在「不在我的能力覆盖范围内」

## 1. 这条技能要杀的具体行为

> 「这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。」

它错不在礼貌，错在**是终点**：用户读完这句话，走不了任何下一步。而真实情况通常是三类之一：
缺一个参数、缺一次登录、缺一个还没试过的工具。三类全都有出口。

**死胡同的机械定义（可回归测试，不靠感觉）：**

```
isDeadEnd(text) = 命中拒答句式 AND 文本内零个可执行信号
可执行信号 = URL / 代码块 / 命令 / 路径 / 编号步骤 / 反问 / 「我来/我可以/需要你/下一步」这类承接
```

只要出现任意一个信号，这就不是死胡同，而是「有出口的拒绝」，不需要本技能介入。

## 2. 两道闸门（每次回答前跑）

**闸门 A — 开口前**：任何以「做不到 / 无法 / 不在范围 / 超出能力」起笔的回答，先判断题型：

| 题型 | 判据 | 唯一正确动作 |
|---|---|---|
| `POLICY` | 未授权访问、凭据窃取、绕过访问控制、伪造、直接协助犯罪 | 声明边界 + 给不落在同一风险面的合法替代 |
| `AMBIGUITY` | 缺一个能决定路径的参数 | 只问那一个，给两个候选理解让用户二选一 |
| `EXECUTION` | 需要登录态 / 浏览器 / CLI / 装东西 | 交还控制权或换通道，**立刻开始做** |
| `KNOWLEDGE` | 缺事实、缺最新数据 | 多源取证后回答，标出仍不确定处 |

`EXECUTION` 是绝大多数「不在能力范围」的真身：不是不会，是不会主动接管会话。

**闸门 B — 输出前**：回复里不许出现禁语表里的句子；改由计划里的 `userFacingMessage` 承担。

## 3. 直接调用（脚本化，不靠记规则）

```bash
# 判定一句话是不是死胡同（退出码 1 = 是）
node <repo>/dist/src/cli.js check "这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。"

# 出恢复计划（--json 给机器消费）
node <repo>/dist/src/cli.js plan --ask "那你用 kaggle 去登录，我有账号的" \
  --refusal "这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。"

# 扫一份对话/日志里的所有死胡同
node <repo>/dist/src/cli.js audit transcript.md --json
```

降级开关：`--no-browser`（本机无浏览器）、`--no-network`、`--skill <name>`、`--cli <name>`、`--lang en`。
没有浏览器时 `HANDOVER` 会被自动剔除，首位降级为 `SUBSTITUTE`（API/token），**不会退回拒绝**。

## 4. 交还控制权的硬契约（HANDOVER）

本机可驱动浏览器时，登录场景唯一正确姿势：

1. 先导航到该站点登录页（计划里的 URL，不要只说「你去登录」）。
2. 调 `browser_waiting_for_user_interaction` 把窗口交给用户，理由写明：需要本人完成登录/2FA。
3. 用户回来后**校验会话**（地址栏站点 + 账号菜单/头像，或会话 cookie 存在），不许假设已登录。
4. 接着执行原任务，不要在登录完成后重新问一遍需求。

红线：**永远不要让用户在聊天里粘贴密码**。用户说「我有账号的」指的是「你可以借用我的会话」，不是交出凭据。

## 5. 实测案例（2026-11-21，WorkBuddy 截图）

输入：用户说「那你用 kaggle 去登录，我有账号的」，模型回「不在我的能力覆盖范围内」。

分类 `EXECUTION`（信号 `needs-auth:login` / `needs-auth:account`），产出：

- 首选 `HANDOVER`：打开 `https://www.kaggle.com/account/login` → 交还窗口 → 登录后校验 → 继续原任务
- 次选 `SUBSTITUTE`：`kaggle.json` 放 `~/.kaggle/`，用 kaggle CLI 取数/提交，可复跑
- 三选 `REUSE_SKILL`：先 grep 本机 `capability-index/INDEX.md`
- 四选 `ACQUIRE`：装 kaggle / playwright CLI

替代回复：「这不是能力边界，是凭据边界：浏览器我能驱动，但 Kaggle 的登录态必须由你本人建立。我这就打开 …, 把窗口交给你登录 …」

## 6. 硬边界（本技能不允许被用来「硬做」）

- 不代持密码、不索取验证码、不复制他人 cookie。
- `access-control-bypass`（绕过验证码/风控/付费墙）、`forgery`、`credential-theft` 一律 `DECLARE_BOUNDARY`，
  且必须写 `policyBasis`（schema 强制），并给出合法替代。
- 声明边界 ≠ 死胡同：必须带替代路径 + 一个能推进的问题。

## 7. 与现有技能的关系

- `capability-index`：负责「有没有现成的」→ 本技能的 `REUSE_SKILL` 直接引用它。
- `ai-capability-validation`：负责「接进来的能力是不是真在工作」→ 本技能每条候选都带 `verification`，判定标准同源。
- 本技能只管一件事：**拒绝之前，先把出口找完**。

## 8. 自检清单

- [ ] 这句话是拒答吗？有没有可执行信号？（没有 → 死胡同，改）
- [ ] 缺口是 POLICY 吗？（不是 → 不许直接拒绝）
- [ ] 登录类：URL 给了吗？窗口交还了吗？会话校验了吗？没让用户发密码吗？
- [ ] 回复里有没有禁语表里的任意一句？
- [ ] 下一步是不是一条能立刻执行的动作，而不是一个方向？
