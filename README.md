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
   - `VITE_VIKI_MOBILE_HELP_VIDEO_URL` (opcional, URL publica do video "Como conectar no celular")
   - `VITE_IQIYI_MOBILE_HELP_VIDEO_URL` (opcional, URL publica do video "Como conectar no celular" da assinatura IQIYI)
   - No modo dev, se os webhooks nao forem definidos, o Vite expoe endpoints locais:
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
