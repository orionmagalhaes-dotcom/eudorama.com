#!/usr/bin/env node

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const targetUrl = process.env.PROXY_TEST_URL || 'https://ip.decodo.com/json';
const proxyUrl = process.env.DECODO_PROXY_URL || '';

if (!proxyUrl) {
  console.error('[erro] Defina DECODO_PROXY_URL. Exemplo:');
  console.error('       DECODO_PROXY_URL="http://usuario:senha@gate.decodo.com:10001"');
  process.exit(1);
}

const maskProxy = (url) =>
  String(url).replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');

const proxyAgent = new HttpsProxyAgent(proxyUrl);

axios
  .get(targetUrl, {
    httpsAgent: proxyAgent,
    timeout: 30000
  })
  .then((response) => {
    console.log('[ok] Proxy conectado.');
    console.log('[info] Proxy:', maskProxy(proxyUrl));
    console.log('[info] URL teste:', targetUrl);
    console.log('[data]', JSON.stringify(response.data, null, 2));
  })
  .catch((error) => {
    const status = error?.response?.status;
    const body = error?.response?.data;
    console.error('[erro] Falha no teste de proxy.');
    console.error('[info] Proxy:', maskProxy(proxyUrl));
    if (status) console.error('[info] HTTP status:', status);
    if (body) console.error('[info] Body:', typeof body === 'string' ? body : JSON.stringify(body));
    console.error('[info] Mensagem:', error?.message || String(error));
    process.exit(1);
  });

