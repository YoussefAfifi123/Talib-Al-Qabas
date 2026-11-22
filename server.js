import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEGACY_ORIGIN_REGEX = /https?:\/\/(?:__HOST__|ais-pre-6gnsl5m6lawzqxr3aukziq-540398746585\.europe-west1\.run\.app)/g;

function normalizeBaseUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

const CONFIGURED_ORIGIN = normalizeBaseUrl(process.env.APP_URL || process.env.SITE_URL);

function resolveRequestOrigin(req) {
  if (CONFIGURED_ORIGIN) return CONFIGURED_ORIGIN;
  const rawProto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim().toLowerCase();
  const proto = rawProto === 'http' ? 'http' : 'https';
  const rawHost = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000').split(',')[0].trim();
  const safeHost = /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(rawHost) ? rawHost : 'localhost:3000';
  return `${proto}://${safeHost}`;
}

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

const [
  rawSitemap,
  rawRobots,
  rawVerification,
  rawIndex,
] = await Promise.all([
  readOptionalFile(path.join(PUBLIC_DIR, 'sitemap.xml')),
  readOptionalFile(path.join(PUBLIC_DIR, 'robots.txt')),
  readOptionalFile(path.join(PUBLIC_DIR, 'google1b0cfb759c280007.html')),
  readOptionalFile(path.join(PUBLIC_DIR, 'index.html')),
]);

function createOriginRenderer(template, fallbackFactory) {
  if (CONFIGURED_ORIGIN) {
    const preRendered = template !== null
      ? template.replace(LEGACY_ORIGIN_REGEX, CONFIGURED_ORIGIN)
      : (fallbackFactory ? fallbackFactory(CONFIGURED_ORIGIN) : null);
    return () => preRendered;
  }

  const cache = new Map();
  return (origin) => {
    if (cache.has(origin)) return cache.get(origin);
    const rendered = template !== null
      ? template.replace(LEGACY_ORIGIN_REGEX, origin)
      : (fallbackFactory ? fallbackFactory(origin) : null);
    if (cache.size > 32) cache.clear();
    cache.set(origin, rendered);
    return rendered;
  };
}

const renderSitemap = createOriginRenderer(rawSitemap);
const renderRobots = createOriginRenderer(
  rawRobots,
  (origin) => `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
);
const renderIndex = createOriginRenderer(rawIndex);

app.get('/sitemap.xml', (req, res) => {
  const xml = renderSitemap(resolveRequestOrigin(req));
  if (xml === null) {
    return res.status(404).type('text/plain').send('sitemap.xml not found');
  }
  res.type('application/xml').send(xml);
});

app.get(['/robots.txt', '/robot.txt'], (req, res) => {
  const txt = renderRobots(resolveRequestOrigin(req));
  res.type('text/plain').send(txt);
});

app.get('/google1b0cfb759c280007.html', (_req, res) => {
  res.type('text/html').send(rawVerification ?? 'google-site-verification: google1b0cfb759c280007.html');
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('*', (req, res) => {
  const html = renderIndex(resolveRequestOrigin(req));
  if (html === null) {
    return res.status(404).type('text/plain').send('index.html not found');
  }
  res.type('text/html').send(html);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
