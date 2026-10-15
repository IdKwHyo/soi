import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp, readdir, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

async function manifest(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, prefix), {withFileTypes: true})) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await manifest(directory, relative));
    else {
      assert.ok(entry.isFile(), `Export requires regular files: ${relative}`);
      const bytes = await readFile(path.join(directory, relative));
      files.push({path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// The hosting adapter copies the validated browser build without rewriting it.
// Server code, SQL migrations and platform bindings remain outside the output.
export async function exportBuiltClient(source, destination) {
  const before = await manifest(source);
  assert.ok(before.length, 'Cannot export an empty browser build.');
  await rm(destination, {recursive: true, force: true});
  await cp(source, destination, {recursive: true});
  assert.deepEqual(await manifest(destination), before, 'Exported browser assets must be byte-identical.');
  return before;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const script of ['scripts/build.mjs', 'scripts/validate.mjs']) {
    const result = spawnSync(process.execPath, [script], {cwd: root, stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`${script} failed (${result.signal || result.status}).`);
  }
  const files = await exportBuiltClient(path.join(root, 'build/client'), path.join(root, 'vercel-dist'));
  console.log(`Verified ${files.length} byte-identical browser assets in vercel-dist.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
