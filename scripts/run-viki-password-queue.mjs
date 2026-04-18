#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_COOLDOWN_MS = 20 * 60 * 1000;
const DEFAULT_FAIL_COOLDOWN_MS = 45 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 0;
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_GUARD_WINDOW_MS = 6 * 60 * 60 * 1000;
const ARTIFACTS_DIR = path.resolve('artifacts', 'password-change');

const usage = () => {
  console.log(
    [
      'Uso:',
      '  node scripts/run-viki-password-queue.mjs --items-file <arquivo.json> [opcoes]',
      '',
      'Formato do arquivo JSON:',
      '  [',
      '    { "email": "conta@exemplo.com", "newPassword": "novaSenha", "currentPassword": "opcional", "enabled": true }',
      '  ]',
      '',
      'Opcoes:',
      '  --items-file <arquivo>             Arquivo com itens da fila (obrigatorio)',
      '  --cooldown-ms <numero>             Espera entre sucessos (padrao: 20 min)',
      '  --fail-cooldown-ms <numero>        Espera apos falha temporaria (padrao: 45 min)',
      '  --interval-ms <numero>             Repetir ciclos (0 = roda uma vez)',
      '  --max-attempts <numero>            Tentativas internas por conta (padrao: 2)',
      '  --timeout-ms <numero>              Timeout por tentativa de conta (padrao: 90000)',
      '  --guard-window-ms <numero>         Janela anti-repeticao por conta (padrao: 6h)',
      '  --headless                         Forca modo headless no worker',
      '  --no-persistent-profile            Nao usar perfil persistente no worker',
      '  --human-delay-min-ms <numero>      Delay humano minimo no worker',
      '  --human-delay-max-ms <numero>      Delay humano maximo no worker',
      '  --stop-on-hard-fail                Interrompe ciclo em falha definitiva',
      '  --dry-run                          Nao executa, apenas valida fila',
      '  --help                             Mostra esta ajuda'
    ].join('\n')
  );
};

const parseArgs = (argv) => {
  const options = {
    itemsFile: '',
    cooldownMs: DEFAULT_COOLDOWN_MS,
    failCooldownMs: DEFAULT_FAIL_COOLDOWN_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    guardWindowMs: DEFAULT_GUARD_WINDOW_MS,
    headless: false,
    noPersistentProfile: false,
    humanDelayMinMs: 900,
    humanDelayMaxMs: 2200,
    stopOnHardFail: false,
    dryRun: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '').trim();
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--headless') {
      options.headless = true;
      continue;
    }
    if (arg === '--no-persistent-profile') {
      options.noPersistentProfile = true;
      continue;
    }
    if (arg === '--stop-on-hard-fail') {
      options.stopOnHardFail = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    const next = String(argv[i + 1] || '').trim();
    if (!next) throw new Error(`Valor ausente para ${arg}`);

    if (arg === '--items-file') {
      options.itemsFile = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === '--cooldown-ms') {
      options.cooldownMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--fail-cooldown-ms') {
      options.failCooldownMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--interval-ms') {
      options.intervalMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--max-attempts') {
      options.maxAttempts = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--guard-window-ms') {
      options.guardWindowMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--human-delay-min-ms') {
      options.humanDelayMinMs = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--human-delay-max-ms') {
      options.humanDelayMaxMs = Number(next);
      i += 1;
      continue;
    }

    throw new Error(`Argumento nao reconhecido: ${arg}`);
  }

  if (options.help) return options;
  if (!options.itemsFile) throw new Error('Informe --items-file');
  if (!Number.isFinite(options.cooldownMs) || options.cooldownMs < 1000) throw new Error('--cooldown-ms invalido');
  if (!Number.isFinite(options.failCooldownMs) || options.failCooldownMs < 1000) throw new Error('--fail-cooldown-ms invalido');
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 0) throw new Error('--interval-ms invalido');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000) throw new Error('--timeout-ms invalido');
  if (!Number.isFinite(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 3) throw new Error('--max-attempts invalido');
  if (!Number.isFinite(options.guardWindowMs) || options.guardWindowMs < 30000) throw new Error('--guard-window-ms invalido');
  if (!Number.isFinite(options.humanDelayMinMs) || options.humanDelayMinMs < 100) throw new Error('--human-delay-min-ms invalido');
  if (!Number.isFinite(options.humanDelayMaxMs) || options.humanDelayMaxMs < options.humanDelayMinMs) throw new Error('--human-delay-max-ms invalido');

  return options;
};

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatMs = (ms) => {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
};

const ensureArtifactsDir = () => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
};

const loadItems = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
  if (!Array.isArray(list)) return [];

  return list
    .map((item) => ({
      email: String(item?.email || '').trim(),
      newPassword: String(item?.newPassword || '').trim(),
      currentPassword: String(item?.currentPassword || '').trim(),
      enabled: item?.enabled !== false
    }))
    .filter((item) => item.enabled && item.email && item.newPassword);
};

