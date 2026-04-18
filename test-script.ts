import { runVikiPasswordAutomationJob } from './server/vikiPasswordAutomationWorker';

async function test() {
  const payload = {
    requestId: 'test-final',
    credentialEmail: 'clientesviki4@gmail.com',
    currentPassword: 'euudorama5', // Senha resgatada do Supabase!
    newPassword: 'eudorama2'
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
