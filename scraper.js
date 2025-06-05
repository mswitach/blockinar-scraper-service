// scraper.js

import { chromium } from 'playwright';
import fs from 'fs/promises';

async function scrape() {
  console.log('Iniciando scraping...');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Ejemplo simple: ir a blockinar (puedes poner la URL que uses)
    await page.goto('https://blockinar.com');

    // Esperar algo (modificá según lo que scrapees)
    await page.waitForTimeout(2000);

    // Aquí debería ir tu lógica real de scraping,
    // ej: obtener datos, armar objeto con info

    const data = {
      timestamp: new Date().toISOString(),
      example: 'datos de prueba',
    };

    // Guardar en archivo NDJSON
    const line = JSON.stringify(data) + '\n';
    await fs.appendFile('./data/scraped-data.ndjson', line);

    console.log('Scraping finalizado y guardado.');
  } catch (error) {
    console.error('Error durante scraping:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

export default { scrape };

