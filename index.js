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

// Utility para esperar
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Proceso de login: abre la página de login, ingresa credenciales y espera el dashboard
const login = async (page) => {
  console.log('🔐 Iniciando proceso de login...');
  try {
    // Ir a página de login
    await page.goto('https://blockinar.io/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('✅ Página de login cargada');

    // Click en "Sign in with email"
    await page.waitForSelector('text="Sign in with email"', { timeout: 10000 });
    await page.click('text="Sign in with email"');
    console.log('✅ Clic en "Sign in with email"');

    // Llenar email
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', process.env.BLOCKINAR_EMAIL);
    console.log('✅ Email ingresado');

    // Click en NEXT
    await page.waitForSelector('button:has-text("NEXT")', { timeout: 10000 });
    await page.click('button:has-text("NEXT")');
    console.log('✅ Clic en NEXT');

    // Llenar password
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.fill('input[type="password"]', process.env.BLOCKINAR_PASSWORD);
    console.log('✅ Password ingresado');

    // Click en SIGN IN
    await page.waitForSelector('button:has-text("SIGN IN")', { timeout: 10000 });
    await page.click('button:has-text("SIGN IN")');
    console.log('✅ Clic en SIGN IN');

    // Esperar a que cargue el dashboard (selector visible en dashboard)
    await page.waitForSelector('div.total-number span', { timeout: 30000 });
    console.log('✅ Dashboard cargado correctamente');
  } catch (error) {
    console.error('❌ Error durante login:', error.message);
    throw error;
  }
};

// Función para scrapear un asset dado su URL
const scrapeAsset = async (page, url) => {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000 // timeout aumentado para mayor robustez
    });

    // Esperar al selector de las tarjetas que contienen métricas
    await page.waitForSelector('.cartridge-card', { timeout: 30000 });

    // Extraer datos desde el DOM
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

      // Obtener métricas en las tarjetas
      document.querySelectorAll('.cartridge-card').forEach(card => {
        const title = card.querySelector('.cartridge-card-title')?.textContent.trim();
        const value = card.querySelector('.cartridge-value')?.textContent.trim();
        if (!title || !value) return;
        record[title] = value;
      });

      return record;
    });

    return result;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return null;
  }
};

// Función para generar el gráfico invocando un script externo (generateChart.js)
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
  // ... agregar aquí todas las URLs que necesites
];

// Nueva función scrapeAllAssets que abre una pestaña por cada URL y comparte sesión via BrowserContext
const scrapeAllAssets = async () => {
  const timestamp = new Date().toISOString();
  console.log(`🚀 Iniciando scraping: ${timestamp}`);

  let browser;
  let context;
  let loginPage;

  try {
    // 1) Lanzar el navegador
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--memory-pressure-off',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
    });
    console.log('✅ Browser lanzado');

    // 2) Crear un context para compartir la sesión de login entre pestañas
    context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      bypassCSP: true
    });

    // 3) Hacer login en una pestaña de "loginPage"
    loginPage = await context.newPage();
    console.log('✅ Nueva página de login creada');
    await login(loginPage);
    console.log('✅ Login exitoso, sesión iniciada');

    // 4) Preparar archivo NDJSON de salida
    const outputDir = path.resolve('data', 'cliente1');
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, 'dashboard-history.ndjson');
    console.log(`📁 Archivo de salida: ${file}`);
    console.log(`🔢 URLs a procesar: ${assetUrls.length}`);

    let processedCount = 0;

    // 5) Iterar sobre cada URL, abrir una pestaña nueva y scrapear
    for (const url of assetUrls) {
      let assetPage;
      try {
        assetPage = await context.newPage();
        console.log(`📥 Abriendo pestaña para: ${url}`);

        // Verificar que la página no esté cerrada desde un error anterior
        if (assetPage.isClosed()) {
          throw new Error('La pestaña se cerró antes de iniciar scrapeo');
        }

        const rec = await scrapeAsset(assetPage, url);
        if (rec) {
          fs.appendFileSync(file, JSON.stringify({ timestamp, ...rec }) + '\n');
          processedCount++;
          console.log(`✅ Procesado ${processedCount}/${assetUrls.length}: ${rec.assetName || 'Sin nombre'}`);
        } else {
          console.log(`⚠️ No se obtuvieron datos para: ${url}`);
        }
      } catch (assetError) {
        console.error(`❌ Error procesando ${url}:`, assetError.message);
        // Si se desea, se podría reintentar aquí antes de pasar al siguiente URL
      } finally {
        if (assetPage && !assetPage.isClosed()) {
          await assetPage.close();
          console.log('🧹 Pestaña de asset cerrada');
        }
      }

      // Breve pausa entre URLs para no sobrecargar el servidor
      await wait(2000);
    }

    console.log(`✅ Scraping completado. Procesados: ${processedCount}/${assetUrls.length}`);
  } catch (err) {
    console.error('❌ Error durante el scraping general:', err.message);
    throw err;
  } finally {
    // Cerrar loginPage, context y browser si existen
    try {
      if (loginPage && !loginPage.isClosed()) {
        await loginPage.close();
        console.log('🧹 Pestaña de login cerrada');
      }
    } catch (e) {
      console.warn('⚠️ Error cerrando loginPage:', e.message);
    }
    try {
      if (context) {
        await context.close();
        console.log('🧹 Context cerrado');
      }
    } catch (e) {
      console.warn('⚠️ Error cerrando context:', e.message);
    }
    try {
      if (browser) {
        await browser.close();
        console.log('🧹 Browser cerrado');
      }
    } catch (e) {
      console.warn('⚠️ Error cerrando browser:', e.message);
    }

    // Forzar garbage collection si está disponible
    if (global.gc) global.gc();
    console.log('🧹 Cleanup final completado');
  }
};

// Función principal que ejecuta scrapeAllAssets y generateChart en un bucle infinito
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
    if (memUsage.heapUsed > 300 * 1024 * 1024) {
      console.log('⚠️ Memoria alta, ejecutando limpieza…');
      if (global.gc) {
        global.gc();
      }
    }

    console.log('⏳ Esperando 1 minuto...');
    await wait(60 * 1000);
    loopCount++;
  }
};

// Servidor HTTP con Express
const app = express();
app.use(cors());
const PORT = process.env.PORT || 10000;

app.get('/', (_req, res) => {
  res.send('Blockinar Scraper Service 👍');
});

// Capturar señales para cierre limpio
process.on('SIGTERM', () => {
  console.log('Recibida señal SIGTERM, cerrando aplicación...');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('Recibida señal SIGINT, cerrando aplicación...');
  process.exit(0);
});

// Arrancar servidor y bucle principal
app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  console.log(`Memoria inicial: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  mainLoop();
});

