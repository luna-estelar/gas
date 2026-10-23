// Verify every public manifest version, including versions published by an
// earlier attempt. This checks registry metadata presence, not signatures.
import { readFile, readdir } from 'node:fs/promises';

const packagesRoot = new URL('../packages/', import.meta.url);
const packages = [];
for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifest = JSON.parse(
    await readFile(new URL(`${entry.name}/package.json`, packagesRoot), 'utf8')
  );
  if (manifest.private !== true) packages.push(manifest);
}
if (packages.length === 0) throw new Error('No public packages found; nothing was verified.');

async function verify({ name, version }) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  let reason;
  for (let attempt = 0; attempt < 6; attempt++) {
    let terminal = false;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const manifest = await response.json();
        if (manifest.name !== name || manifest.version !== version) {
          reason = 'registry returned a different package or version';
          terminal = true;
        } else if (manifest.dist?.attestations?.provenance != null) {
          return;
        } else {
          reason = 'provenance metadata is missing';
        }
      } else {
        reason = `registry returned HTTP ${response.status}`;
        terminal = ![404, 429].includes(response.status) && response.status < 500;
        await response.body?.cancel();
      }
    } catch (error) {
      reason = error.message;
    }
    if (terminal) break;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`${name}@${version}: ${reason}`);
}

const failures = [];
for (const manifest of packages) {
  try {
    await verify(manifest);
    console.log(`Provenance present for ${manifest.name}@${manifest.version}.`);
  } catch (error) {
    failures.push(error.message);
  }
}
if (failures.length) {
  console.error(`npm verification failed:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
