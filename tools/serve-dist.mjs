import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.env.PORT || process.argv[2] || 4174);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function resolvePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  return path.resolve(root, relativePath);
}

const server = http.createServer(async (request, response) => {
  try {
    const target = resolvePath(request.url || '/');
    if (!target.startsWith(root)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    let finalPath = target;
    try {
      const stats = await fs.stat(finalPath);
      if (stats.isDirectory()) {
        finalPath = path.join(finalPath, 'index.html');
      }
    } catch {
      finalPath = path.join(root, 'index.html');
    }

    const contents = await fs.readFile(finalPath);
    const extension = path.extname(finalPath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(contents);
  } catch {
    response.writeHead(500);
    response.end('Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving dist on http://127.0.0.1:${port}`);
});
