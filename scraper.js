import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const login = async (page, email, password) => {
  await page.goto("https://blockinar.io/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('text="Sign in with email"', { timeout: 10000 });
  await page.click('text="Sign in with email"');
  await page.fill('input[type="email"]', email);
  await page.click('button:has-text("NEXT")');
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("SIGN IN")');
  await page.waitForSelector("div.total-number span", { timeout: 30000 });
};

const scrapeAsset = async (page, url) => {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".cartridge-card", { timeout: 90000 });

    return await page.evaluate(() => {
      const record = {};
      const name = document.querySelector(".gateway-title")?.textContent.trim();
      if (name) record.assetName = name;
      const location = document.querySelector(".asset-info-container .layout-route")?.textContent.trim();
      if (location) record.cartridgeLocation = location;

      const serialSpans = Array.from(document.querySelectorAll("span")).filter(s => s.textContent.trim().startsWith("Serial Number:"));
      if (serialSpans.length >= 2) {
        record.serialNumber = serialSpans[1].textContent.replace("Serial Number:", "").trim();
      }

      document.querySelectorAll(".cartridge-card").forEach(card => {
        const title = card.querySelector(".cartridge-card-title")?.textContent.trim();
        const value = card.querySelector(".cartridge-value")?.textContent.trim();
        if (title && value) record[title] = value;
      });

      return record;
    });
  } catch (error) {
    console.error(`Error scraping ${url}: ${error.message}`);
    return null;
  }
};

export const scrapeAllAssets = async (assetUrls, email, password) => {
  const timestamp = new Date().toISOString();
  console.log(`🚀 Starting scraping at ${timestamp}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--memory-pressure-off",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    bypassCSP: true,
  });

  const loginPage = await context.newPage();
  await login(loginPage, email, password);
  await loginPage.close();

  const outputDir = path.resolve("data", "cliente1");
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, "dashboard-history.ndjson");

  let processedCount = 0;

  for (const url of assetUrls) {
    const page = await context.newPage();
    console.log(`📥 Scraping: ${url}`);
    const data = await scrapeAsset(page, url);
    if (data) {
      fs.appendFileSync(file, JSON.stringify({ timestamp, ...data }) + "\n");
      processedCount++;
      console.log(`✅ Scraped ${processedCount}/${assetUrls.length}: ${data.assetName || "Unnamed asset"}`);
    } else {
      console.warn(`⚠️ No data for: ${url}`);
    }
    await page.close();
    await wait(2000);
  }

  await context.close();
  await browser.close();
  if (global.gc) global.gc();

  console.log(`✅ Scraping finished. Processed: ${processedCount}/${assetUrls.length}`);
};

