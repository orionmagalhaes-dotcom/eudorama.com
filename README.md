# EuDorama

Frontend React + Vite focado em:
- controle de clientes e assinaturas
- gestao financeira e renovacoes
- integracao com Supabase

## Requisitos

- Node.js 18+

## Desenvolvimento

1. Instale as dependencias:
   `npm install`
2. Configure variaveis em `.env.local`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_VIKI_TV_AUTOMATION_WEBHOOK` (opcional, automacao Viki TV em background)
   - `VITE_VIKI_TV_AUTOMATION_TOKEN` (opcional, token Bearer do webhook)
   - `VITE_VIKI_TV_AUTOMATION_STATUS_WEBHOOK` (opcional, consulta de status das etapas)
   - `VITE_VIKI_PASSWORD_AUTOMATION_WEBHOOK` (opcional, automacao de troca de senha Viki em background)
   - `VITE_VIKI_PASSWORD_AUTOMATION_TOKEN` (opcional, token Bearer do webhook de troca de senha)
   - `VITE_VIKI_PASSWORD_AUTOMATION_STATUS_WEBHOOK` (opcional, consulta de status da troca de senha)
   - `VITE_INFINITY_PAY_HANDLE` (opcional, handle da loja no InfinityPay. Padrao: `orion_magalhaes`)
   - `VITE_INFINITY_PAY_PAYMENT_CHECK_WEBHOOK` (recomendado em producao, endpoint backend para validar pagamento InfinityPay sem CORS; pode ser URL completa da rota ou apenas dominio base do worker)
   - `VITE_INFINITY_PAY_PAYMENT_CHECK_TOKEN` (opcional, token Bearer do endpoint backend de `payment_check`)
   - `VITE_VIKI_MOBILE_HELP_VIDEO_URL` (opcional, URL publica do video "Como conectar no celular")
   - `VITE_IQIYI_MOBILE_HELP_VIDEO_URL` (opcional, URL publica do video "Como conectar no celular" da assinatura IQIYI)
   - No modo dev, se os webhooks nao forem definidos, o Vite expoe endpoints locais:
     - `POST /api/infinitypay/payment-check`
     - `POST /api/viki-tv-automation`
     - `GET /api/viki-tv-automation/status?requestId=...`
     - `POST /api/viki-password-automation`
     - `GET /api/viki-password-automation/status?requestId=...`
3. Rode localmente:
   `npm run dev`

## Automacao Viki TV com Patchright

- O cliente continua chamando a Cloudflare pelo endpoint:
  - `POST /api/viki-tv-automation`
  - `GET /api/viki-tv-automation/status?requestId=...`
- Para a automacao de TV usar Patchright de verdade, configure um motor Node externo e aponte o Worker para ele. Patchright nao roda dentro do runtime do Cloudflare Worker/Browser Rendering.
- Rota operacional validada:
  - rode `LIGAR_MOTOR_TUNNEL.bat`
  - o script inicia o motor em `http://localhost:3000`
  - abre um Cloudflare quick tunnel
  - testa o tunnel
  - gera um `VIKI_MOTOR_TOKEN` quando ele nao existir
  - atualiza automaticamente os secrets `VIKI_PATCHRIGHT_MOTOR_URL` e `VIKI_PATCHRIGHT_MOTOR_TOKEN` do Worker
- Para servidor/EC2, rode o mesmo script ou exponha `automation-server.ts` por um Cloudflare Tunnel nomeado apontando para `http://localhost:3000`.
- Para usar `viki-motor.eudorama.com`, alem do ingress do Tunnel, e necessario criar um DNS CNAME proxied para `<tunnel-id>.cfargotunnel.com`. A Cloudflare exige permissao `DNS Write` para essa etapa.
- O script `LIGAR_MOTOR_TUNNEL.bat` inicia o motor neste PC em `http://localhost:3000`, mantem o tunnel nomeado `eudorama-motor` ligado e atualiza o Worker para chamar `https://viki-motor.eudorama.com`. O DNS fixo `viki-motor.eudorama.com` aponta para `08659005-665c-421b-8688-4215fbdb2828.cfargotunnel.com`.
- Proxy residencial opcional para o Patchright:
  - `PATCHRIGHT_PROXY_URL=http://usuario:senha@host:porta`
  - tambem aceita `VIKI_PROXY_URL` ou `DECODO_PROXY_URL`
- Configure os secrets do Worker:
  - `cd viki-worker`
  - `npx wrangler secret put VIKI_PATCHRIGHT_MOTOR_URL`
  - `npx wrangler secret put VIKI_PATCHRIGHT_MOTOR_TOKEN` (opcional, se `VIKI_MOTOR_TOKEN` estiver ativo no motor)
  - `npm run deploy`
- Sem `VIKI_PATCHRIGHT_MOTOR_URL`, o Worker usa o fallback antigo com `@cloudflare/puppeteer`.

## Build

- `npm run build`
- `npm run preview`

## Upload do video guia (Supabase Storage)

1. Defina `SUPABASE_SERVICE_ROLE_KEY` no terminal.
2. Rode `npm run upload:viki-mobile-video` para o video do Viki Pass.
3. Rode `npm run upload:iqiyi-mobile-video` para o video do IQIYI.
4. O script cria o bucket `public-media` (se necessario), envia o arquivo e retorna a URL publica.

## Backend de validacao InfinityPay

- Endpoint esperado pelo frontend: `POST /api/infinitypay/payment-check` (ou URL configurada em `VITE_INFINITY_PAY_PAYMENT_CHECK_WEBHOOK`).
- Endpoint para registrar pedido (renovacao fora do navegador original): `POST /api/infinitypay/order-register`.
- Endpoint para consultar pedido por `order_nsu`: `GET /api/infinitypay/order?order_nsu=...`.
- Observacao: qualquer mudanca nesses endpoints exige novo deploy do Worker no Cloudflare.
- Configure o mesmo token no frontend e no Worker:
  - Frontend: `VITE_INFINITY_PAY_PAYMENT_CHECK_TOKEN=<seu_token>`
  - Worker Cloudflare (recomendado como secret): `INFINITY_PAY_PAYMENT_CHECK_TOKEN=<seu_token>`
- Comando recomendado para Worker:
  - `cd viki-worker`
  - `npx wrangler secret put INFINITY_PAY_PAYMENT_CHECK_TOKEN`
- Payload:
  - `handle`
  - `order_nsu`
  - `transaction_nsu`
  - `slug`
- Payload de `order-register`:
  - `order_nsu`
  - `phone_number`
  - `services` (array)
- O projeto ja inclui implementacao para:
  - dev local no `vite.config.ts`
  - Cloudflare Worker em `viki-worker/src/index.ts`

## WuzAPI

- Guia de Docker e Cloudflare Tunnel: `docker/wuzapi/README.md`
- Stack local do WuzAPI: `docker/wuzapi/docker-compose.yml`
