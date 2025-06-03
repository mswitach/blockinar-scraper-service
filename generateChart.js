import fs from 'fs';
import path from 'path';

const generateChart = () => {
  try {
    const dataFile = path.resolve('data', 'cliente1', 'dashboard-history.ndjson');
    
    if (!fs.existsSync(dataFile)) {
      console.log('📊 No hay datos disponibles para generar gráfico');
      return;
    }

    // Leer las líneas del archivo NDJSON
    const fileContent = fs.readFileSync(dataFile, 'utf8');
    const lines = fileContent.trim().split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      console.log('📊 Archivo de datos vacío');
      return;
    }

    // Parsear los datos
    const records = [];
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        records.push(record);
      } catch (parseError) {
        console.error('Error parseando línea:', line, parseError.message);
      }
    }

    console.log(`📊 Procesando ${records.length} registros para gráfico`);
    
    // Agrupar por asset
    const assetData = {};
    records.forEach(record => {
      const assetName = record.assetName || 'Unknown Asset';
      if (!assetData[assetName]) {
        assetData[assetName] = [];
      }
      assetData[assetName].push({
        timestamp: record.timestamp,
        location: record.cartridgeLocation,
        serial: record.serialNumber,
        ...record
      });
    });

    // Generar resumen por asset
    const summary = {};
    Object.keys(assetData).forEach(assetName => {
      const assetRecords = assetData[assetName];
      const latest = assetRecords[assetRecords.length - 1];
      
      summary[assetName] = {
        totalRecords: assetRecords.length,
        latestTimestamp: latest.timestamp,
        location: latest.location || 'N/A',
        serial: latest.serial || 'N/A',
        metrics: {}
      };

      // Extraer métricas (excluyendo campos meta)
      Object.keys(latest).forEach(key => {
        if (!['timestamp', 'assetName', 'cartridgeLocation', 'serialNumber'].includes(key)) {
          summary[assetName].metrics[key] = latest[key];
        }
      });
    });

    // Guardar resumen
    const summaryFile = path.resolve('data', 'cliente1', 'chart-summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    
    console.log(`✅ Resumen generado con ${Object.keys(summary).length} assets`);
    console.log(`📁 Guardado en: ${summaryFile}`);
    
    // Log de últimos datos por asset
    Object.keys(summary).forEach(assetName => {
      const asset = summary[assetName];
      console.log(`🏭 ${assetName}:`);
      console.log(`   📍 Ubicación: ${asset.location}`);
      console.log(`   🔢 Serial: ${asset.serial}`);
      console.log(`   📊 Registros totales: ${asset.totalRecords}`);
      console.log(`   🕐 Último update: ${new Date(asset.latestTimestamp).toLocaleString()}`);
      
      // Mostrar métricas disponibles
      const metricsCount = Object.keys(asset.metrics).length;
      if (metricsCount > 0) {
        console.log(`   📈 Métricas disponibles: ${metricsCount}`);
      }
    });

  } catch (error) {
    console.error('❌ Error generando gráfico:', error.message);
    throw error;
  }
};

// Si se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  generateChart();
}

export default generateChart;
