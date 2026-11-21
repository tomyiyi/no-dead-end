#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { auditText, detectRefusal, findActionability, isDeadEnd } from './detect.js';
import { planRecovery } from './plan.js';
import { renderAudit, renderPlan } from './render.js';
import type { Environment } from './schema.js';

const USAGE = `no-dead-end — 把「不在我的能力范围内」死胡同改造成可执行恢复路径

用法：
  no-dead-end check <文本|->            判定一段回复是不是死胡同；是则退出码 1
  no-dead-end plan --ask "用户诉求" [选项]  产出恢复计划
  no-dead-end audit <文件|-> [--json]     扫一份对话/日志，列出所有死胡同

plan 选项：
  --ask <text>        用户原始诉求（必填）
  --refusal <text>    模型刚才那句拒绝（用于判定 deadEnd）
  --no-browser        本机无可用浏览器
  --no-network        本机网络不可达
  --skill <name>      本机已装技能（可重复）
  --cli <name>        本机已装 CLI（可重复）
  --lang <zh|en>      输出语言，默认 zh
  --json              以 JSON 输出

退出码：0 正常 / 1 发现死胡同 / 2 参数或校验失败`;

type PlanFlags = {
  ask: string;
  refusal?: string;
  json: boolean;
  env: Environment;
};

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function inputOrStdin(args: string[]): string {
  const joined = args.join(' ').trim();
  if (joined && joined !== '-') return joined;
  return readStdin();
}

function parsePlanFlags(args: string[]): PlanFlags {
  const env: Environment = {
    browser: true,
    network: true,
    skills: [],
    cli: [],
    lang: 'zh',
  };
  const flags: PlanFlags = { ask: '', json: false, env };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--ask':
        if (!next) throw new Error('--ask 需要一个值');
        flags.ask = next;
        i += 1;
        break;
      case '--refusal':
        if (!next) throw new Error('--refusal 需要一个值');
        flags.refusal = next;
        i += 1;
        break;
      case '--no-browser':
        env.browser = false;
        break;
      case '--no-network':
        env.network = false;
        break;
      case '--skill':
        if (!next) throw new Error('--skill 需要一个值');
        env.skills.push(next);
        i += 1;
        break;
      case '--cli':
        if (!next) throw new Error('--cli 需要一个值');
        env.cli.push(next);
        i += 1;
        break;
      case '--lang': {
        if (next !== 'zh' && next !== 'en') throw new Error('--lang 只接受 zh 或 en');
        env.lang = next;
        i += 1;
        break;
      }
      case '--json':
        flags.json = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (!flags.ask.trim()) throw new Error('缺少 --ask（用户原始诉求）');
  return flags;
}

function main(): number {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'check') {
    const text = inputOrStdin(argv.slice(1));
    if (!text.trim()) {
      console.error('没有输入。用法：no-dead-end check "回复文本"');
      return 2;
    }
    const refusal = detectRefusal(text);
    const actionability = findActionability(text);
    const deadEnd = isDeadEnd(text);
    console.log(
      JSON.stringify({ deadEnd, refusal: refusal.isRefusal, labels: refusal.labels, actionability }, null, 2),
    );
    return deadEnd ? 1 : 0;
  }

  if (command === 'plan') {
    const flags = parsePlanFlags(argv.slice(1));
    const plan = planRecovery({ ask: flags.ask, refusal: flags.refusal, env: flags.env });
    console.log(flags.json ? JSON.stringify(plan, null, 2) : renderPlan(plan));
    return 0;
  }

  if (command === 'audit') {
    const rest = argv.slice(1);
    const json = rest.includes('--json');
    const target = rest.find((arg) => !arg.startsWith('--'));
    const raw = !target || target === '-' ? readStdin() : readFileSync(target, 'utf8');
    if (!raw.trim()) {
      console.error('没有可扫描内容。用法：no-dead-end audit <文件|->');
      return 2;
    }
    const report = auditText(raw);
    console.log(json ? JSON.stringify(report, null, 2) : renderAudit(report));
    return report.deadEnds.length > 0 ? 1 : 0;
  }

  console.error(`未知命令：${command}\n`);
  console.error(USAGE);
  return 2;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof ZodError) {
    console.error('输入校验失败：');
    for (const issue of error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  } else if (error instanceof Error) {
    console.error(`失败：${error.message}`);
  } else {
    console.error('失败：未知错误');
  }
  process.exitCode = 2;
}
