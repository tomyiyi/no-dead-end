/**
 * POLICY 判定：不是"看起来敏感"，而是"能不能指到一条具体规则"。
 * 每条信号都要能说出依据（basis），说不出来就不算 POLICY——那就该走 EXECUTION/KNOWLEDGE。
 */

export type PolicyCategory =
  | 'credential-theft'
  | 'account-marketplace'
  | 'access-bypass'
  | 'forgery'
  | 'harm'
  | 'privacy';

type Signal = {
  category: PolicyCategory;
  label: string;
  weight: number;
  basis: string;
  re: RegExp;
};

const SIGNALS: readonly Signal[] = [
  {
    category: 'credential-theft',
    label: 'crack-credentials',
    weight: 0.95,
    basis: '未授权访问他人账号属于凭据窃取',
    re: /破解.{0,6}(账号|帐号|账户|密码)|盗号|撞库|窃取.{0,6}(密码|cookie|token|凭据)|盗用.{0,4}(账号|帐号)/i,
  },
  {
    category: 'account-marketplace',
    label: 'buy-shared-account',
    weight: 0.92,
    basis: '买卖共享或来源不明的账号，本质是交易他人凭据',
    re: /(买|购买|收|出售|卖|租|搞|弄|找).{0,20}(共享账号|共享帐号|成品号|号池|白号|黑号|老号|新号|账号|帐号|账户)|共享.{0,8}(账号|帐号|账户)|(账号|帐号|账户).{0,8}共享/,
  },
  {
    category: 'account-marketplace',
    label: 'vendor-site',
    weight: 0.9,
    basis: '发卡站/接码站/号站属于账号与验证码的灰色交易渠道',
    re: /发卡(站|网|平台)?|卡密|接码(平台|站|码)?|号站|养号|代实名|实名代过|过实名/,
  },
  {
    category: 'account-marketplace',
    label: 'family-group-ride',
    weight: 0.85,
    basis: '拼车/家庭组共享订阅违反服务条款，且账号会被随时收回',
    re: /(家庭组|拼车|车队).{0,8}(买|租|拼|上车|拼单)|(买|租|拼|上).{0,8}(家庭组|拼车|车队)/,
  },
  {
    category: 'access-bypass',
    label: 'captcha-bypass',
    weight: 0.88,
    basis: '规避平台的访问控制与反自动化机制',
    re: /绕过.{0,6}(验证码|captcha|风控|付费墙|登录墙)|破解.{0,4}(验证码|风控)/i,
  },
  {
    category: 'forgery',
    label: 'fake-documents',
    weight: 0.95,
    basis: '伪造证件、票据或流水属于违法行为',
    re: /伪造.{0,6}(身份证|证件|流水|发票|合同|公章|签名)/,
  },
  {
    category: 'harm',
    label: 'violent-harm',
    weight: 0.97,
    basis: '直接协助实施犯罪',
    re: /制毒|洗钱|诈骗脚本|钓鱼页面|盗刷|勒索(软件|病毒)/,
  },
  {
    category: 'privacy',
    label: 'doxxing',
    weight: 0.9,
    basis: '人肉搜索与批量获取他人隐私信息侵犯个人信息权益',
    re: /人肉(搜索|开盒)|开盒|查.{0,4}(身份证号|家庭住址|手机号).{0,4}(本人|别人|他人)/,
  },
];

export type PolicyVerdict = {
  hit: boolean;
  category: PolicyCategory | 'none';
  basis: string;
  score: number;
  evidence: string[];
};

/** 低于这个分不判 POLICY：宁可多走一步，也不要拿"敏感"当拒绝的借口。 */
const THRESHOLD = 0.8;

export function detectPolicy(ask: string): PolicyVerdict {
  let best: Signal | undefined;
  const evidence: string[] = [];

  for (const signal of SIGNALS) {
    const match = ask.match(signal.re);
    if (!match) continue;
    evidence.push(`${signal.label}:${match[0]}`);
    if (!best || signal.weight > best.weight) best = signal;
  }

  if (!best || best.weight < THRESHOLD) {
    return { hit: false, category: 'none', basis: '', score: best?.weight ?? 0, evidence };
  }

  return {
    hit: true,
    category: best.category,
    basis: best.basis,
    score: best.weight,
    evidence,
  };
}
