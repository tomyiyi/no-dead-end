import { z } from 'zod';

/**
 * 死胡同禁语表。
 * 这些句子本身不构成错误，错在它们是「终点」：没有指向任何可执行动作。
 * 任何 RecoveryPlan 的 userFacingMessage 一旦命中，schema 直接拒绝。
 */
export const FORBIDDEN_PHRASES = [
  '不在我的能力覆盖范围内',
  '不在我能力覆盖范围内',
  '这个话题目前不在我的能力',
  '没办法就此展开讨论',
  '我无法就此展开',
  '超出我的能力范围，无法',
  'not within my capability',
  "i can't help with that",
  'i cannot discuss that',
] as const;

/** 缺口的真实类型：只有 POLICY 有权直接拒绝。 */
export const GapClassSchema = z.enum(['POLICY', 'KNOWLEDGE', 'EXECUTION', 'AMBIGUITY']);
export type GapClass = z.infer<typeof GapClassSchema>;

/** 恢复阶梯：从成本最低、副作用最小的路开始试。 */
export const StrategySchema = z.enum([
  'REUSE_SKILL',
  'SEARCH',
  'HANDOVER',
  'SUBSTITUTE',
  'ACQUIRE',
  'ASK_ONE_QUESTION',
  'DECLARE_BOUNDARY',
]);
export type Strategy = z.infer<typeof StrategySchema>;

export const EnvironmentInputSchema = z
  .object({
    browser: z.boolean().default(true),
    network: z.boolean().default(true),
    skills: z.array(z.string().min(1)).max(500).default([]),
    cli: z.array(z.string().min(1)).max(200).default([]),
    lang: z.enum(['zh', 'en']).default('zh'),
  })
  .strict();
export type Environment = z.infer<typeof EnvironmentInputSchema>;

export const PlanInputSchema = z
  .object({
    ask: z.string().trim().min(2).max(2000),
    refusal: z.string().trim().max(2000).optional(),
    env: EnvironmentInputSchema.optional(),
  })
  .strict();
export type PlanInput = z.infer<typeof PlanInputSchema>;

export const RecoveryCandidateSchema = z
  .object({
    strategy: StrategySchema,
    /** 为什么这条路能走通：必须是可验证的事实，不是安慰话 */
    rationale: z.string().min(10).max(300),
    /** 一条可直接执行的下一步，含具体对象，不是方向描述 */
    action: z.string().min(8).max(500),
    /** 前置条件：用户要给的凭据 / 要装的 CLI / 要开的网络 */
    requires: z.array(z.string().min(1).max(160)).max(6),
    /** 怎么判定真的成功了，而不是「看起来跑了」 */
    verification: z.string().min(6).max(300),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type RecoveryCandidate = z.infer<typeof RecoveryCandidateSchema>;

export const RecoveryPlanSchema = z
  .object({
    version: z.literal(1),
    deadEnd: z.boolean(),
    gapClass: GapClassSchema,
    /** 从用户诉求里命中的缺口信号，可解释、可复盘 */
    signals: z.array(z.string().min(1).max(40)).max(12),
    candidates: z.array(RecoveryCandidateSchema).min(1).max(5),
    /** 唯一推荐路径 = candidates[0].action */
    nextAction: z.string().min(8).max(500),
    /** 用来替代那句死胡同回复的成品句子 */
    userFacingMessage: z.string().min(10).max(600),
    mustNotSay: z.array(z.string().min(2).max(120)).min(1).max(12),
    policyBasis: z.string().min(6).max(300).optional(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const top = plan.candidates[0];

    if (!top) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'candidates 不能为空', path: ['candidates'] });
      return;
    }

    if (plan.nextAction !== top.action) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'nextAction 必须等于 candidates[0].action（保证推荐路径唯一）',
        path: ['nextAction'],
      });
    }

    const lowered = plan.userFacingMessage.toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (lowered.includes(phrase.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `userFacingMessage 命中了死胡同禁语：「${phrase}」`,
          path: ['userFacingMessage'],
        });
      }
    }

    const seen = new Set<string>();
    plan.candidates.forEach((candidate, i) => {
      if (seen.has(candidate.strategy)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `候选路径重复：${candidate.strategy}`,
          path: ['candidates', i, 'strategy'],
        });
      }
      seen.add(candidate.strategy);

      const next = plan.candidates[i + 1];
      if (next && next.confidence > candidate.confidence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'candidates 必须按 confidence 降序排列',
          path: ['candidates', i + 1, 'confidence'],
        });
      }
    });

    if (plan.candidates.some((c) => c.strategy === 'DECLARE_BOUNDARY') && !plan.policyBasis) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '声明边界必须给出 policyBasis（依据的是哪条规则）',
        path: ['policyBasis'],
      });
    }

    const handover = plan.candidates.find((c) => c.strategy === 'HANDOVER');
    if (handover && !/https?:\/\//.test(handover.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'HANDOVER 必须给出具体 URL，否则不叫交还控制权，叫把问题退给用户',
        path: ['candidates'],
      });
    }
  });
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;

export const AuditEntrySchema = z
  .object({
    index: z.number().int().nonnegative(),
    text: z.string(),
    matches: z.array(z.string()).min(1),
  })
  .strict();

export const AuditReportSchema = z
  .object({
    total: z.number().int().nonnegative(),
    deadEnds: z.array(AuditEntrySchema),
  })
  .strict();
export type AuditReport = z.infer<typeof AuditReportSchema>;
