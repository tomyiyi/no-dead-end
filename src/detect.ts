import { AuditReportSchema, type AuditReport } from './schema.js';

type Pattern = { label: string; re: RegExp };

/**
 * 拒答的「形态」识别：不判断话题敏不敏感，只判断这句话是不是承认做不了。
 * 中英混写是常态，两套都收。
 */
const REFUSAL_PATTERNS: readonly Pattern[] = [
  { label: 'capability-scope', re: /(不在|超出|不属于)(我|你)?的?能力(覆盖)?范围/ },
  { label: 'cannot-discuss', re: /没(有)?办法(就此|就这个问题|针对这个问题)?(展开|讨论|回答)/ },
  { label: 'cannot-discuss', re: /我(无法|不能|不便)(就此|对此|对这个问题|就这个问题)(展开|讨论|回答|给建议)/ },
  { label: 'out-of-scope', re: /(这个|该)话题(目前)?(不在|超出|不属于)/ },
  { label: 'no-capability', re: /我(目前)?(没有|不具备|暂不具备)(相关|这方面|相应的?)(能力|知识|权限)/ },
  { label: 'apology-refusal', re: /(抱歉|对不起)[^。！？!?\n]{0,24}(无法|不能|没办法|帮不了)/ },
  { label: 'en-scope', re: /not\s+(within|in)\s+my\s+(capability|scope|wheelhouse)/i },
  { label: 'en-scope', re: /(outside|beyond)\s+(of\s+)?my\s+(capabilit|scope|abilities)/i },
  { label: 'en-cannot', re: /i\s+(can\s*not|can't|cannot|am\s+unable\s+to|'m\s+unable\s+to)\s+(discuss|help\s+with|assist\s+with)\s+(that|this|it)/i },
  { label: 'en-cannot', re: /i\s+don't\s+have\s+(the\s+)?(capabilit|ability|access)/i },
];

/**
 * 可执行性信号：只要出现任意一个，这就不是死胡同，而是一个「有出口的拒绝」。
 * 这是整个技能的核心判据 —— 死胡同 = 拒答 + 零出口。
 */
const ACTIONABILITY_PATTERNS: readonly Pattern[] = [
  { label: 'url', re: /https?:\/\/|file:\/\/|www\./i },
  { label: 'question', re: /[?？]/ },
  {
    label: 'offer',
    re: /(我可以|我来|我会|我马上|我先去|需要你|请你|建议你|下一步|要不要我|我帮你|i\s+can\s|i'll\s|i\s+will\s|shall\s+i|would\s+you)/i,
  },
  { label: 'steps', re: /(^|\n)\s*(\d+[.、)]|[-*•])\s+\S/ },
  { label: 'command', re: /```|`[^`\n]{2,}`|\b(npm|npx|curl|git|python3?|brew|gh|ssh|cd)\b/ },
  { label: 'path', re: /(~\/|\/Users\/|\/tmp\/|\.\/)[\w.\-/]+/ },
];

export type RefusalDetection = {
  isRefusal: boolean;
  labels: string[];
  snippets: string[];
};

export function detectRefusal(text: string): RefusalDetection {
  const labels: string[] = [];
  const snippets: string[] = [];

  for (const { label, re } of REFUSAL_PATTERNS) {
    const hit = text.match(re);
    if (!hit) continue;
    if (!labels.includes(label)) labels.push(label);
    const snippet = hit[0].trim();
    if (snippet && !snippets.includes(snippet)) snippets.push(snippet);
  }

  return { isRefusal: labels.length > 0, labels, snippets };
}

export function findActionability(text: string): string[] {
  const found: string[] = [];
  for (const { label, re } of ACTIONABILITY_PATTERNS) {
    if (re.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

/**
 * 死胡同判定：承认做不了，且没有留下任何可执行出口。
 * 注意：这里不评价内容对错，只评价「用户看到这句话之后，能不能往前走一步」。
 */
export function isDeadEnd(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const refusal = detectRefusal(trimmed);
  if (!refusal.isRefusal) return false;
  return findActionability(trimmed).length === 0;
}

/** 扫一份对话/日志，按空行切段，逐段判定。 */
export function auditText(raw: string): AuditReport {
  const blocks = raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const deadEnds: AuditReport['deadEnds'] = [];

  blocks.forEach((block, index) => {
    if (!isDeadEnd(block)) return;
    const { snippets } = detectRefusal(block);
    deadEnds.push({
      index,
      text: block.length > 500 ? `${block.slice(0, 500)}…` : block,
      matches: snippets.length > 0 ? snippets : ['refusal'],
    });
  });

  return AuditReportSchema.parse({ total: blocks.length, deadEnds });
}
