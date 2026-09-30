import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { redirect } from '../scripts/check-language-generated.mjs';

const CONFIG = {
  projectName: 'Gas',
  languages: [
    {
      id: 'gas',
      grammar: 'src/gas.langium',
      fileExtensions: ['gas'],
      textMate: { out: 'syntaxes/gas.tmLanguage.json' }
    }
  ],
  out: 'src/generated'
};

const SCRATCH = path.join(path.sep, 'scratch');

describe('check-language-generated', () => {
  it('sends every output under the scratch directory', () => {
    const plan = redirect(CONFIG, SCRATCH);

    expect(plan.config.out).toBe('generated');
    expect(plan.generated).toBe(path.join(SCRATCH, 'generated'));
    expect(plan.committed).toMatch(/packages\/language\/src\/generated$/);

    // langium-cli resolves paths against the config file, which the copy in the
    // scratch directory no longer shares with the package.
    expect(path.isAbsolute(plan.config.languages[0].grammar)).toBe(true);
    expect(plan.config.languages[0].grammar).toMatch(/packages\/language\/src\/gas\.langium$/);

    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0].generated.startsWith(SCRATCH)).toBe(true);
    expect(plan.assets[0].committed).toMatch(/packages\/language\/syntaxes\//);
  });

  it('leaves members that are not generator outputs alone', () => {
    const plan = redirect(CONFIG, SCRATCH);
    expect(plan.config.languages[0].fileExtensions).toEqual(['gas']);
    expect(plan.config.projectName).toBe('Gas');
  });

  // A config declaring no outputs must compare nothing, so the script can treat
  // that as a failure rather than reporting a pass it never verified.
  it('collects no assets for a language without highlighting output', () => {
    const plan = redirect(
      { ...CONFIG, languages: [{ id: 'gas', grammar: 'src/gas.langium' }] },
      SCRATCH
    );
    expect(plan.assets).toEqual([]);
  });
});
