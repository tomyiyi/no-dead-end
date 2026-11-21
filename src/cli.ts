#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { auditText, detectRefusal, findActionability, isDeadEnd } from './detect.js';
import { evaluateHookPayload, renderHookOutput } from './hook.js';
import { planRecovery } from './plan.js';
import { renderAudit, renderPlan } from './render.js';
import type { Environment } from './schema.js';

const USAGE = `no-dead-end — 把「不在我的能力范围内」死胡同改造成可执行恢复路径

用法：
  no-dead-end check <文本|->            判定一段回复是不是死胡同；是则退出码 1
  no-dead-end plan --ask "用户诉求" [选项]  产出恢复计划
  no-dead-end audit <文件|-> [--json]     扫一份对话/日志，列出所有死胡同
  no-dead-end hook                       读 stdin 的 hook 负载；命中死胡同输出 block 并退出 2
  no-dead-end install-hooks [--dry-run]  把 hook 写进 ~/.gemini/settings.json（先备份）

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

  if (command === 'hook') {
    const raw = readStdin().trim();
    if (!raw) return 0;
    const hostIndex = argv.indexOf('--host');
    const host = hostIndex >= 0 ? argv[hostIndex + 1] : 'gemini';
    const isAntigravity = host === 'antigravity';
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { text: raw };
    }
    const decision = evaluateHookPayload(payload);
    if (!decision.block) return 0;
    console.log(renderHookOutput(decision, isAntigravity ? 'antigravity' : 'gemini'));
    // agy 把非 0 退出码当作 hook 故障并放行，所以必须用 0 + decision=block
    return isAntigravity ? 0 : 2;
  }

  if (command === 'install-hooks') {
    const dryRun = argv.includes('--dry-run');
    const hostIndex = argv.indexOf('--host');
    const host = hostIndex >= 0 ? argv[hostIndex + 1] : 'antigravity';

    // Antigravity（agy）= PreToolUse / PostToolUse / Stop，配置在 ~/.gemini/config/hooks.json
    // Gemini CLI = settings.json 里的 hooks.AfterAgent
    const isAntigravity = host !== 'gemini';
    const commandLine = isAntigravity
      ? `node ${fileURLToPath(import.meta.url)} hook --host antigravity`
      : `node ${fileURLToPath(import.meta.url)} hook`;
    const file = isAntigravity
      ? join(homedir(), '.gemini', 'config', 'hooks.json')
      : join(homedir(), '.gemini', 'settings.json');

    const current = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
      : {};

    if (isAntigravity) {
      if (current['no-dead-end']) {
        console.log(`${file} 里已有 no-dead-end 分组，跳过。`);
        return 0;
      }
      const next = {
        ...current,
        'no-dead-end': {
          Stop: [{ type: 'command', command: commandLine, timeout: 10 }],
        },
      };
      if (dryRun) {
        console.log(JSON.stringify(next['no-dead-end'], null, 2));
        return 0;
      }
      const backup = existsSync(file)
        ? `${file}.bak-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '')}`
        : '';
      if (backup) copyFileSync(file, backup);
      const tmp = `${file}.tmp-${process.pid}`;
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      JSON.parse(readFileSync(tmp, 'utf8'));
      renameSync(tmp, file);
      console.log(`已写入 Stop hook：${file}`);
      if (backup) console.log(`备份：${backup}`);
      return 0;
    }

    const hooks = (current['hooks'] ?? {}) as Record<string, unknown>;
    const after = Array.isArray(hooks['AfterAgent']) ? (hooks['AfterAgent'] as unknown[]) : [];
    if (JSON.stringify(after).includes('no-dead-end') || JSON.stringify(after).includes(commandLine)) {
      console.log('hook 已存在，跳过。');
      return 0;
    }

    const next = {
      ...current,
      hooks: {
        ...hooks,
        AfterAgent: [...after, { matcher: '*', hooks: [{ type: 'command', command: commandLine }] }],
      },
    };

    if (dryRun) {
      console.log(JSON.stringify(next['hooks'], null, 2));
      console.log('\n--dry-run：没有写入。');
      return 0;
    }

    const backup = `${file}.bak-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '')}`;
    copyFileSync(file, backup);
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
    console.log(`已写入 AfterAgent hook：${file}`);
    console.log(`备份：${backup}`);
    return 0;
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
