import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { runScraper } from './scraper.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Blockinar scraper está funcionando');
});

app.post('/scrape', async (req, res) => {
  try {
    await runScraper(); // función principal del scraper
    res.status(200).json({ message: 'Scraping ejecutado correctamente' });
  } catch (error) {
    console.error('Error al ejecutar el scraper:', error);
    res.status(500).json({ error: 'Error al ejecutar el scraper' });
  }
});

app.get('/data', (req, res) => {
  const filePath = path.resolve(__dirname, 'data.ndjson');

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('NDJSON file not found');
  }

  res.download(filePath, 'data.ndjson');
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});

