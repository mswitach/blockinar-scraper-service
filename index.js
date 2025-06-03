import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

dotenv.config();

// Utility to wait
const wait = ms => new Promise(res => setTimeout(res, ms));

// Generate chart by invoking external script
const generateChart = () => {
  return new Promise((resolve, reject) => {
    console.log('📊 Generando gráfico con los datos actualizados...');
    exec('node generateChart.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error al generar el gráfico: ${error.message}`);
        return reject(error);
      }
      if (stderr) {
        console.error(`⚠️ Advertencias al generar el gráfico: ${stderr}`);
      }
      console.log(stdout);
      console.log('✅ Gráfico generado correctamente');
      resolve();
    });
  });
};

// URLs de los assets a scrapear
const assetUrls = [
  "https://blockinar.io/things/asset-info?core_id=Qqkw4QTHKXA03PhfuiHI&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=LBOxYd3kwznY1S0YszF7&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=WSSW6biSLwfDhXsxpYlY&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=lVl6m2JrnjEH4iHlrKXe&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=mqpImzWSxjywdrfhwJWO&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=u2ROFIMf1rGjlyV8oe2O&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=XkWN5oJSSCoTsHDF00OM&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=DD5vUyxAR16rblA2jyk4&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=Xmvx2RkQMHffKhdKmL9W&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=H5YhLrngrHuHIgnp7oUY&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=e3uhXIJ7Ey6zOHsROJBR&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=FMsAQ7qgpQF9CwlwrTMc&tab=dashboard"
];

// Función para scrapear un asset
const scrapeAsset = async (page, url) => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.waitForSelector('.cartridge-card', { timeout: 60000 });

  return await page.evaluate(() => {
    const record = {};
    const name = document.querySelector('.gateway-title')?.textContent.trim();
    if (name) record.assetName = name;
    const location = document.querySelector('.asset-info-container .layout-route')?.textContent.trim();
    if (location) record.cartridgeLocation = location;

    // Obtener serial
    const serialSpans = Array.from(document.querySelectorAll('span'))
      .filter(s => s.textContent.trim().startsWith('Serial Number:'));
    if (serialSpans.length >= 2) {
      record.serialNumber = serialSpans[1].textContent.replace('Serial Number:', '').trim();
    }

    // Obtener métricas
    document.querySelectorAll('.cartridge-card').forEach(card => {
      const title = card.querySelector('.cartridge-card-title')?.textContent.trim();
      const value = card.querySelector('.cartridge-value')?.textContent.trim();
      if (!title || !value) return;
      record[title] = value;
    });
    return record;
  });
};

// Proceso de login
const login = async page => {
  await page.goto('https://blockinar.io/auth/login', { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.click('text="Sign in with email"');
  await page.fill('input[type="email"]', process.env.BLOCKINAR_EMAIL);
  await page.click('button:has-text("NEXT")');
  await page.fill('input[type="password"]', process.env.BLOCKINAR_PASSWORD);
  await page.click('button:has-text("SIGN IN")');
  await page.waitForSelector('div.total-number span', { timeout: 60000 });
};

// Scrapea todos los assets y guarda en NDJSON
const scrapeAllAssets = async () => {
  const timestamp = new Date().toISOString();
  // Se añade executablePath para usar el Chromium descargado en Render
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath()
  });
  const page = await browser.newPage();
  await login(page);

  const outputDir = path.resolve('data', 'cliente1');
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, 'dashboard-history.ndjson');

  for (const url of assetUrls) {
    try {
      const rec = await scrapeAsset(page, url);
      fs.appendFileSync(file, JSON.stringify({ timestamp, ...rec }) + '\n');
    } catch (err) {
      console.error('Error scraping:', err);
    }
  }
  await browser.close();
};

// Loop principal
const mainLoop = async () => {
  let loopCount = 1;
  while (true) {
    console.log(`\n[Loop #${loopCount}] Ejecutando scraping...`);
    await scrapeAllAssets();
    try { await generateChart(); } catch (e) {}
    console.log('⏳ Esperando 1 minuto...');
    await wait(60 * 1000);
    loopCount++;
  }
};

// Servidor HTTP
const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

app.get('/health', (_, res) => res.send('OK'));
app.get('/data', (_, res) => {
  const p = path.resolve('data', 'cliente1', 'dashboard-history.ndjson');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'No data' });
  res.type('application/x-ndjson');
  fs.createReadStream(p).pipe(res);
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  mainLoop();
});

