<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# EuDorama - Clube de Assinantes

Sistema de gerenciamento de assinaturas de streaming para doramas com painel administrativo.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`
# Deploy / Viki Pairing

- Backend (Render): `https://eudorama-com.onrender.com`
- Frontend (Cloudflare Pages): usa `VITE_VIKI_SERVER_URL` em `.env.production`

## Deploy Backend no Railway (alternativa ao Render)

1. No Railway, crie um novo projeto e conecte este repositório.
2. Garanta que o deploy use o `Dockerfile` da raiz.
   - Esse container sobe somente a API (`/api/viki/*`), sem depender de `dist/`.
3. Variáveis recomendadas no serviço:
   - `NODE_ENV=production`
   - `VIKI_MAX_CONCURRENT=2`
   - `VIKI_OVERALL_TIMEOUT_MS=140000`
   - `VIKI_NAV_TIMEOUT_MS=35000`
   - `VIKI_ACTION_TIMEOUT_MS=20000`
   - `VIKI_NETWORK_IDLE_TIMEOUT_MS=12000`
   - `VIKI_RESULT_TIMEOUT_MS=15000`
4. Após subir, valide:
   - `GET https://<seu-servico>.up.railway.app/api/viki/health`
5. No frontend (Cloudflare), atualize:
   - `VITE_VIKI_SERVER_URL=https://<seu-servico>.up.railway.app`
