// Verify that the committed Langium output still matches the grammar.
// langium-cli generates packages/language/src/generated and the TextMate
// grammar from src/gas.langium, and both are committed. Only the language
// package's own build script runs the generator and the root build is a plain
// `tsc -b`, so a grammar edit committed without regenerating would otherwise
// ship a parser that does not match it.
//
// Generation is redirected into a scratch directory and the committed bytes are
// compared, never rewritten: the same contract as `pnpm check:validators`.
// Regenerating in place and diffing the checkout answers a different question.
// `git diff` compares the worktree with the index, so a grammar that has been
// edited and correctly regenerated reads as stale until it is staged, and
// staging it reads as current either way. It is also blind to a file the
// generator newly emits, and langium-cli prompts on stdin when it finds an
// unexpected file in the output directory, which in a non-interactive run exits
// zero having generated nothing.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = path.join(ROOT, 'packages', 'language');
const CONFIG = path.join(PACKAGE, 'langium-config.json');
const LANGIUM = path.join(PACKAGE, 'node_modules', '.bin', 'langium');

const OUT_DIRECTORY = 'generated';
const ASSET_DIRECTORY = 'assets';

/**
 * Rewrite a Langium config so every output lands under the scratch directory,
 * and report which committed files to compare it against. Grammar paths become
 * absolute because langium-cli resolves them against the config file's own
 * directory, which the copy no longer shares with the package.
 */
export function redirect(config, scratch) {
  const assets = [];
  const languages = (config.languages ?? []).map((language) => {
    const redirected = { ...language, grammar: path.resolve(PACKAGE, language.grammar) };
    // Highlighting generators carry their own `out`, outside the shared directory.
    for (const [key, value] of Object.entries(language)) {
      if (typeof value?.out !== 'string') continue;
      const relative = path.join(ASSET_DIRECTORY, language.id, path.basename(value.out));
      redirected[key] = { ...value, out: relative };
      assets.push({
        committed: path.resolve(PACKAGE, value.out),
        generated: path.join(scratch, relative)
      });
    }
    return redirected;
  });
  return {
    config: { ...config, languages, out: OUT_DIRECTORY },
    assets,
    committed: path.resolve(PACKAGE, config.out ?? 'src/generated'),
    generated: path.join(scratch, OUT_DIRECTORY)
  };
}

async function readOptional(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function listOptional(directory) {
  try {
    // Dotfiles are never generator output: an editor or the Finder leaving one
    // in the output directory is not a stale generated file.
    return (await readdir(directory)).filter((name) => !name.startsWith('.')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Compare one committed file against its freshly generated counterpart. */
async function compare({ committed, generated }) {
  const [fresh, current] = await Promise.all([readOptional(generated), readOptional(committed)]);
  const name = path.relative(ROOT, committed);
  if (fresh === undefined) return `${name}: no longer generated`;
  if (current === undefined) return `${name}: generated but not committed`;
  return fresh.equals(current) ? undefined : `${name}: out of date`;
}

async function generate(plan, scratch) {
  const configCopy = path.join(scratch, 'langium-config.json');
  await writeFile(configCopy, `${JSON.stringify(plan.config, null, 2)}\n`);
  try {
    await run(LANGIUM, ['generate', '--file', configCopy], { cwd: scratch });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`langium-cli is not installed at ${path.relative(ROOT, LANGIUM)}`);
    }
    throw error;
  }
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'gas-langium-'));
  try {
    const plan = redirect(config, scratch);
    await generate(plan, scratch);

    // Compare the union of both listings, so a file that appears or disappears
    // is a failure rather than something neither side thinks to mention.
    const names = [
      ...new Set([...(await listOptional(plan.generated)), ...(await listOptional(plan.committed))])
    ].sort();
    const pairs = [
      ...names.map((name) => ({
        committed: path.join(plan.committed, name),
        generated: path.join(plan.generated, name)
      })),
      ...plan.assets
    ];

    // A configuration that compares nothing is a failure, not a pass.
    if (pairs.length === 0) {
      console.error(`${path.relative(ROOT, CONFIG)} declares no generated files.`);
      process.exitCode = 1;
      return;
    }

    const problems = (await Promise.all(pairs.map(compare))).filter(
      (problem) => problem !== undefined
    );
    if (problems.length > 0) {
      console.error('Committed language files no longer match the grammar:');
      for (const problem of problems) console.error(`  ${problem}`);
      console.error(
        '\nRun `pnpm --filter @luna-estelar/gas-language langium:generate` and commit the result.'
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Generated language files are current: ${pairs.length} files match ` +
        `${path.relative(ROOT, CONFIG)}.`
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
