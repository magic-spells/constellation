import { loadPlan } from './indexer.js';
import { loadSchemas } from './validate.js';
import type { Issue, PlanIndex } from './types.js';

export interface LintResult {
  index: PlanIndex;
  issues: Issue[];
  errors: Issue[];
  warnings: Issue[];
}

/** Structural checks (indexer) + schema validation, sorted by file then code. */
export async function lintPlan(root: string): Promise<LintResult> {
  const index = await loadPlan(root);
  const schemas = await loadSchemas();

  const issues: Issue[] = [...index.issues];
  for (const card of index.cards.values()) {
    issues.push(...schemas.validateCard(card));
  }

  issues.sort(
    (x, y) => x.file.localeCompare(y.file) || x.code.localeCompare(y.code),
  );

  return {
    index,
    issues,
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}
