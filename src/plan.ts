import {
  EnvironmentInputSchema,
  PlanInputSchema,
  RecoveryPlanSchema,
  type Environment,
  type GapClass,
  type RecoveryCandidate,
  type RecoveryPlan,
} from './schema.js';
import { isDeadEnd } from './detect.js';
import { detectPolicy } from './policy.js';

type Site = {
  key: string;
  name: string;
  url: string;
  loginNote: string;
  api?: string;
};

const SITES: readonly Site[] = [
  {
    key: 'kaggle',
    name: 'Kaggle',
    url: 'https://www.kaggle.com/account/login',
    loginNote: '邮箱密码或 Google 账号登录，2FA 由你本人输入',
    api: '在 https://www.kaggle.com/settings → Create New Token 下载 kaggle.json 放到 ~/.kaggle/，之后用 kaggle CLI 取数据集、交提交',
  },
  {
    key: 'github',
    name: 'GitHub',
    url: 'https://github.com/login',
    loginNote: '密码 + 设备验证码由你本人输入',
    api: '用 gh auth login，或把细粒度 PAT 写进环境变量，走 gh / REST API',
  },
  {
    key: 'huggingface',
    name: 'Hugging Face',
    url: 'https://huggingface.co/login',
    loginNote: '密码或 OAuth 登录',
    api: '在账号 Settings → Access Tokens 建只读 token，导出 HF_TOKEN 后走 huggingface-cli',
  },
  {
    key: 'xiaohongshu',
    name: '小红书',
    url: 'https://www.xiaohongshu.com',
    loginNote: '扫码或手机号验证码登录（我登不了，只能你扫）',
  },
  {
    key: 'weixin',
    name: '微信公众平台',
    url: 'https://mp.weixin.qq.com',
    loginNote: '必须你本人扫码，二维码 5 分钟过期',
  },
  {
    key: 'xueqiu',
    name: '雪球',
    url: 'https://xueqiu.com',
    loginNote: '手机号验证码或账号密码登录',
  },
  {
    key: 'notion',
    name: 'Notion',
    url: 'https://www.notion.so/login',
    loginNote: '邮箱验证码或 Google 登录',
    api: '建 internal integration token，走官方 API',
  },
  {
    key: 'lark',
    name: '飞书',
    url: 'https://www.feishu.cn',
    loginNote: '扫码或企业 SSO 登录',
  },
];

const LOGIN_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'login', re: /登[录陆]/ },
  { label: 'account', re: /账号|帐号|帐户|账户/ },
  { label: 'password', re: /密码/ },
  { label: '2fa', re: /验证码|2fa|双因子|两步验证|二次验证/i },
  { label: 'oauth', re: /oauth|单点登录|sso/i },
  { label: 'token', re: /api\s*token|access\s*token|token/i },
  { label: 'cookie', re: /cookie|会话/i },
];

const KNOWLEDGE_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'freshness', re: /最新|今天|昨天|本周|实时|现在|当前/ },
  { label: 'market', re: /行情|股价|汇率|金价|油价/ },
  { label: 'news', re: /新闻|公告|政策|发布/ },
  { label: 'fact', re: /多少|几家|排名|数据|统计/ },
];

const AMBIGUITY_PATTERNS: readonly { label: string; re: RegExp }[] = [
  { label: 'vague-pronoun', re: /^(那个|这个|它|继续|接着)/ },
  { label: 'you-know', re: /你懂的|看着办|随便|搞一下/ },
];