const classifyResultText = (text) => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return 'unknown';
  if (/\[fim\] processo concluido com sucesso|\[ok\] senha atualizada no painel|\[ok\] login validado com a senha solicitada/.test(lower)) {
    return 'success';
  }
  if (/anti-bot|challenge|cloudflare|captcha|temporario|too many requests|429|blocked|rate_limit/.test(lower)) {
    return 'transient';
  }
  if (/senha atual parece incorreta|wrong password|invalid password|incorrect password/.test(lower)) {
    return 'hard';
  }
  if (/nao foi possivel encontrar os campos|botao de mudar senha|formulario de login nao encontrado|nao foi possivel abrir configuracoes/.test(lower)) {
    return 'hard';
  }
  return 'unknown';
};

const runOneItem = async (item, options) => {
  const args = [
    'scripts/change-viki-password.mjs',
    '--email',
    item.email,
    '--new-password',
    item.newPassword,
    '--max-attempts',
    String(options.maxAttempts),
    '--retry-cooldown-ms',
    String(options.failCooldownMs),
    '--guard-window-ms',
    String(options.guardWindowMs),
    '--timeout-ms',
    String(options.timeoutMs),
    '--human-delay-min-ms',
    String(options.humanDelayMinMs),
    '--human-delay-max-ms',
    String(options.humanDelayMaxMs)
  ];

  if (item.currentPassword) {
    args.push('--current-password', item.currentPassword);
  }
  if (options.headless) args.push('--headless');
  if (options.noPersistentProfile) args.push('--no-persistent-profile');

  const startedAt = nowIso();
  const cmdPreview = `node ${args.join(' ')}`;
  console.log(`[queue] Executando: ${cmdPreview.replace(item.newPassword, '***')}`);

  if (options.dryRun) {
    return {
      ok: true,
      classification: 'success',
      code: 0,
      startedAt,
      endedAt: nowIso(),
      output: '[dry-run] item validado'
    };
  }

  return new Promise((resolve) => {
    const child = spawn('node', args, {
      cwd: process.cwd(),
      shell: false
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '');
      output += text;
      process.stdout.write(`[worker:${item.email}] ${text}`);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      output += text;
      process.stderr.write(`[worker:${item.email}] ${text}`);
    });

    child.on('close', (code) => {
      const endedAt = nowIso();
      const classification = code === 0 ? 'success' : classifyResultText(output);
      resolve({
        ok: code === 0,
        classification,
        code: code ?? 1,
        startedAt,
        endedAt,
        output
      });
    });
  });
};

const runCycle = async (items, options) => {
  const cycleStartedAt = nowIso();
  const results = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    console.log(`[queue] Item ${index + 1}/${items.length}: ${item.email}`);

    const result = await runOneItem(item, options);
    results.push({
      email: item.email,
      newPasswordMasked: `${item.newPassword.slice(0, 2)}***`,
      ...result
    });

    if (!result.ok && options.stopOnHardFail && result.classification === 'hard') {
      console.log('[queue] Falha definitiva detectada. Interrompendo ciclo por --stop-on-hard-fail.');
      break;
    }

    const isLast = index === items.length - 1;
    if (isLast) continue;

    let waitMs = options.cooldownMs;
    if (!result.ok && result.classification === 'transient') {
      waitMs = options.failCooldownMs;
    }

    console.log(`[queue] Aguardando ${formatMs(waitMs)} antes do proximo item.`);
    await sleep(waitMs);
  }

  const cycleEndedAt = nowIso();
  const successCount = results.filter((item) => item.ok).length;
  const failCount = results.length - successCount;

  ensureArtifactsDir();
  const fileName = `queue-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const reportPath = path.join(ARTIFACTS_DIR, fileName);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        cycleStartedAt,
        cycleEndedAt,
        itemsTotal: items.length,
        successCount,
        failCount,
        results
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`[queue] Relatorio salvo em: ${reportPath}`);
  console.log(`[queue] Resumo do ciclo: ${successCount} sucesso(s), ${failCount} falha(s).`);
};

const main = async () => {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    return;
  }

  const items = loadItems(options.itemsFile);
  if (items.length === 0) {
    throw new Error('Nenhum item valido encontrado no arquivo da fila.');
  }

  console.log(`[queue] Itens carregados: ${items.length}`);
  console.log(`[queue] Cooldown sucesso: ${formatMs(options.cooldownMs)} | Cooldown falha temporaria: ${formatMs(options.failCooldownMs)}`);

  if (options.intervalMs <= 0) {
    await runCycle(items, options);
    return;
  }

  console.log(`[queue] Modo agendado ativo. Novo ciclo a cada ${formatMs(options.intervalMs)}.`);
  while (true) {
    await runCycle(items, options);
    console.log(`[queue] Aguardando ${formatMs(options.intervalMs)} para o proximo ciclo.`);
    await sleep(options.intervalMs);
  }
};

try {
  await main();
} catch (error) {
  console.error(`[erro] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
