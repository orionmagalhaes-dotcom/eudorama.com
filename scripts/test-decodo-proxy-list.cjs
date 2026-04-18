#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const DEFAULT_INPUT = 'C:\\Users\\orion\\Downloads\\data.csv';
const DEFAULT_TEST_URL = 'https://ip.decodo.com/json';
const DEFAULT_TIMEOUT_MS = 30000;
const REPORT_DIR = path.resolve('artifacts', 'proxy-tests');

const usage = () => {
  console.log(
    [
      'Uso:',
      '  node scripts/test-decodo-proxy-list.cjs [--file <caminho>] [--url <teste>] [--timeout-ms <ms>]',
      '',
      'Formato esperado por linha:',
      '  host:port:user:password',
      'Exemplo:',
      '  gate.decodo.com:10001:usuario:senha'
    ].join('\n')
  );
};

const parseArgs = (argv) => {
  const options = {
    file: DEFAULT_INPUT,
    url: DEFAULT_TEST_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '').trim();
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    const next = String(argv[i + 1] || '').trim();
    if (!next) throw new Error(`Valor ausente para ${arg}`);

    if (arg === '--file') {
      options.file = next;
      i += 1;
      continue;
    }
    if (arg === '--url') {
      options.url = next;
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1000) throw new Error('--timeout-ms invalido');
      options.timeoutMs = Math.floor(value);
      i += 1;
      continue;
    }

    throw new Error(`Argumento nao reconhecido: ${arg}`);
  }

  return options;
};

const nowIso = () => new Date().toISOString();

const maskSecret = (value) => {
  const text = String(value || '');
  if (text.length <= 2) return '*'.repeat(text.length);
  return `${text[0]}***${text[text.length - 1]}`;
};

const maskProxyUrl = (url) => String(url).replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');

const ensureReportDir = () => {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
};

const parseLine = (line, index) => {
  const raw = String(line || '').trim();
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 4) {
    throw new Error(`Linha ${index + 1} invalida: esperado host:port:user:password`);
  }

  const host = String(parts[0] || '').trim();
  const port = String(parts[1] || '').trim();
  const user = String(parts[2] || '').trim();
  const password = parts.slice(3).join(':').trim();

  if (!host || !port || !user || !password) {
    throw new Error(`Linha ${index + 1} invalida: campos vazios`);
  }

  const proxyUrl = `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`;
  return {
    host,
    port,
    user,
    password,
    proxyUrl,
    display: `${host}:${port}:${maskSecret(user)}:${maskSecret(password)}`
  };
};

const loadProxies = (filePath) => {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Arquivo nao encontrado: ${fullPath}`);
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const proxies = lines.map((line, index) => parseLine(line, index)).filter(Boolean);
  if (proxies.length === 0) throw new Error('Nenhum proxy valido encontrado no arquivo.');
  return proxies;
};

const testProxy = async (proxy, options) => {
  const startedAt = nowIso();
  const agent = new HttpsProxyAgent(proxy.proxyUrl);

  try {
    const response = await axios.get(options.url, {
      httpsAgent: agent,
      timeout: options.timeoutMs
    });

    const data = response?.data || {};
    const ip = data?.proxy?.ip || data?.ip || '';
    const country = data?.country?.name || '';
    const city = data?.city?.name || '';

    return {
      ok: true,
      status: response.status,
      startedAt,
      endedAt: nowIso(),
      ip,
      country,
      city,
      raw: data
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.response?.status || 0,
      startedAt,
      endedAt: nowIso(),
      error: error?.message || String(error),
      body: error?.response?.data || null
    };
  }
};

const main = async () => {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    return;
  }

  const proxies = loadProxies(options.file);
  console.log(`[info] Arquivo: ${path.resolve(options.file)}`);
  console.log(`[info] Proxies para teste: ${proxies.length}`);
  console.log(`[info] URL de teste: ${options.url}`);

  const results = [];

  for (let i = 0; i < proxies.length; i += 1) {
    const proxy = proxies[i];
    console.log(`[test] ${i + 1}/${proxies.length} ${proxy.display}`);
    console.log(`[test] URL proxy: ${maskProxyUrl(proxy.proxyUrl)}`);
    const result = await testProxy(proxy, options);
    results.push({
      host: proxy.host,
      port: proxy.port,
      user: proxy.user,
      ok: result.ok,
      status: result.status,
      ip: result.ip || '',
      country: result.country || '',
      city: result.city || '',
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      error: result.error || '',
      body: result.body || null
    });

    if (result.ok) {
      console.log(`[ok] ${proxy.host}:${proxy.port} -> IP ${result.ip || '-'} (${result.country || '-'}/${result.city || '-'})`);
    } else {
      console.log(`[fail] ${proxy.host}:${proxy.port} -> ${result.error || 'erro desconhecido'}`);
    }
  }

  const successCount = results.filter((item) => item.ok).length;
  const failCount = results.length - successCount;

  ensureReportDir();
  const reportPath = path.join(
    REPORT_DIR,
    `decodo-proxy-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: nowIso(),
        inputFile: path.resolve(options.file),
        testUrl: options.url,
        total: results.length,
        successCount,
        failCount,
        results
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`[summary] Sucesso: ${successCount} | Falha: ${failCount}`);
  console.log(`[summary] Relatorio: ${reportPath}`);

  if (failCount > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(`[erro] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

