const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = 3001;
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'simulation.json');

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    const initialData = {
      version: 1,
      simulations: [],
      activeSimulationId: null,
    };

    await fs.writeFile(
      DATA_FILE,
      JSON.stringify(initialData, null, 2) + '\n',
      'utf8'
    );
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Allow the Vite dev server to call this API from the browser.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.url === '/api/simulation' && req.method === 'GET') {
    try {
      await ensureDataFile();
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      return sendJson(res, 200, JSON.parse(raw));
    } catch (error) {
      console.error('Failed to read simulation.json:', error);
      return sendJson(res, 500, { error: 'Failed to read simulation.json' });
    }
  }

  if (req.url === '/api/simulation' && req.method === 'PUT') {
    try {
      const raw = await readRequestBody(req);
      const data = JSON.parse(raw);

      if (!data || !Array.isArray(data.simulations)) {
        return sendJson(res, 400, { error: 'Invalid simulation data' });
      }

      await ensureDataFile();
      await fs.writeFile(
        DATA_FILE,
        JSON.stringify(data, null, 2) + '\n',
        'utf8'
      );

      return sendJson(res, 200, {
        ok: true,
        savedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to write simulation.json:', error);
      return sendJson(res, 500, { error: 'Failed to write simulation.json' });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
});

ensureDataFile()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Allocator API running at http://localhost:${PORT}`);
      console.log(`Saving data to ${DATA_FILE}`);
    });
  })
  .catch((error) => {
    console.error('Could not initialize simulation storage:', error);
    process.exit(1);
  });
