const WORKER_URL = 'http://localhost:3000';

async function testPasswordChange() {
  const email = 'clientesviki@gmail.com';
  const newPassword = 'eudorama02';
  
  // Try guessing 'eudorama01' if current is not provided, since new is 'eudorama02'
  const currentPassword = process.argv[2] || 'eudorama01';

  console.log(`[TESTE] Disparando solicitacao para ${email}... Senha atual: ${currentPassword} -> Nova: ${newPassword}`);
  const req = await fetch(`${WORKER_URL}/api/viki-password-automation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: 'test-api-' + Date.now().toString(),
      payload: {
        credentialEmail: email,
        currentPassword: currentPassword,
        newPassword: newPassword
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
      const statusReq = await fetch(`${WORKER_URL}/api/viki-password-automation/status?requestId=${reqId}`);
      const statusRes = await statusReq.json();
      
      const runningStep = statusRes.steps.find((s) => s.status === 'running') || statusRes.steps.slice().reverse().find((s) => s.status === 'success');
      console.log(`> State: ${statusRes.status} | Etapa atual: ${runningStep?.label} (${runningStep?.status}): ${runningStep?.details || '...'}`);

      if (statusRes.status === 'success') {
        console.log('\n[SUCESSO] Senha alterada com sucesso na Viki!');
        break;
      }
      if (statusRes.status === 'failed') {
        console.error(`\n[FALHA] Alguma etapa falhou: ${statusRes.message}`);
        break;
      }
    } catch(e) {
      //
    }
  }
}

testPasswordChange();
