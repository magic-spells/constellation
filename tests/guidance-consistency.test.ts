import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS } from '../src/mcp/server.js';

// Agent guidance lives in three unshared copies — the MCP INSTRUCTIONS string, skill/SKILL.md
// and skill/methodology.md — and none of them imports another. This test is what keeps them
// from drifting: the load-bearing sentences must appear verbatim in every copy that carries
// them, the retired claims must appear in none, and no copy may name a tool that doesn't exist.
//
// It is a PHRASE test, not a style checker. Keep the lists short; every added phrase is a
// future false failure.

const ROOT = new URL('..', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');

const serverSource = read('src/mcp/server.ts');
const skill = read('skill/SKILL.md');
const methodology = read('skill/methodology.md');

// All three copies are hard-wrapped prose and two are markdown, so a phrase like "never edit a
// card file directly" is routinely split across a newline and a tool name may or may not be in
// backticks. Collapse whitespace and drop ` and * before matching — otherwise the test fails on
// a reflow or an emphasis change that changed no meaning.
const norm = (s: string) => s.replace(/[`*]/g, '').replace(/\s+/g, ' ');

const copies = [
  { name: 'INSTRUCTIONS', text: norm(INSTRUCTIONS) },
  { name: 'SKILL.md', text: norm(skill) },
  { name: 'methodology.md', text: norm(methodology) },
] as const;

type CopyName = (typeof copies)[number]['name'];
const only = (...names: readonly CopyName[]) => copies.filter((c) => names.includes(c.name));

const ALL: readonly CopyName[] = ['INSTRUCTIONS', 'SKILL.md', 'methodology.md'];

describe('INSTRUCTIONS', () => {
  it('is a non-trivial block', () => {
    expect(INSTRUCTIONS.length).toBeGreaterThan(500);
  });

  // The always-on string is the token bill on every session. This budget is the only thing
  // stopping it from creeping back to the ~240 lines it used to be.
  it('stays within the always-on budget', () => {
    expect(INSTRUCTIONS.split('\n').length).toBeLessThanOrEqual(55);
  });

  it('has no unresolved template interpolation', () => {
    expect(INSTRUCTIONS).not.toContain('${');
  });
});

it('the skill stays a pointer, not a second novel', () => {
  expect(skill.split('\n').length).toBeLessThanOrEqual(340);
});

// ---------------------------------------------------------------------------
// Canonical sentences: exact substrings (after normalization) in every copy
// that carries them. Reword one and this names the copies that disagree.
// ---------------------------------------------------------------------------

const CANON: Array<{ id: string; text: string; in: readonly CopyName[] }> = [
  {
    id: 'write rule + rationale',
    text:
      'The rule: all card writes go through the Constellation tools; never edit a card ' +
      "file directly — hand-edits invent fields and formats the schema doesn't support, " +
      'feeding bad data to the viewer and to every future agent that loads the plan.',
    in: ALL,
  },
  {
    id: 'write-failure path',
    text:
      'When a write tool errors (STALE, NOT_FOUND, a reserved-key rejection, a timeout), ' +
      're-read the card and retry, or report the failure — never fall through to editing the file.',
    in: ALL,
  },
  {
    id: 'the handoff bar',
    text:
      'a later agent can change this area without rediscovering the why, the gotchas, and the contracts',
    in: ['SKILL.md', 'methodology.md'],
  },
  {
    id: 'drift is commit-relative; a dirty tree is not drift',
    text:
      'Commit the card together with the code; stale_report on a dirty tree flags work in ' +
      'progress — expected, not drift to fix.',
    in: ALL,
  },
  { id: 'rename path', text: 'never delete-and-recreate to rename', in: ALL },
];

describe.each(CANON)('canonical: $id', ({ text, in: names }) => {
  it.each(only(...names))('appears verbatim in $name', ({ text: copy }) => {
    expect(copy).toContain(norm(text));
  });
});

// ---------------------------------------------------------------------------
// Rules that must be STATED, wording free — where the copies legitimately
// differ in depth (a clause in INSTRUCTIONS, the full rule in SKILL.md).
// ---------------------------------------------------------------------------

const RULES: Array<{ id: string; patterns: RegExp[]; in: readonly CopyName[] }> = [
  {
    id: 'update_card replace semantics',
    patterns: [
      /patch\.fields deep-merges/i,
      /arrays replace/i,
      /patch\.connections/,
      /body[^.]{0,60}replace|replace[^.]{0,60}body/i,
    ],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'cheap writes are the byte-preserving ones',
    patterns: [/append_note/, /edit_section/, /byte-preserving/i],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'never bulk-rewrite plan.md',
    patterns: [/bulk-rewrite plan\.md/i],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'bulk changes loop the singular tools',
    patterns: [/never search-and-replace the plan folder/i],
    in: ALL,
  },
  {
    id: 'delete_card leaves dangling references',
    patterns: [/delete_card/, /referenced_by/, /E005/],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'remove_connection only strips the connections list',
    patterns: [/remove_connection/, /connections:/, /mermaid/i],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'the four reserved keys',
    patterns: [/reserved keys — name, kind, status, connections/i],
    in: ['SKILL.md'],
  },
  {
    id: 'structured refs error (E005), prose refs warn (W004)',
    patterns: [/E005/, /W004/],
    in: ['SKILL.md', 'methodology.md'],
  },
  {
    id: 'connections come only from frontmatter; a prose link is not an edge',
    patterns: [
      /connections come (only )?from frontmatter|come from frontmatter ONLY/i,
      /never an edge/i,
    ],
    in: ALL,
  },
  {
    id: 'hydration degrades explicitly rather than truncating',
    patterns: [/hydration_budget/, /never truncates silently|degrade/i],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'flat list tools page',
    patterns: [/offset|page/i, /more/],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'orient is the session-start call',
    patterns: [/orient/],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'a card you cannot trust is worse than none',
    patterns: [/worse than no card/i],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'plan-first is scoped to behavior changes',
    patterns: [/behavior change/i, /plan-first/i],
    in: ALL,
  },
  {
    id: '"sync the plan" means agreement, not stamping a marker',
    patterns: [/bringing code and cards into agreement/i, /not stamping a marker/i],
    in: ALL,
  },
  {
    id: 'search beats grep for card lookups',
    patterns: [/search/i, /grep/i],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'describe_type before authoring an unfamiliar type',
    patterns: [/describe_type/],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'NO_PLAN_FOUND → init_plan, never hand-write plan.md',
    patterns: [/NO_PLAN_FOUND/, /init_plan/],
    in: ['INSTRUCTIONS', 'SKILL.md'],
  },
  {
    id: 'status vocabulary',
    patterns: [/planned/, /building/, /built/, /verified/],
    in: ALL,
  },
  {
    id: 'set_verified is the drift baseline',
    patterns: [/set_verified/, /verified_sha/],
    in: ALL,
  },
];

describe.each(RULES)('rule: $id', ({ patterns, in: names }) => {
  it.each(only(...names))('is stated in $name', ({ text }) => {
    for (const pattern of patterns) expect(text).toMatch(pattern);
  });
});

// ---------------------------------------------------------------------------
// Retired claims: each of these was true, or was believed true, and is not any more.
// ---------------------------------------------------------------------------

const RETIRED: Array<{ id: string; pattern: RegExp }> = [
  {
    id: 'rebuildable-from-the-plan-alone bar',
    pattern: /rebuild(able)?[^.]{0,60}from the plan alone/i,
  },
  {
    // check_integrity lints the plan; it has never read the repo's source tree.
    id: 'check_integrity finds code without cards',
    pattern: /code-without-cards|code with no card/i,
  },
  {
    id: 'the 21-row type table (describe_type replaces it)',
    pattern: /\|\s*COMPONENT-?\s*\|/,
  },
  { id: 'never auto-compact', pattern: /never auto-compact/i },
  { id: 'set_sync_point as a required step', pattern: /then set_sync_point/i },
  {
    // Prose mentions were briefly walkable edges under an `edges` param. They are
    // not edges at all now, and no tool takes `edges`.
    id: 'the edges param / prose edges',
    pattern: /edges: "(structured|prose|both)"|prose edge|structured edge/i,
  },
];

describe.each(RETIRED)('retired: $id', ({ pattern }) => {
  it.each(copies)('is absent from $name', ({ text }) => {
    expect(text).not.toMatch(pattern);
  });
});

// ---------------------------------------------------------------------------
// No copy may name a tool that doesn't exist.
// ---------------------------------------------------------------------------

// Registered tool AND prompt names — methodology.md names the bootstrap_plan / audit_plan
// prompts, which are registered with registerPrompt, not registerTool.
const TOOL_NAMES = new Set(
  [...serverSource.matchAll(/register(?:Tool|Prompt)\(\s*'([a-z_]+)'/g)].map((m) => m[1]),
);

// snake_case words in the guidance that are fields, params, or response keys — not tools.
const NOT_TOOLS = new Set([
  'code_refs',
  'verified_sha',
  'verified_at',
  'connected_repos',
  'notes_limit',
  'notes_truncated',
  'response_schema',
  'referenced_by',
  'hydrated_elsewhere',
  'hydration_budget',
  'degraded_to_summary',
  'format_review',
  'total_hits',
  'if_mtime',
]);

// Prose pluralizes tool names ("concurrent `update_card`s"), and norm() strips the backticks,
// so a token whose singular is a real tool counts as known.
const known = (t: string) =>
  TOOL_NAMES.has(t) ||
  NOT_TOOLS.has(t) ||
  (t.endsWith('s') && TOOL_NAMES.has(t.slice(0, -1)));

// Load-bearing: a harvest regex that silently matched nothing would make every real tool name
// look unknown, and the failure would point at the guidance instead of at the regex.
it('harvested the tool registry', () => {
  expect(TOOL_NAMES.size).toBeGreaterThan(20);
});

// atlas.md is a TOPICAL reference, like types/*.md — not a fourth copy of the canonical
// guidance, so it is deliberately absent from `copies` and from the phrase checks above.
// It still names tools in prose, so it joins this one check and no other.
const namesTools = [...copies, { name: 'atlas.md', text: norm(read('skill/atlas.md')) }];

describe.each(namesTools)('$name', ({ text }) => {
  it('names only tools that exist', () => {
    const tokens = new Set(text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
    expect([...tokens].filter((t) => !known(t))).toEqual([]);
  });
});

it('methodology.md is where the MCP prompts expect it', () => {
  expect(methodology).toMatch(/^# Building & auditing a plan from a codebase/);
});
