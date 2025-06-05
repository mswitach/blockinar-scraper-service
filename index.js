import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { scrapeAllAssets } from "./scraper.js";

dotenv.config();

if (!process.env.BLOCKINAR_EMAIL || !process.env.BLOCKINAR_PASSWORD) {
  console.error("❌ BLOCKINAR_EMAIL y BLOCKINAR_PASSWORD son requeridas");
  process.exit(1);
}

const assetUrls = [
  //"https://blockinar.io/things/asset-info?core_id=lVl6m2JrnjEH4iHlrKXe&tab=dashboard",
  "https://blockinar.io/things/asset-info?core_id=mqpImzWSxjywdrfhwJWO&tab=dashboard",
];

const generateChart = () => new Promise((resolve, reject) => {
  console.log("📊 Generando gráfico...");
  exec("node generateChart.js", (error, stdout, stderr) => {
    if (error) return reject(error);
    if (stderr) console.warn(stderr);
    console.log(stdout);
    resolve();
  });
});

const runOnce = async () => {
  console.log(`🚀 Starting scraping, memory used: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  await scrapeAllAssets(assetUrls, process.env.BLOCKINAR_EMAIL, process.env.BLOCKINAR_PASSWORD);
  await generateChart();
  console.log(`✅ Finished scraping, final memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
};

const app = express();
app.use(cors());
const PORT = process.env.PORT || 10000;

app.get("/", (_req, res) => res.send("Blockinar Scraper Service 👍"));
app.get("/health", (_req, res) => res.send("ok"));

app.get("/data", (req, res) => {
  const file = path.resolve("data", "cliente1", "dashboard-history.ndjson");
  if (!fs.existsSync(file)) return res.json({ message: "No data available yet. Run /scrape first." });
  res.setHeader("Content-Type", "application/x-ndjson");
  fs.createReadStream(file).pipe(res);
});

app.get("/scrape", async (req, res) => {
  try {
    console.log("🔄 Scraping triggered via /scrape");
    await runOnce();
    res.json({ success: true, message: "Scraping completed successfully" });
  } catch (error) {
    console.error("❌ Error scraping:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

process.on("SIGTERM", () => { console.log("SIGTERM received, exiting..."); process.exit(0); });
process.on("SIGINT", () => { console.log("SIGINT received, exiting..."); process.exit(0); });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

