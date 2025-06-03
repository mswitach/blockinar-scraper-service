import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

dotenv.config();

// Validar variables de entorno requeridas
if (!process.env.BLOCKINAR_EMAIL || !process.env.BLOCKINAR_PASSWORD) {
  console.error('❌ Error: BLOCKINAR_EMAIL y BLOCKINAR_PASSWORD son requeridas');
  process.exit(1);
}

console.log('✅ Variables de entorno configuradas correctamente');

// Utility to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
const login = async (page) => {
  console.log('🔐 Iniciando proceso de login...');
  
  try {
    // Ir a página de login
    await page.goto('https://blockinar.io/auth/login', { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });
    console.log('✅ Página de login cargada');

    // Hacer clic en "Sign in with email"
    await page.waitForSelector('text="Sign in with email"', { timeout: 10000 });
    await page.click('text="Sign in with email"');
    console.log('✅ Clic en "Sign in with email"');

    // Llenar email
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', process.env.BLOCKINAR_EMAIL);
    console.log('✅ Email ingresado');

    // Hacer clic en NEXT
    await page.waitForSelector('button:has-text("NEXT")', { timeout: 10000 });
    await page.click('button:has-text("NEXT")');
    console.log('✅ Clic en NEXT');

    // Esperar un poco para que cargue el campo de password
    await wait(2000);

    // Llenar password
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.fill('input[type="password"]', process.env.BLOCKINAR_PASSWORD);
    console.log('✅ Password ingresado');

    // Hacer clic en SIGN IN
    await page.waitForSelector('button:has-text("SIGN IN")', { timeout: 10000 });
    await page.click('button:has-text("SIGN IN")');
    console.log('✅ Clic en SIGN IN');

    // Esperar a que aparezca el dashboard
    console.log('⏳ Esperando carga del dashboard...');
    await page.waitForSelector('div.total-number span', { timeout: 45000 });
    console.log('✅ Dashboard cargado correctamente');

  } catch (err) {
    console.error('❌ Error durante el login:', err.message);
    
    // Intentar tomar screenshot para debug
    try {
      const screenshot = await page.screenshot({ fullPage: true });
      console.log('📸 Screenshot tomado para debugging');
    } catch (screenshotErr) {
      console.log('No se pudo tomar screenshot:', screenshotErr.message);
    }
    
    throw new Error(`Login fallido: ${err.message}`);
  }
};

// Scrapea todos los assets y guarda en NDJSON
const scrapeAllAssets = async () => {
  const timestamp = new Date().toISOString();
  console.log(`🚀 Iniciando scraping: ${timestamp}`);
  
  let browser;
  let page;
  
  try {
    // Configuración optimizada para memoria
    browser = await chromium.launch({ 
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
        '--max_old_space_size=460', // Limitar heap de V8
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });

    console.log('✅ Browser iniciado');

    page = await browser.newPage();
    console.log('✅ Nueva página creada');
    
    // Configurar página para usar menos memoria
    await page.setViewportSize({ width: 1024, height: 768 });
    
    // Configurar timeouts más largos
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    // Deshabilitar imágenes y CSS para ahorrar memoria
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    console.log('✅ Configuración de página completada');

    // Intentar login
    await login(page);

    const outputDir = path.resolve('data', 'cliente1');
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, 'dashboard-history.ndjson');

    console.log(`📁 Archivo de salida: ${file}`);
    console.log(`🔢 URLs a procesar: ${assetUrls.length}`);

    // Procesar URLs en lotes pequeños para reducir memoria
    const batchSize = 2; // Reducido a 2 para ser más conservador
    let processedCount = 0;
    
    for (let i = 0; i < assetUrls.length; i += batchSize) {
      const batch = assetUrls.slice(i, i + batchSize);
      console.log(`📦 Procesando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(assetUrls.length/batchSize)}`);
      
      for (const url of batch) {
        try {
          console.log(`🔄 Scrapeando: ${url}`);
          const rec = await scrapeAsset(page, url);
          if (rec) {
            fs.appendFileSync(file, JSON.stringify({ timestamp, ...rec }) + '\n');
            processedCount++;
            console.log(`✅ Procesado ${processedCount}/${assetUrls.length}: ${rec.assetName || 'Sin nombre'}`);
          } else {
            console.log(`⚠️ No se obtuvieron datos para: ${url}`);
          }
        } catch (assetError) {
          console.error(`❌ Error procesando ${url}:`, assetError.message);
        }
        
        // Pequeña pausa entre requests
        await wait(2000);
      }
      
      // Forzar garbage collection entre lotes
      if (global.gc) {
        global.gc();
      }
      
      // Pausa entre lotes
      await wait(1000);
    }

    console.log(`✅ Scraping completado. Procesados: ${processedCount}/${assetUrls.length}`);

  } catch (error) {
    console.error('❌ Error durante el scraping:', error.message);
    throw error;
  } finally {
    // Cleanup garantizado
    try {
      if (page) {
        console.log('🧹 Cerrando página...');
        await page.close();
      }
    } catch (e) {
      console.log('⚠️ Error cerrando página:', e.message);
    }
    
    try {
      if (browser) {
        console.log('🧹 Cerrando browser...');
        await browser.close();
      }
    } catch (e) {
      console.log('⚠️ Error cerrando browser:', e.message);
    }
    
    // Forzar limpieza de memoria
    if (global.gc) {
      global.gc();
    }
    
    console.log('🧹 Cleanup completado');
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
