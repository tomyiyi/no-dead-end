import type { AuditReport, RecoveryPlan, Strategy } from './schema.js';

const STRATEGY_LABEL: Record<Strategy, string> = {
  REUSE_SKILL: '复用本机技能',
  SEARCH: '多源取证',
  HANDOVER: '交还浏览器控制权',
  SUBSTITUTE: '换 API/CLI 通道',
  ACQUIRE: '现装能力',
  ASK_ONE_QUESTION: '只问一个决定性参数',
  DECLARE_BOUNDARY: '声明硬边界（唯一允许拒绝的情形）',
};

const GAP_LABEL: Record<RecoveryPlan['gapClass'], string> = {
  POLICY: '真正的硬边界（政策/违法）',
  KNOWLEDGE: '缺事实，不缺能力',
  EXECUTION: '缺会话/工具动作，可执行',
  AMBIGUITY: '缺一个参数',
};

export function renderPlan(plan: RecoveryPlan): string {
  const lines: string[] = [];
  const top = plan.candidates[0];

  lines.push('== no-dead-end 恢复计划 ==');
  lines.push(`缺口类型：${GAP_LABEL[plan.gapClass]}（${plan.gapClass}）`);
  lines.push(`原话是否死胡同：${plan.deadEnd ? '是 —— 拒答且零出口' : '否'}`);
  if (plan.signals.length > 0) lines.push(`命中信号：${plan.signals.join(' / ')}`);
  if (plan.policyBasis) lines.push(`政策依据：${plan.policyBasis}`);
  lines.push('');

  lines.push(`推荐下一步（${STRATEGY_LABEL[top?.strategy ?? 'REUSE_SKILL']}）：`);
  lines.push(`  ${plan.nextAction}`);
  lines.push('');

  lines.push('候选路径（按可行性降序）：');
  plan.candidates.forEach((candidate, index) => {
    lines.push(
      `  ${index + 1}. [${candidate.strategy}] 置信度 ${candidate.confidence.toFixed(2)} — ${STRATEGY_LABEL[candidate.strategy]}`,
    );
    lines.push(`     为什么行：${candidate.rationale}`);
    lines.push(`     动作：${candidate.action}`);
    if (candidate.requires.length > 0) lines.push(`     前置：${candidate.requires.join('；')}`);
    lines.push(`     验收：${candidate.verification}`);
  });
  lines.push('');

  lines.push('可直接回给用户的话：');
  lines.push(`  ${plan.userFacingMessage}`);
  lines.push('');
  lines.push('禁止说法：');
  lines.push(`  ${plan.mustNotSay.join(' | ')}`);

  return lines.join('\n');
}

export function renderAudit(report: AuditReport): string {
  if (report.deadEnds.length === 0) {
    return `== 扫描完成：${report.total} 段，未发现死胡同 ==`;
  }
  const lines = [`== 扫描完成：${report.total} 段，发现 ${report.deadEnds.length} 处死胡同 ==`];
  report.deadEnds.forEach((entry, i) => {
    lines.push('');
    lines.push(`[${i + 1}] 第 ${entry.index + 1} 段（命中：${entry.matches.join(' / ')}）`);
    lines.push(entry.text);
  });
  return lines.join('\n');
}
