import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compileDocs,
  prepareDocBody,
  shiftHeadings,
  stripTitleHeading,
} from '../src/core/docs.js';
import { loadPlan } from '../src/core/indexer.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A throwaway plan: `cards` is handle → frontmatter (+ optional `body`). */
async function planWith(
  cards: Record<string, Record<string, unknown> & { body?: string }>,
): Promise<Awaited<ReturnType<typeof loadPlan>>> {
  const dir = await mkdtemp(path.join(tmpdir(), 'constellation-docs-'));
  temps.push(dir);
  const root = path.join(dir, 'constellation');
  await mkdir(root, { recursive: true });

  for (const [handle, spec] of Object.entries(cards)) {
    const { body = '', ...frontmatter } = spec;
    const lines = Object.entries(frontmatter).map(
      ([key, value]) => `${key}: ${JSON.stringify(value)}`,
    );
    const file =
      handle === 'PLAN-PROJECT' ? 'plan.md' : `${handle.split('-')[0].toLowerCase()}/${handle}.md`;
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(
      path.join(root, file),
      `---\n${lines.join('\n')}\n---\n\n${body}\n`,
    );
  }
  return loadPlan(root);
}

describe('compileDocs — section ordering', () => {
  it('follows doc_sections order, not alphabetical or file order', async () => {
    const index = await planWith({
      'PLAN-PROJECT': {
        name: 'Thing',
        doc_sections: [
          { id: 'zeta', name: 'Zeta' },
          { id: 'alpha', name: 'Alpha', summary: 'first by intent, last by name' },
        ],
      },
      'DOC-A': { name: 'A', section: 'alpha' },
      'DOC-Z': { name: 'Z', section: 'zeta' },
    });

    const sections = compileDocs(index);
    expect(sections.map((s) => s.id)).toEqual(['zeta', 'alpha']);
    expect(sections[1].summary).toBe('first by intent, last by name');
  });

  it('appends an unregistered section at the end, alphabetically, titled from its slug', async () => {
    const index = await planWith({
      'PLAN-PROJECT': { name: 'Thing', doc_sections: [{ id: 'zeta', name: 'Zeta' }] },
      'DOC-Z': { name: 'Z', section: 'zeta' },
      'DOC-G': { name: 'G', section: 'getting-started' },
      'DOC-R': { name: 'R', section: 'reference' },
    });

    const sections = compileDocs(index);
    // Registered first, in authored order; the rest sorted by slug, never mixed in.
    expect(sections.map((s) => s.id)).toEqual(['zeta', 'getting-started', 'reference']);
    expect(sections[1].name).toBe('Getting Started');
    expect(sections[1].summary).toBe('');
  });

  it('drops a registered section nobody wrote a card for', async () => {
    const index = await planWith({
      'PLAN-PROJECT': {
        name: 'Thing',
        doc_sections: [{ id: 'empty', name: 'Empty' }, { id: 'real', name: 'Real' }],
      },
      'DOC-R': { name: 'R', section: 'real' },
    });

    expect(compileDocs(index).map((s) => s.id)).toEqual(['real']);
  });

  it('leaves a card with no section out of the document entirely', async () => {
    const index = await planWith({
      'PLAN-PROJECT': { name: 'Thing' },
      'DOC-IN': { name: 'In', section: 'guides' },
      'DOC-OUT': { name: 'Out' },
    });

    const sections = compileDocs(index);
    expect(sections).toHaveLength(1);
    expect(sections[0].cards.map((c) => c.handle)).toEqual(['DOC-IN']);
  });

  it('returns nothing at all when no card carries a section', async () => {
    const index = await planWith({ 'PLAN-PROJECT': { name: 'Thing' }, 'DOC-A': { name: 'A' } });
    expect(compileDocs(index)).toEqual([]);
  });
});

