import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collect, directory, root } from './collect.mjs';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
const mounts = [
  ['/vendor/mermaid/', resolve(root, 'node_modules/mermaid/dist')],
  ['/vendor/pele/', resolve(root, 'node_modules/pele/dist')],
];
const pageFiles = new Set(['/index.html', '/app.mjs', '/styles.css']);

export async function startServer({ port = 4317 } = {}) {
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const hosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    if (!hosts.includes(request.headers.host) ||
        (request.headers.origin && !hosts.some((host) => request.headers.origin === `http://${host}`))) {
      response.writeHead(403).end('Loopback origin required');
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      let body;
      let contentType = 'application/json';
      if (pathname === '/diagrams.json') {
        body = JSON.stringify(await collect());
      } else if (pathname === '/versions.json') {
        const versions = {};
        for (const name of ['mermaid', 'pele']) {
          versions[name] = JSON.parse(await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
        }
        body = JSON.stringify(versions);
      } else {
        let base = directory;
        let suffix = pathname === '/' ? 'index.html' : pathname.slice(1);
        const mount = mounts.find(([prefix]) => pathname.startsWith(prefix));
        if (mount) {
          base = mount[1];
          suffix = pathname.slice(mount[0].length);
        } else if (pathname !== '/' && !pageFiles.has(pathname)) {
          response.writeHead(404).end('Not found');
          return;
        }
        const baseReal = await realpath(base);
        const candidate = resolve(baseReal, suffix);
        if (!candidate.startsWith(`${baseReal}${sep}`)) {
          response.writeHead(403).end('Outside static root');
          return;
        }
        const file = await realpath(candidate);
        if (!file.startsWith(`${baseReal}${sep}`)) {
          response.writeHead(403).end('Outside static root');
          return;
        }
        body = await readFile(file);
        contentType = types[extname(file)] ?? 'application/octet-stream';
      }
      response.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8`,
        'Content-Length': Buffer.byteLength(body) });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400).end(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startServer({ port: Number(process.env.PORT ?? 4317) });
  console.log(`Renderer comparison: ${url}`);
}