function clip(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function extractSite(ask: string): Site | null {
  const urlHit = ask.match(/https?:\/\/[^\s"'）)】]+/i);
  if (urlHit?.[0]) {
    const raw = urlHit[0];
    let host = '';
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      host = '';
    }
    const knownByHost = host ? SITES.find((site) => host.includes(site.key)) : undefined;
    if (knownByHost) return knownByHost;
    if (host) {
      return {
        key: host,
        name: host,
        url: `https://${host}`,
        loginNote: '需要你本人登录，我不代持密码',
      };
    }
  }

  const lowered = ask.toLowerCase();
  return (
    SITES.find((site) => lowered.includes(site.key)) ??
    SITES.find((site) => ask.includes(site.name)) ??
    null
  );
}

function classify(ask: string): { gapClass: GapClass; signals: string[] } {
  const policy = detectPolicy(ask);
  if (policy.hit) {
    return { gapClass: 'POLICY', signals: policy.evidence.map((item) => `policy:${item}`) };
  }

  const login = LOGIN_PATTERNS.filter((p) => p.re.test(ask));
  if (login.length > 0) {
    return { gapClass: 'EXECUTION', signals: login.map((p) => `needs-auth:${p.label}`) };
  }

  const ambiguity = AMBIGUITY_PATTERNS.filter((p) => p.re.test(ask));
  if (ask.trim().length < 6 || ambiguity.length > 0) {
    return {
      gapClass: 'AMBIGUITY',
      signals: ambiguity.length > 0 ? ambiguity.map((p) => `ambiguous:${p.label}`) : ['ambiguous:too-short'],
    };
  }

  const knowledge = KNOWLEDGE_PATTERNS.filter((p) => p.re.test(ask));
  if (knowledge.length > 0) {
    return { gapClass: 'KNOWLEDGE', signals: knowledge.map((p) => `needs-facts:${p.label}`) };
  }

  // 默认不是「不会」，而是「还没试过」。宁可多走一步，也不要停在拒绝上。
  return { gapClass: 'EXECUTION', signals: ['needs-action:unclassified'] };
}

function handoverCandidate(site: Site, ask: string, env: Environment): RecoveryCandidate {
  const askLabel = clip(ask);
  return {
    strategy: 'HANDOVER',
    rationale:
      `本机可以驱动浏览器，卡住的不是能力而是会话：${site.name} 的登录态只能由你本人建立。` +
      '把窗口交给你登录，登录完我接着跑，这条链路是通的。',
    action:
      `浏览器导航到 ${site.url} → 调 browser_waiting_for_user_interaction 把控制权交给你完成登录（${site.loginNote}）` +
      ` → 你确认后校验会话（页面出现账号菜单/头像，或 cookie 存在） → 继续执行「${askLabel}」`,
    requires: ['你在弹出窗口里完成登录与 2FA', '不要在聊天里粘贴密码；只需要你点登录'],
    verification: `地址栏仍匹配 ${site.key} 且页面出现账号头像/菜单；或读取到会话 cookie`,
    confidence: env.browser ? 0.86 : 0.2,
  };
}

function substituteCandidate(site: Site, ask: string, env: Environment): RecoveryCandidate {
  const apiHint = site.api ?? `${site.name} 的官方 API / 导出功能（在账号设置里生成只读凭据）`;
  return {
    strategy: 'SUBSTITUTE',
    rationale:
      '如果不方便让我碰浏览器，同一条链路可以走 API/CLI：不需要 UI 登录，只需要你签发一次凭据，后续可复跑。',
    action: `${apiHint}；凭据落到本机配置后，用它执行「${clip(ask)}」`,
    requires: [
      '你签发只读凭据（token / kaggle.json / PAT）',
      ...(env.network ? [] : ['本机网络需可达目标 API']),
    ],
    verification: '用最小只读请求打一次接口，返回 200 且数据字段非空（不要用「没报错」当成功）',
    confidence: env.network ? 0.64 : 0.3,
  };
}

function reuseSkillCandidate(env: Environment): RecoveryCandidate {
  const known = env.skills.slice(0, 3).join(' / ');
  return {
    strategy: 'REUSE_SKILL',
    rationale:
      '本机技能库里有现成实现时，重新造轮子就是浪费：先检索再决定写不写（capability-index 铁律）。',
    action:
      'grep -n -i -E "<站点名>|<动作关键词>" ~/.workbuddy/skills/capability-index/INDEX.md；' +
      '命中则读该技能 SKILL.md 直接用，未命中的话换 3 组同义词再下结论',
    requires: known ? [`本机已装技能：${known}`] : ['本机技能索引存在'],
    verification: 'INDEX.md 有命中行且对应 SKILL.md 可读；空结果要截图/输出留证，不能凭感觉说「没有」',
    confidence: 0.5,
  };
}

function acquireCandidate(env: Environment): RecoveryCandidate {
  return {
    strategy: 'ACQUIRE',
    rationale: '能力可以现装：CLI 或技能装上之后，这个任务就变成常规操作，而不是「做不到」。',
    action: '确认缺哪个 CLI/技能（如 kaggle、gh、playwright），用 brew/npm/pip 装上，再把命令跑通一次',
    requires: env.network ? ['本机可访问包管理器'] : ['本机网络可达包源（当前标记为不可达）'],
    verification: '装完执行 `<cli> --version` 与一次真实最小调用，两个都成功才算装上',
    confidence: env.network ? 0.42 : 0.1,
  };
}

function searchCandidate(env: Environment): RecoveryCandidate {
  return {
    strategy: 'SEARCH',
    rationale: '缺的是事实，不是能力：先取到可核查的来源，再回答，别拿猜测顶。',
    action: '用 WebSearch 取一手来源（官网/公告/财报），同时检索本地 wiki 与知识库做交叉验证，两者冲突时以一手来源为准',
    requires: env.network ? ['联网可达'] : ['本地知识库已就绪（网络当前不可达）'],
    verification: '至少两条独立来源一致；对不上的地方标注不确定，不要补全成确定句',
    confidence: env.network ? 0.62 : 0.35,
  };
}

function askCandidate(ask: string): RecoveryCandidate {
  return {
    strategy: 'ASK_ONE_QUESTION',
    rationale: '这里缺的是一个参数，不是能力。问一个能直接决定执行路径的问题，比拒绝有用。',
    action: `用一句话确认缺失的槽位（目标站点/时间范围/口径），基于「${clip(ask, 40)}」给出两个候选理解让用户选`,
    requires: ['用户回答一个二选一'],
    verification: '用户答复能直接映射到具体命令/URL；仍然含糊就换一种问法，不要重复原问题',
    confidence: 0.55,
  };
}

function boundaryCandidate(ask: string): { candidate: RecoveryCandidate; basis: string } {
  const hit = detectPolicy(ask);
  const basis = hit.hit && hit.basis ? hit.basis : '该请求涉及未授权访问或违法协助';
  return {
    basis,
    candidate: {
      strategy: 'DECLARE_BOUNDARY',
      rationale: `这条不做的理由是可命名的规则，不是「能力不够」：${basis}。`,
      action: '说明依据的那条规则 + 给出不落在同一风险面的合法替代（本人账号找回、官方授权 API、只读凭据），让用户选',
      requires: ['用户选择合法替代路径'],
      verification: '替代路径里不包含绕过鉴权/伪造/未授权访问；用户接受后按新路径执行',
      confidence: 0.9,
    },
  };
}

function buildMessage(
  gapClass: GapClass,
  site: Site | null,
  ask: string,
  env: Environment,
): string {
  const askLabel = clip(ask);
  const en = env.lang === 'en';

  if (gapClass === 'POLICY') {
    return en
      ? 'I can\'t take that route — it is unauthorized access or forgery, which I won\'t assist with. What I can do instead: the account owner\'s official recovery/authorization flow, or a read-only token issued by the platform. Which one do you want?'
      : `这条路我不走：它属于未授权访问或伪造类操作。能走的替代有两条——① 账号本人的官方找回/重置流程（我可以带你走一遍）；② 平台签发的只读凭据/官方 API。你选哪条？`;
  }

  if (gapClass === 'KNOWLEDGE') {
    return en
      ? `I don't have this from memory, but it's checkable. I'll pull the primary sources (official site / filing) and cross-check them against your local wiki, then answer with the gaps marked. If you have a specific window or source you trust more, tell me and I'll anchor on it.`
      : `这个我记不准，但可以查到准的：我去取一手来源（官网/公告/财报），同时交叉本地 wiki，再给你答案并标出仍不确定的部分。你如果有指定的时间窗口或更信任的来源，告诉我，我按它对齐。`;
  }

  if (gapClass === 'AMBIGUITY') {
    return en
      ? `I can act as soon as one slot is filled: is it ${askLabel} on a specific site, or on files you already have here? Pick one and I'll start.`
      : `我缺一个参数就能动手：「${askLabel}」是要在某个站点上做，还是基于本机已有的文件做？你选一个，我立刻开始。`;
  }

  if (site) {
    if (!env.browser) {
      return en
        ? `No browser session here, but this is still solvable: issue a read-only token for ${site.name} and I'll run the API route. Details: ${site.api ?? 'create a read-only token in account settings'}.`
        : `本机这次没有可驱动的浏览器，但路没断：你在 ${site.name} 账号设置里签发一个只读凭据（${site.api ?? '官方 API token'}），我走 API/CLI 把「${askLabel}」做完。`;
    }
    return en
      ? `This isn't a capability wall, it's a credential wall: I can drive the browser, but the session has to be yours. I'll open ${site.name}, hand the window over for you to sign in (2FA included), then continue with "${askLabel}". Don't paste your password into chat — you just click sign in.`
      : `这不是能力边界，是凭据边界：浏览器我能驱动，但 ${site.name} 的登录态必须由你本人建立。我这就打开 ${site.url}，把窗口交给你登录（${site.loginNote}），登录完成后我接着做「${askLabel}」。密码不用发我，你只要点登录。`;
  }

  return en
    ? `I can't do it blind, but I can do it in one move: give me the target site or file, and I'll run it end to end and show you the result.`
    : `这件事我不是不做，是需要一个落点：给我目标站点或文件路径，我直接跑完把结果给你，不来回问。`;
}

/**
 * 核心入口：吃「用户诉求 +（可选）模型原话」，吐出恢复计划。
 * 所有入口数据过 Zod，输出再过一次 Zod，保证不会吐出一份「看起来像方案」的空话。
 */
export function planRecovery(raw: unknown): RecoveryPlan {
  const input = PlanInputSchema.parse(raw);
  const env: Environment = EnvironmentInputSchema.parse(input.env ?? {});
  const ask = input.ask.trim();

  const { gapClass, signals } = classify(ask);
  const site = extractSite(ask);
  const candidates: RecoveryCandidate[] = [];
  let policyBasis: string | undefined;

  if (gapClass === 'POLICY') {
    const boundary = boundaryCandidate(ask);
    candidates.push(boundary.candidate);
    policyBasis = boundary.basis;
  } else if (gapClass === 'AMBIGUITY') {
    candidates.push(askCandidate(ask), reuseSkillCandidate(env));
  } else if (gapClass === 'KNOWLEDGE') {
    candidates.push(searchCandidate(env), reuseSkillCandidate(env));
  } else {
    if (site && env.browser) candidates.push(handoverCandidate(site, ask, env));
    if (site) candidates.push(substituteCandidate(site, ask, env));
    candidates.push(reuseSkillCandidate(env), acquireCandidate(env));
  }

  const ordered = candidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  const top = ordered[0];
  if (!top) {
    throw new Error('规划器没有产出任何候选路径：这是实现缺陷，不允许静默降级成拒绝');
  }

  const deadEnd = input.refusal ? isDeadEnd(input.refusal) : false;

  const plan: RecoveryPlan = {
    version: 1,
    deadEnd,
    gapClass,
    signals: signals.slice(0, 12),
    candidates: ordered,
    nextAction: top.action,
    userFacingMessage: buildMessage(gapClass, site, ask, env),
    mustNotSay: [
      '不在我的能力覆盖范围内',
      '没办法就此展开讨论',
      '这个话题目前不在我的能力覆盖范围内，我没有办法就此展开讨论。',
      "I can't help with that.",
    ],
    ...(policyBasis ? { policyBasis } : {}),
  };

  return RecoveryPlanSchema.parse(plan);
}
