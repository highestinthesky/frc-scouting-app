// Serves build/ the way GitHub Pages serves it.
//
//   npm run build && npm run serve:build      # http://localhost:4174
//
// `vite preview` is SvelteKit's preview server, not a static host, so it
// answers the questions the service worker depends on differently. This one
// answers them as production does: a folder serves its index.html, a folder
// asked for without its trailing slash is a 301 to it, and anything else gets
// 404.html with a 404 status — the fallback the team and match pages rely on.
// Stop it to test the app offline: the service worker is all that is left.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../build/', import.meta.url));
const port = Number(process.env.PORT ?? 4174);

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.txt': 'text/plain; charset=utf-8',
	'.woff2': 'font/woff2'
};

async function isFile(path) {
	return (await stat(path).catch(() => null))?.isFile() ?? false;
}

async function isDir(path) {
	return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

async function send(res, status, path) {
	const body = await readFile(path);
	res.writeHead(status, {
		'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
		// Pages sends max-age=600. No-cache here, so a rebuild is seen at once.
		'Cache-Control': 'no-cache'
	});
	res.end(body);
}

createServer(async (req, res) => {
	const { pathname } = new URL(req.url, 'http://localhost');
	const path = normalize(join(root, decodeURIComponent(pathname)));
	if (!path.startsWith(root)) {
		res.writeHead(400).end();
		return;
	}
	if (pathname.endsWith('/') && (await isFile(join(path, 'index.html')))) {
		return send(res, 200, join(path, 'index.html'));
	}
	if (await isFile(path)) return send(res, 200, path);
	if (await isDir(path)) {
		res.writeHead(301, { Location: `${pathname}/` }).end();
		return;
	}
	return send(res, 404, join(root, '404.html'));
}).listen(port, () => console.log(`build/ on http://localhost:${port}`));
