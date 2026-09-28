import { app } from './app.js';
import { initDb } from './db.js';
import { startContinuousSync } from './indexer.js';

const PORT = process.env.PORT || 3001;

// Start server
async function startServer() {
  try {
    await initDb();
    startContinuousSync(30000);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n========================================`);
      console.log(`VANTAGE API SERVER RUNNING ON PORT ${PORT}`);
      console.log(`Health: http://localhost:${PORT}/api/health`);
      console.log(`Markets: http://localhost:${PORT}/api/markets`);
      console.log(`Charter: http://localhost:${PORT}/api/charter`);
      console.log(`========================================\n`);
    });
  } catch (err) {
    console.error('Fatal server boot error:', err);
    process.exit(1);
  }
}

startServer();
