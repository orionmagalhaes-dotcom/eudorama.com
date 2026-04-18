import { chromium } from 'playwright';
import fs from 'fs';

async function main() {
    const csvPath = 'C:\\Users\\orion\\Downloads\\data.csv';
    const text = fs.readFileSync(csvPath, 'utf-8');
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.includes(':'));
    
    if (lines.length === 0) {
        throw new Error('Nenhum proxy encontrado no arquivo.');
    }

    // Pega o primeiro proxy da lista
    const parts = lines[0].split(':');
    const host = parts[0];
    const port = parts[1];
    const username = parts[2];
    const password = parts[3];

    const proxyConfig = {
        server: `http://${host}:${port}`,
        username,
        password
    };

    console.log(`Abrindo navegador com proxy: ${proxyConfig.server}`);

    const browser = await chromium.launch({
        headless: false, // Navegador visível
        args: ['--disable-blink-features=AutomationControlled'],
        proxy: proxyConfig
    });

    const context = await browser.newContext({
        viewport: { width: 412, height: 915 }, // Mobile emulado
        userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2
    });

    const page = await context.newPage();
    
    // Vamos abrir a viki para você testar
    console.log('Navegando para a Viki...');
    await page.goto('https://www.viki.com/web-sign-in');

    console.log('A página está aberta e com proxy da Decodo. Você pode testar livremente (o script não vai fechar).');
}

main().catch(console.error);
