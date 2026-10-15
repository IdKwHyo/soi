import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {exportBuiltClient} from '../scripts/build-vercel.mjs';
import {routeContext} from '../dist/routes.mjs';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const origin = 'https://soi-studio-preview.karndanai537.chatgpt.site';

test('deployment entry points retain local simulation and hand connected pages to their existing origin', () => {
  const redirects = new Map(config.redirects.map(rule => [rule.source, rule]));
  const rewrites = new Map(config.rewrites.map(rule => [rule.source, rule.destination]));
  for (const pathname of ['/', '/versionc', '/copilot', '/menu', '/signin-with-chatgpt']) {
    assert.equal(redirects.get(pathname)?.destination, origin + pathname, pathname);
    assert.equal(redirects.get(pathname)?.permanent, false, 'Full pages must use a temporary handoff.');
    assert.ok(!rewrites.has(pathname), 'Full mode must not run against a missing Vercel backend.');
  }
  for (const pathname of ['/demo', '/versionc/demo']) {
    assert.equal(routeContext(pathname).demo, true);
    assert.equal(rewrites.get(pathname), '/index.html');
    assert.ok(!redirects.has(pathname), 'Simulation must stay on Vercel.');
  }
  for (const pathname of ['/copilot/demo', '/menu/demo']) {
    assert.equal(rewrites.get(pathname), '/copilot/index.html');
    assert.ok(!redirects.has(pathname));
  }
  assert.equal(rewrites.get('/signin'), '/signin/index.html');
  for (const source of ['/index.html', '/versionc/index.html', '/copilot/index.html']) {
    assert.ok(redirects.get(source)?.destination.startsWith(origin + '/'), `${source} must not launch full mode on Vercel.`);
  }
});

test('routing cannot expose source, turn missing APIs into HTML, or become an external proxy', () => {
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'vercel-dist');
  assert.equal(config.cleanUrls, false);
  assert.equal(config.trailingSlash, false);
  for (const rule of config.rewrites) {
    assert.match(rule.source, /^\/[a-z/]+$/, 'Only explicit public pages may be rewritten.');
    assert.ok(!rule.source.startsWith('/api'));
    assert.match(rule.destination, /^\/[a-z/]*index\.html$/);
  }
  for (const rule of config.redirects) {
    const destination = new URL(rule.destination, 'https://deployment.test');
    assert.ok(['https://deployment.test', origin].includes(destination.origin));
    assert.equal(destination.search, '', 'No configured query override may discard incoming query values.');
    assert.equal(destination.hash, '', 'Let normal browser redirects retain the original section.');
    assert.ok(!rule.source.startsWith('/api'));
  }
  assert.ok(!config.functions && !config.proxy && !config.routes, 'No independent backend or route catch-all is introduced.');
});

test('localized policies and retired links retain the right presentation mode', () => {
  for (const source of ['/privacy', '/terms', '/th/privacy', '/th/terms']) {
    assert.equal(config.rewrites.find(rule => rule.source === source)?.destination, source + '/index.html');
  }
  for (const version of ['a', 'b']) {
    assert.equal(config.redirects.find(rule => rule.source === `/version${version}`)?.destination, origin + '/');
    assert.equal(config.redirects.find(rule => rule.source === `/version${version}/demo`)?.destination, '/demo');
  }
  const common = Object.fromEntries(config.headers.find(rule => rule.source === '/(.*)').headers.map(({key, value}) => [key, value]));
  assert.equal(common['X-Content-Type-Options'], 'nosniff');
  assert.equal(common['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(common['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
});

test('the export preserves nested binary and HTML bytes and replaces stale output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'soi-export-'));
  try {
    const source = path.join(root, 'client'), destination = path.join(root, 'output');
    await mkdir(path.join(source, 'images'), {recursive: true});
    await mkdir(destination);
    const binary = Buffer.from([0, 255, 128, 13, 10, 0, 97]);
    const html = '<!doctype html><html lang="th">สวัสดี</html>\n';
    await writeFile(path.join(source, 'images/test.webp'), binary);
    await writeFile(path.join(source, 'index.html'), html);
    await writeFile(path.join(destination, 'old.js'), 'obsolete');
    const files = await exportBuiltClient(source, destination);
    assert.equal(files.length, 2);
    assert.deepEqual(await readFile(path.join(destination, 'images/test.webp')), binary);
    assert.equal(await readFile(path.join(destination, 'index.html'), 'utf8'), html);
    assert.deepEqual((await readdir(destination)).sort(), ['images', 'index.html']);
    assert.ok(files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
