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
   - `VITE_INFINITY_PAY_HANDLE` (opcional, handle da loja no InfinityPay. Padrao: `orion_magalhaes`)
   - `VITE_INFINITY_PAY_PAYMENT_CHECK_WEBHOOK` (recomendado em producao, endpoint backend para validar pagamento InfinityPay sem CORS; pode ser URL completa da rota ou apenas dominio base do worker)
   - `VITE_INFINITY_PAY_PAYMENT_CHECK_TOKEN` (opcional, token Bearer do endpoint backend de `payment_check`)
   - `VITE_VIKI_MOBILE_HELP_VIDEO_URL` (opcional, URL publica do video "Como conectar no celular")
   - `VITE_IQIYI_MOBILE_HELP_VIDEO_URL` (opcional, URL publica do video "Como conectar no celular" da assinatura IQIYI)
   - No modo dev, se os webhooks nao forem definidos, o Vite expoe endpoints locais:
     - `POST /api/infinitypay/payment-check`
     - `POST /api/viki-tv-automation`
     - `GET /api/viki-tv-automation/status?requestId=...`
3. Rode localmente:
   `npm run dev`

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
