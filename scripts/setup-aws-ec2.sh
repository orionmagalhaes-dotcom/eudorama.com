#!/bin/bash
# Script de instalacao e configuracao do Motor Viki Patchright em servidor Linux (AWS EC2 / Ubuntu)

set -e

echo "=== 1. Atualizando sistema ==="
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential

echo "=== 2. Instalando Node.js 20 ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "Versao do Node: $(node -v)"
echo "Versao do NPM: $(npm -v)"

echo "=== 3. Instalando PM2 e TSX ==="
sudo npm install -g pm2 tsx

echo "=== 4. Instalando Cloudflared ==="
if ! command -v cloudflared &> /dev/null; then
  curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i cloudflared.deb
  rm cloudflared.deb
fi

echo "=== 5. Instalando dependencias do Patchright/Chromium ==="
npx -y patchright install --with-deps chromium

echo "=== Setup concluido com sucesso! ==="
echo ""
echo "Proximos passos na sua AWS EC2:"
echo "1. Crie o arquivo .env.local com seu VIKI_MOTOR_TOKEN:"
echo "   echo \"VIKI_MOTOR_TOKEN=seu_token_seguro\" > .env.local"
echo ""
echo "2. Inicie o motor com PM2:"
echo "   pm2 start \"npx tsx automation-server.ts\" --name \"viki-motor\""
echo "   pm2 startup"
echo "   pm2 save"
echo ""
echo "3. Conecte o Cloudflare Tunnel:"
echo "   sudo cloudflared service install <TOKEN_DO_TUNNEL>"