describe('compileDocs — card ordering', () => {
  it('sorts by order, then name, then handle', async () => {
    const index = await planWith({
      'PLAN-PROJECT': { name: 'Thing' },
      // Two cards share order 10 — the tie breaks on name, and the two that
      // share BOTH break on handle.
      'DOC-LAST': { name: 'Zed', section: 'guides', order: 30 },
      'DOC-B': { name: 'Same', section: 'guides', order: 10 },
      'DOC-A': { name: 'Same', section: 'guides', order: 10 },
      'DOC-MID': { name: 'Alpha', section: 'guides', order: 10 },
      'DOC-NONE': { name: 'Aardvark', section: 'guides' },
    });

    // Unnumbered sorts AFTER everything numbered, however early its name.
    expect(compileDocs(index)[0].cards.map((c) => c.handle)).toEqual([
      'DOC-MID',
      'DOC-A',
      'DOC-B',
      'DOC-LAST',
      'DOC-NONE',
    ]);
  });

  it('carries the card handle, name, type and raw body into the tree', async () => {
    const index = await planWith({
      'PLAN-PROJECT': { name: 'Thing' },
      'API-TICKETS': { name: 'Tickets', section: 'guides', body: '# Tickets\n\nBody.' },
    });

    expect(compileDocs(index)[0].cards[0]).toEqual({
      handle: 'API-TICKETS',
      name: 'Tickets',
      type: 'API',
      // Raw: heading shifting is a render concern, not part of the tree.
      body: '\n# Tickets\n\nBody.\n',
    });
  });
});

describe('shiftHeadings', () => {
  it('pushes every heading down two levels, capped at h6', () => {
    const shifted = shiftHeadings('# One\n\n## Two\n\n#### Four\n\n##### Five\n\n###### Six\n');
    expect(shifted.split('\n\n')).toEqual([
      '### One',
      '#### Two',
      '###### Four',
      '###### Five',
      '###### Six\n',
    ]);
  });

  it('skips a fenced block WHOLE, so a comment inside it is not a heading', () => {
    const body = ['## Setup', '', '```bash', '# install the thing', 'npm i', '```', '', '## Use'].join(
      '\n',
    );
    const shifted = shiftHeadings(body).split('\n');

    expect(shifted[0]).toBe('#### Setup');
    expect(shifted[3]).toBe('# install the thing');
    expect(shifted[7]).toBe('#### Use');
  });

  it('closes a fence only on its own delimiter', () => {
    // A ~~~ line inside a ``` fence must not end it, or the headings after the
    // real close would be left unshifted.
    const body = ['````', '~~~', '# not a heading', '````', '', '## real'].join('\n');
    const shifted = shiftHeadings(body).split('\n');
    expect(shifted[2]).toBe('# not a heading');
    expect(shifted[5]).toBe('#### real');
  });

  it('leaves a hash that is not a heading alone', () => {
    expect(shiftHeadings('#nospace\n\n#######  seven\n')).toBe('#nospace\n\n#######  seven\n');
  });
});

describe('stripTitleHeading', () => {
  it('drops a leading H1 that restates the name, comparing loosely', () => {
    expect(stripTitleHeading('#  system overview \n\nIntake is…', 'System Overview')).toBe(
      'Intake is…',
    );
  });

  it('keeps an H1 that says something else', () => {
    const body = '# Tickets API\n\nGET returns…';
    expect(stripTitleHeading(body, 'List & create tickets')).toBe(body);
  });

  it('keeps a matching H1 that is not the first thing in the body', () => {
    const body = 'Prose first.\n\n# Ticket card\n';
    expect(stripTitleHeading(body, 'Ticket card')).toBe(body);
  });

  it('is a no-op for a card with no name', () => {
    expect(stripTitleHeading('# Something\n\nx', '')).toBe('# Something\n\nx');
  });
});

describe('prepareDocBody', () => {
  it('drops the duplicate title and shifts what is left', () => {
    const body = '# Ticket card\n\nOne ticket in the list.\n\n## Props\n\n- ticket\n';
    expect(prepareDocBody(body, 'Ticket card')).toBe(
      'One ticket in the list.\n\n#### Props\n\n- ticket\n',
    );
  });
});

describe('the golden plan compiles', () => {
  it('renders three sections in the order plan.md declares', async () => {
    const sections = compileDocs(await loadPlan(GOLDEN));

    expect(sections.map((s) => s.id)).toEqual(['overview', 'ticket-lifecycle', 'interface']);
    expect(sections[0].cards.map((c) => c.handle)).toEqual([
      'DIAGRAM-SYSTEM-OVERVIEW',
      'ROLE-SUPPORT-AGENT',
      'DECISION-NO-HARD-DELETE',
    ]);
    expect(sections[2].name).toBe('Interface');

    // The mermaid fence in DIAGRAM-SYSTEM-OVERVIEW survives untouched, and its
    // H1 (which restates the card's name) is gone.
    const overview = prepareDocBody(sections[0].cards[0].body, sections[0].cards[0].name);
    expect(overview.startsWith('```mermaid')).toBe(true);
    expect(overview).toContain('PAGE-INBOX --> API-TICKETS');
  });
});
