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
   - No modo dev, se os webhooks nao forem definidos, o Vite expoe endpoints locais:
     - `POST /api/viki-tv-automation`
     - `GET /api/viki-tv-automation/status?requestId=...`
3. Rode localmente:
   `npm run dev`

## Build

- `npm run build`
- `npm run preview`
