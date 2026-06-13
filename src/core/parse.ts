import matter from 'gray-matter';

export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
  /** Set when the frontmatter is not valid YAML; frontmatter is {} in that case. */
  yamlError?: string;
}

export function parseFile(raw: string): ParsedFile {
  try {
    const parsed = matter(raw);
    const data = parsed.data;
    const frontmatter =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    return { frontmatter, body: parsed.content };
  } catch (err) {
    return {
      frontmatter: {},
      body: raw,
      yamlError: err instanceof Error ? err.message.split('\n')[0] : String(err),
    };
  }
}
