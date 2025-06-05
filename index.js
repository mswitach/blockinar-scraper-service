import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import scraper from './scraper.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/data', express.static(path.resolve('./data')));

app.get('/', (req, res) => {
  res.json({ message: 'Blockinar scraper service is running' });
});

app.post('/scrape', async (req, res) => {
  try {
    await scraper();

    const filePath = path.resolve('./data/scraped-data.ndjson');
    try {
      const stats = await fs.stat(filePath);
      res.json({ message: 'Scraping ejecutado correctamente', fileSize: stats.size });
    } catch (err) {
      res.status(500).json({ message: 'Scraping ejecutado, pero no se encontró el archivo.', error: err.message });
    }
  } catch (error) {
    res.status(500).json({ message: 'Error ejecutando el scraper', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

