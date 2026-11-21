import { existsSync, readFileSync } from 'node:fs';
import { isDeadEnd } from './detect.js';

/** 这些键是元数据或用户输入，不是助手回复；扫进去会造成误判。 */
const SKIP_KEYS = new RegExp(
  '^(cwd|path|file|command|args|timestamp|session_id|transcript_path|tool_name|' +
    'lastUserInput|transcriptPath|cwd|workspacePaths|artifactDirectoryPath|conversationId|' +
    'modelName|hookEventName|terminationReason|error|continuationActive|fullyIdle|' +
    'executionNum|artifactDirectoryPath)$',
);

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
      if (SKIP_KEYS.test(key)) continue;
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

type TranscriptLine = {
  source?: string;
  type?: string;
  content?: unknown;
};

/** 从 transcriptPath 指向的 JSONL 里取助手最近的消息文本（最多 5 条）。 */
export function readTranscriptReplies(payload: unknown): string[] {
  const path =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)['transcriptPath']
      : undefined;
  if (typeof path !== 'string' || !existsSync(path)) return [];

  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').trim().split('\n');
  } catch {
    return [];
  }

  const replies: string[] = [];
  for (const line of lines.slice(-12).reverse()) {
    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    if (entry.source !== 'MODEL') continue;
    if (typeof entry.content !== 'string' || entry.content.trim().length < 6) continue;
    replies.push(entry.content);
    if (replies.length >= 5) break;
  }
  return replies;
}

export function evaluateHookPayload(payload: unknown): HookDecision {
  // Antigravity 的 Stop 负载不带回复正文，只给 transcriptPath；只看最新一条助手输出。
  // 若把前几轮也扫进去，被拦下的旧回复会一直留在 transcript 里，导致无限 block（实测）。
  const replyTexts = readTranscriptReplies(payload);
  const texts = replyTexts.length > 0 ? [replyTexts[0] as string] : collectStrings(payload);
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

export function renderHookOutput(decision: HookDecision, host: 'gemini' | 'claude' | 'antigravity'): string {
  if (!decision.block) return '';
  if (host === 'claude' || host === 'antigravity') {
    // Claude Code / Antigravity（agy）: 退出码 0 + decision=block 才会真正续跑；
    // 退出码 2 会被当成 hook 执行出错，直接放行停止（实测）。
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
