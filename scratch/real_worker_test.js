
async function runTest() {
    const payload = {
        requestId: 'real-test-viki8-' + Date.now(),
        payload: {
            credentialEmail: 'clientesviki8@gmail.com',
            currentPassword: 'eudorama02',
            newPassword: 'eudorama16'
        }
    };

    console.log('--- Iniciando Troca de Senha Real (Worker Cloud) ---');
    
    // Disparo para o Worker de Produção
    const triggerRes = await fetch('https://viki-worker.orionmagalhaes.workers.dev/api/viki-password-automation', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer placeholder' // Se houver token, adicionar aqui
        },
        body: JSON.stringify(payload)
    });

    const triggerData = await triggerRes.json();
    const requestId = triggerData.requestId;
    console.log('Solicitacao enviada. ID:', requestId);

    // Polling do Status
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch(`https://viki-worker.orionmagalhaes.workers.dev/api/viki-password-automation/status?requestId=${requestId}`);
        const status = await statusRes.json();
        
        const lastStep = status.steps?.[status.steps.length - 1];
        console.log(`[${new Date().toLocaleTimeString()}] Status: ${status.executionStatus || status.status} | Ultimo Passo: ${lastStep?.label} (${lastStep?.status})`);

        if (status.executionStatus === 'success' || status.status === 'success') {
            console.log('✅ SUCESSO! Senha trocada.');
            return;
        }
        if (status.executionStatus === 'failed' || status.status === 'failed') {
            console.log('❌ FALHA:', status.message || status.error);
            // Mostrar detalhes do passo que falhou
            const failedStep = status.steps?.find(s => s.status === 'failed');
            if (failedStep) console.log('Detalhe do erro:', failedStep.details);
            return;
        }
    }
    console.log('⏳ Timeout: A automação está demorando muito.');
}

runTest();
