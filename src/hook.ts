import { isDeadEnd } from './detect.js';

/**
 * 把 hook 负载里所有像"回复内容"的字符串挖出来，逐个判定。
 * 不假设宿主字段名：Gemini CLI / Claude Code / 自研宿主都可能用不同的键。
 */
export function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return out;
  if (typeof value === 'string') {
    if (value.trim().length >= 20) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // 跳过明显不是回复内容的字段，减少误判
      if (/^(cwd|path|file|command|args|timestamp|session_id|transcript_path|tool_name)$/.test(key)) continue;
      collectStrings(item, out, depth + 1);
    }
  }
  return out;
}

export type HookDecision = {
  block: boolean;
  reason?: string;
  offending?: string;
  nextAction?: string;
};

export function evaluateHookPayload(payload: unknown): HookDecision {
  const texts = collectStrings(payload);
  const offending = texts.find((text) => isDeadEnd(text));
  if (!offending) return { block: false };

  return {
    block: true,
    offending,
    reason:
      '检测到零出口拒答（拒答 + 没有 URL/命令/路径/步骤/反问/承接动作）。' +
      '改成：说明缺的是参数、会话还是事实，并给出一个能立刻执行的动作；需要登录就把浏览器窗口交还给用户。',
    nextAction:
      'node ~/.workbuddy/skills/no-dead-end/dist/src/cli.js plan --ask "<用户原话>" 拿恢复计划，再重写这条回复。',
  };
}

export function renderHookOutput(decision: HookDecision, host: 'gemini' | 'claude'): string {
  if (!decision.block) return '';
  if (host === 'claude') {
    // Claude Code: decision=block 会把 reason 回灌给模型，要求它继续
    return JSON.stringify({ decision: 'block', reason: `${decision.reason}\n${decision.nextAction ?? ''}` }, null, 2);
  }
  // Gemini CLI: systemMessage 回灌 + exit 2
  return JSON.stringify(
    {
      decision: 'block',
      systemMessage: `${decision.reason}\n${decision.nextAction ?? ''}`,
      reason: decision.reason,
    },
    null,
    2,
  );
}
