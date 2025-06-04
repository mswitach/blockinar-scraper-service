import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { exec } from "child_process";

dotenv.config();

// Validar variables de entorno requeridas
if (!process.env.BLOCKINAR_EMAIL || !process.env.BLOCKINAR_PASSWORD) {
  console.error(
    "❌ Error: BLOCKINAR_EMAIL y BLOCKINAR_PASSWORD son requeridas"
  );
  process.exit(1);
}

// Utility para esperar
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Proceso de login
const login = async (page) => {
  console.log("🔐 Iniciando proceso de login...");
  try {
    await page.goto("https://blockinar.io/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    console.log("✅ Página de login cargada");

    await page.waitForSelector('text="Sign in with email"', { timeout: 10000 });
    await page.click('text="Sign in with email"');
    console.log('✅ Clic en "Sign in with email"');

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', process.env.BLOCKINAR_EMAIL);
    console.log("✅ Email ingresado");

    await page.waitForSelector('button:has-text("NEXT")', { timeout: 10000 });
    await page.click('button:has-text("NEXT")');
    console.log("✅ Clic en NEXT");

    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.fill('input[type="password"]', process.env.BLOCKINAR_PASSWORD);
    console.log("✅ Password ingresado");

    await page.waitForSelector('button:has-text("SIGN IN")', {
      timeout: 10000,
    });
    await page.click('button:has-text("SIGN IN")');
    console.log("✅ Clic en SIGN IN");

    await page.waitForSelector("div.total-number span", { timeout: 30000 });
    console.log("✅ Dashboard cargado correctamente");
  } catch (error) {
    console.error("❌ Error durante login:", error.message);
    throw error;
  }
};

// Función para scrapear un asset
const scrapeAsset = async (page, url) => {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForSelector(".cartridge-card", { timeout: 60000 });

    const result = await page.evaluate(() => {
      const record = {};
      const name = document.querySelector(".gateway-title")?.textContent.trim();
      if (name) record.assetName = name;
      const location = document
        .querySelector(".asset-info-container .layout-route")
        ?.textContent.trim();
      if (location) record.cartridgeLocation = location;

      const serialSpans = Array.from(document.querySelectorAll("span")).filter(
        (s) => s.textContent.trim().startsWith("Serial Number:")
      );
      if (serialSpans.length >= 2) {
        record.serialNumber = serialSpans[1].textContent
          .replace("Serial Number:", "")
          .trim();
      }

      document.querySelectorAll(".cartridge-card").forEach((card) => {
        const title = card
          .querySelector(".cartridge-card-title")
          ?.textContent.trim();
        const value = card
          .querySelector(".cartridge-value")
          ?.textContent.trim();
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

// Generar gráfico con generateChart.js
const generateChart = () => {
  return new Promise((resolve, reject) => {
    console.log("📊 Generando gráfico con los datos actualizados...");
    exec("node generateChart.js", (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Error al generar el gráfico: ${error.message}`);
        return reject(error);
      }
      if (stderr) {
        console.error(`⚠️ Advertencias al generar el gráfico: ${stderr}`);
      }
      console.log(stdout);
      console.log("✅ Gráfico generado correctamente");
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
];

// Scrapeo de todos los assets compartiendo sesión
const scrapeAllAssets = async () => {
  const timestamp = new Date().toISOString();
  console.log(`🚀 Iniciando scraping: ${timestamp}`);

  let browser;
  let context;
  let loginPage;

  try {
    // Lanzar el navegador sin "--single-process"
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        /* '--single-process',  <--- eliminado */
        "--disable-gpu",
        "--memory-pressure-off",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    });
    console.log("✅ Browser lanzado");

    // Compartir sesión con un contexto
    context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      bypassCSP: true,
    });

    // Login inicial
    loginPage = await context.newPage();
    console.log("✅ Nueva página de login creada");
    await login(loginPage);
    console.log("✅ Login exitoso, sesión iniciada");

    // Preparar salida NDJSON
    const outputDir = path.resolve("data", "cliente1");
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, "dashboard-history.ndjson");
    console.log(`📁 Archivo de salida: ${file}`);
    console.log(`🔢 URLs a procesar: ${assetUrls.length}`);

    let processedCount = 0;

    // Procesar cada URL
    for (const url of assetUrls) {
      let assetPage;
      try {
        assetPage = await context.newPage();
        console.log(`📥 Abriendo pestaña para: ${url}`);

        if (assetPage.isClosed()) {
          throw new Error("La pestaña se cerró antes de iniciar scrapeo");
        }

        const rec = await scrapeAsset(assetPage, url);
        if (rec) {
          fs.appendFileSync(file, JSON.stringify({ timestamp, ...rec }) + "\n");
          processedCount++;
          console.log(
            `✅ Procesado ${processedCount}/${assetUrls.length}: ${
              rec.assetName || "Sin nombre"
            }`
          );
        } else {
          console.log(`⚠️ No se obtuvieron datos para: ${url}`);
        }
      } catch (assetError) {
        console.error(`❌ Error procesando ${url}:`, assetError.message);
      } finally {
        if (assetPage && !assetPage.isClosed()) {
          await assetPage.close();
          console.log("🧹 Pestaña de asset cerrada");
        }
      }

      await wait(2000); // Pausa breve
    }

    console.log(
      `✅ Scraping completado. Procesados: ${processedCount}/${assetUrls.length}`
    );
  } catch (err) {
    console.error("❌ Error durante el scraping general:", err.message);
    throw err;
  } finally {
    try {
      if (loginPage && !loginPage.isClosed()) {
        await loginPage.close();
        console.log("🧹 Pestaña de login cerrada");
      }
    } catch (e) {
      console.warn("⚠️ Error cerrando loginPage:", e.message);
    }
    try {
      if (context) {
        await context.close();
        console.log("🧹 Context cerrado");
      }
    } catch (e) {
      console.warn("⚠️ Error cerrando context:", e.message);
    }
    try {
      if (browser) {
        await browser.close();
        console.log("🧹 Browser cerrado");
      }
    } catch (e) {
      console.warn("⚠️ Error cerrando browser:", e.message);
    }

    if (global.gc) global.gc();
    console.log("🧹 Cleanup final completado");
  }
};

// Ejecución única
const runOnce = async () => {
  console.log("🚀 Ejecutando scraping una sola vez...");
  console.log(
    `Memoria usada: ${Math.round(
      process.memoryUsage().heapUsed / 1024 / 1024
    )}MB`
  );

  try {
    await scrapeAllAssets();
    await generateChart();
    console.log("✅ Scraping completado exitosamente");
  } catch (err) {
    console.error("❌ Error en scraping:", err.message);
  }

  const memUsage = process.memoryUsage();
  console.log(
    `Memoria final: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`
  );
};

// Configurar servidor HTTP
const app = express();
app.use(cors());
const PORT = process.env.PORT || 10000;

// Ruta raíz
app.get("/", (_req, res) => {
  res.send("Blockinar Scraper Service 👍");
});

// Ruta /health
app.get("/health", (_req, res) => {
  res.send("ok");
});

// Ruta /data para servir el NDJSON
app.get("/data", (req, res) => {
  const dataFile = path.resolve("data", "cliente1", "dashboard-history.ndjson");
  if (!fs.existsSync(dataFile)) {
    return res.json({ 
      message: "No data available yet. Run /scrape first to generate data." 
    });
  }
  res.setHeader("Content-Type", "application/x-ndjson");
  fs.createReadStream(dataFile).pipe(res);
});

// Ruta para ejecutar scraping manualmente
app.get("/scrape", async (req, res) => {
  try {
    console.log("🔄 Scraping iniciado desde endpoint /scrape");
    await runOnce();
    res.json({ success: true, message: "Scraping completado exitosamente" });
  } catch (error) {
    console.error("❌ Error en scraping desde endpoint:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Señales de cierre
process.on("SIGTERM", () => {
  console.log("Recibida señal SIGTERM, cerrando aplicación...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("Recibida señal SIGINT, cerrando aplicación...");
  process.exit(0);
});

// Inicio del servidor y ejecución única
app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  console.log(
    `Memoria inicial: ${Math.round(
      process.memoryUsage().heapUsed / 1024 / 1024
    )}MB`
  );
  runOnce(); // Cambiar mainLoop() por runOnce()
});
