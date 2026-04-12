const WORKER_URL = 'http://localhost:3000';

async function testTvConnect() {
  const email = 'clientesviki7@gmail.com';
  const password = 'eudorama01';
  
  console.log(`[TESTE TV] Disparando conexao TV para ${email}...`);
  const req = await fetch(`${WORKER_URL}/api/viki-tv-automation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'test-tv-' + Date.now().toString(),
      payload: {
        tvModel: 'samsung',
        tvUrl: 'https://www.viki.com/samsungtv',
        tvCode: 'RANDOMTEST123',
        credentialEmail: email,
        credentialPassword: password
      }
    })
  });

  const res = await req.json();
  console.log('[API] Resposta Inicial:', res);

  if (!res.success || !res.requestId) {
    console.error('Falha ao enfileirar job.');
    return;
  }

  const reqId = res.requestId;
  console.log(`\n[STATUS] Acompanhando Request ID: ${reqId}\n---`);

  while (true) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const statusReq = await fetch(`${WORKER_URL}/api/viki-tv-automation/status?requestId=${reqId}`);
      const statusRes = await statusReq.json();
      
      const runningStep = statusRes.steps.find((s) => s.status === 'running') || statusRes.steps.slice().reverse().find((s) => s.status === 'success');
      console.log(`> State: ${statusRes.status} | Etapa atual: ${runningStep?.label} (${runningStep?.status}): ${runningStep?.details || '...'}`);

      if (statusRes.status === 'success') {
        console.log('\n[SUCESSO] TV Conectada!');
        break;
      }
      if (statusRes.status === 'failed') {
        console.error(`\n[FALHA] ${statusRes.message}`);
        break;
      }
    } catch(e) {}
  }
}

testTvConnect();
