
const payload = {
  requestId: 'test-local-proxy-' + Date.now(),
  payload: {
    credentialEmail: 'clientesviki3@gmail.com',
    currentPassword: 'eudorama16',
    newPassword: 'eudorama16' // Mantendo a mesma para teste sem quebrar acesso
  }
};

fetch('http://localhost:3001/api/viki-password-automation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
.then(r => r.json())
.then(data => console.log('Teste disparado:', data))
.catch(err => console.error('Erro ao disparar:', err.message));
