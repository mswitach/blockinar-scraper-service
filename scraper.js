import fs from 'fs';
import path from 'path';

const dataDir = path.resolve('./data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

async function scraper() {
  try {
    // Simulación de datos scrapeados
    const scrapedData = [
      { id: 1, title: 'Asset 1', location: 'Buenos Aires', metric: 123 },
      { id: 2, title: 'Asset 2', location: 'Cordoba', metric: 456 }
    ];

    const filePath = path.join(dataDir, 'scraped-data.ndjson');
    
    // Escribir cada objeto JSON como línea separada en el archivo NDJSON
    const stream = fs.createWriteStream(filePath, { flags: 'w' }); // 'w' para sobreescribir cada vez
    for (const item of scrapedData) {
      stream.write(JSON.stringify(item) + '\n');
    }
    stream.end();

    return true;
  } catch (error) {
    console.error('Error en scraper:', error);
    throw error;
  }
}

export { scraper };

