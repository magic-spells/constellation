import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const directory = dirname(fileURLToPath(import.meta.url));
export const root = join(directory, '..', '..');

async function filesIn(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file, extension) : file.endsWith(extension) ? [file] : [];
  }));
  return files.flat().sort();
}

// Deliberately look inside four-backtick Markdown examples in the authoring skill.
// An inline mention of a fence is not a diagram.
export function mermaidFences(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const fences = [];
  for (let index = 0; index < lines.length; index++) {
    const opening = lines[index].match(/^ {0,3}(`{3,}|~{3,})mermaid\s*$/i);
    if (!opening) continue;
    const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`);
    let end = index + 1;
    while (end < lines.length && !closing.test(lines[end])) end++;
    if (end === lines.length) throw new Error(`Unclosed Mermaid fence at line ${index + 1}`);
    fences.push({ source: lines.slice(index + 1, end).join('\n'), line: index + 1 });
    index = end;
  }
  return fences;
}

export async function collect() {
  const diagrams = [];
  for (const folder of ['constellation', 'examples/constellation', 'skill']) {
    for (const file of await filesIn(join(root, folder), '.md')) {
      for (const fence of mermaidFences(await readFile(file, 'utf8'))) {
        const name = `${relative(root, file)}:${fence.line}`;
        diagrams.push({ name, file: relative(root, file), fixture: false, ...fence });
      }
    }
  }
  for (const file of await filesIn(join(directory, 'fixtures'), '.mmd')) {
    diagrams.push({ name: relative(directory, file), file: relative(root, file), line: 1,
      fixture: true, source: (await readFile(file, 'utf8')).trimEnd() });
  }
  return diagrams;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await collect(), null, 2));
}
