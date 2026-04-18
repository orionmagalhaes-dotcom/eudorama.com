import { runVikiPasswordAutomationJob } from './server/vikiPasswordAutomationWorker';

async function test() {
  const payload = {
    requestId: 'painel-admin-simulado',
    credentialEmail: 'clientesviki11@gmail.com',
    currentPassword: 'euudorama05',
    newPassword: 'eudorama16'
  };

  console.log(`Starting test for ${payload.credentialEmail}...`);
  
  await runVikiPasswordAutomationJob(payload, (status) => {
    console.log(`[STATUS UPDATE] ${status.status}: ${status.message}`);
    const runningStep = status.steps.find(s => s.status === 'running');
    if (runningStep) {
        console.log(`  -> Step [${runningStep.label}]: ${runningStep.details}`);
    }
  });
}

test().catch(console.error);
