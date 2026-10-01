// Fail the release when a version it just published has no provenance
// attestation. npm accepts a publish without one, so the gap is otherwise
// silent. PUBLISHED is the changesets action's `published-packages` output.
//
// The caller runs this step only when the action reported a publish, so an
// empty list means the output is no longer wired up rather than that nothing
// shipped. That is how this check first went dead — the action renamed its
// outputs and the unread one read back as '', which `?? '[]'` does not catch —
// so treat it as a failure instead of reporting success over zero packages.
const raw = process.env.PUBLISHED?.trim() ?? '';
const published = raw === '' ? [] : JSON.parse(raw);

if (!Array.isArray(published) || published.length === 0) {
  console.error(
    'PUBLISHED is empty, but this step runs only after a publish. The changesets ' +
      'action output it reads must have been renamed: nothing was verified.'
  );
  process.exit(1);
}

const registry = 'https://registry.npmjs.org';

async function attestation(name, version) {
  // The registry can lag a fresh publish for a few seconds.
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`${registry}/${name.replace('/', '%2f')}/${version}`);
    if (response.ok) {
      const manifest = await response.json();
      if (manifest.dist?.attestations?.provenance !== undefined) return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return false;
}

const missing = [];
for (const { name, version } of published) {
  if (!(await attestation(name, version))) missing.push(`${name}@${version}`);
}

if (missing.length > 0) {
  console.error(`Published without provenance:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`Provenance present for ${published.length} package(s).`);
