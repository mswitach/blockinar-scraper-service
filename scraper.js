import { chromium } from 'playwright';

export async function runScraper() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 🟢 Acá va tu scraping real, por ejemplo:
    await page.goto('https://blockinar.com/login');
    // Simular login, navegar al asset, scrapear datos...

    const result = {
      title: await page.title(),
      timestamp: new Date().toISOString()
    };

    await browser.close();
    return result;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

