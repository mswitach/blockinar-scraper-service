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
  /* ... demás URLs ... */
];

// Función para scrapear un asset
const scrapeAsset = async (page, url) => {
  try {
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 // Reducir timeout
    });
    
    await page.waitForSelector('.cartridge-card', { timeout: 30000 });

    const result = await page.evaluate(() => {
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

    // Limpiar la página después de cada scrape
    await page.evaluate(() => {
      // Limpiar event listeners y elementos del DOM
      window.stop();
      document.body.innerHTML = '';
    });

    return result;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return null;
  }
};

// Proceso de login
const login = async page => {
  await page.goto('https://blockinar.io/auth/login', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  await page.click('text="Sign in with email"');
  await page.fill('input[type="email"]', process.env.BLOCKINAR_EMAIL);
  await page.click('button:has-text("NEXT")');
  await page.fill('input[type="password"]', process.env.BLOCKINAR_PASSWORD);
  await page.click('button:has-text("SIGN IN")');
  
  try {
    await page.waitForSelector('div.total-number span', { timeout: 30000 });
  } catch (err) {
    console.error('❌ Login falló: no se encontró el selector de dashboard:', err);
    throw err;
  }
};

// Scrapea todos los assets y guarda en NDJSON
const scrapeAllAssets = async () => {
  const timestamp = new Date().toISOString();
  
  // Configuración optimizada para memoria
  const browser = await chromium.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Importante para reducir memoria
      '--disable-gpu',
      '--memory-pressure-off',
      '--max_old_space_size=460' // Limitar heap de V8
    ]
  });

  let page;
  try {
    page = await browser.newPage();
    
    // Configurar página para usar menos memoria
    await page.setViewportSize({ width: 800, height: 600 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    });

    // Deshabilitar imágenes y CSS para ahorrar memoria
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await login(page);

    const outputDir = path.resolve('data', 'cliente1');
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, 'dashboard-history.ndjson');

    // Procesar URLs en lotes pequeños para reducir memoria
    const batchSize = 3; // Procesar de a 3 URLs por vez
    for (let i = 0; i < assetUrls.length; i += batchSize) {
      const batch = assetUrls.slice(i, i + batchSize);
      
      for (const url of batch) {
        const rec = await scrapeAsset(page, url);
        if (rec) {
          fs.appendFileSync(file, JSON.stringify({ timestamp, ...rec }) + '\n');
        }
        
        // Pequeña pausa entre requests
        await wait(1000);
      }
      
      // Forzar garbage collection entre lotes
      if (global.gc) {
        global.gc();
      }
      
      console.log(`Procesado lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(assetUrls.length/batchSize)}`);
    }

  } catch (loginError) {
    console.error('Error durante el scraping:', loginError.message);
  } finally {
    if (page) await page.close();
    await browser.close();
    
    // Forzar limpieza de memoria
    if (global.gc) {
      global.gc();
    }
  }
};

// Loop principal con manejo de memoria mejorado
const mainLoop = async () => {
  let loopCount = 1;
  
  while (true) {
    console.log(`\n[Loop #${loopCount}] Ejecutando scraping...`);
    console.log(`Memoria usada: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    
    try {
      await scrapeAllAssets();
      await generateChart();
    } catch (err) {
      console.error('Error en ciclo de scraping:', err.message);
    }
    
    // Monitorear memoria después de cada ciclo
    const memUsage = process.memoryUsage();
    console.log(`Memoria después del ciclo: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    
    // Si la memoria está muy alta, forzar garbage collection
    if (memUsage.heapUsed > 300 * 1024 * 1024) { // 300MB
      console.log('⚠️ Memoria alta, ejecutando limpieza...');
      if (global.gc) {
        global.gc();
      }
    }
    
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

app.get('/memory', (_, res) => {
  const usage = process.memoryUsage();
  res.json({
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
    external: Math.round(usage.external / 1024 / 1024) + 'MB',
    rss: Math.round(usage.rss / 1024 / 1024) + 'MB'
  });
});

app.get('/data', (_, res) => {
  const p = path.resolve('data', 'cliente1', 'dashboard-history.ndjson');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'No data' });
  res.type('application/x-ndjson');
  fs.createReadStream(p).pipe(res);
});

// Manejar señales de proceso para cleanup
process.on('SIGTERM', () => {
  console.log('Recibida señal SIGTERM, cerrando aplicación...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Recibida señal SIGINT, cerrando aplicación...');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  console.log(`Memoria inicial: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  mainLoop();
});
