# Dossie de Bloqueio de Login - Rakuten Viki

Data de preparo: 2026-04-18 (America/Sao_Paulo)

## Resumo do problema
- Cliente pagante bloqueado de login na propria conta.
- Falha ocorre mesmo com navegador padrao e tentativa limpa.
- Erro observado durante login automatizado e manual: erro temporario/anti-bot antes da validacao de senha.

## Evidencias tecnicas recentes
1. Tentativa: 2026-04-18T19:37:25Z
   - Etapa: `login_current_password`
   - URL: `https://www.viki.com/web-sign-in?return_to=%2Fsamsungtv`
   - Erro: `Login TV retornou erro temporario da Viki.`
   - Arquivos:
     - `artifacts/password-change/attempt-1-2026-04-18T19-37-25-337Z.txt`
     - `artifacts/password-change/attempt-1-2026-04-18T19-37-25-337Z.html`
     - `artifacts/password-change/attempt-1-2026-04-18T19-37-25-337Z.png`

2. Outras tentativas com mesmo padrao:
   - `attempt-1-2026-04-18T15-52-05-755Z.*`
   - `attempt-1-2026-04-18T15-50-14-787Z.*`
   - `attempt-1-2026-04-18T15-49-17-846Z.*`

## Pedido objetivo ao suporte
- Desbloqueio manual imediato da conta para login normal.
- Limpeza do flag de risco/anti-bot associado a conta.
- Confirmacao de que o login pode ser feito por navegador comum sem challenge infinito.
- Confirmacao de que nao houve comprometimento da conta.

## Texto pronto (PT-BR)
Assunto: URGENTE - Conta pagante bloqueada por anti-bot (falso positivo)

Sou titular da conta e nao consigo entrar nem no navegador padrao da minha propria maquina. O sistema de seguranca da Viki esta bloqueando meu acesso antes mesmo da validacao de senha (erro temporario/anti-bot recorrente).

Ja testei ambiente limpo (anonimo, cookies/cache limpos, sem automacao ativa) e o problema persiste.

Solicito desbloqueio manual imediato da conta e remocao do bloqueio de risco/anti-bot para que eu possa exercer meu acesso normalmente.

Anexo evidencias tecnicas com horario, URL e captura de tela.

Dados da conta:
- Email: [PREENCHER_EMAIL]
- Fuso/horario das falhas: America/Sao_Paulo (UTC-3)
- Ultimas falhas: 18/04/2026

## Texto pronto (EN)
Subject: URGENT - Paid account locked by false anti-bot detection

I am the account owner and I cannot log in even from my regular browser on my own machine. Viki security is blocking access before password validation (recurrent temporary/anti-bot error).

I already tested with a clean environment (incognito, cleared cookies/cache, no active automation) and the issue persists.

Please perform an immediate manual unlock and clear the risk/anti-bot flag on my account so I can access it normally.

I am attaching technical evidence with timestamps, URL, and screenshots.

Account data:
- Email: [FILL_ACCOUNT_EMAIL]
- Failure timezone: America/Sao_Paulo (UTC-3)
- Latest failures: 2026-04-18
