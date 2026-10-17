const parameters = new URLSearchParams(location.search);
const theme = parameters.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
const toggle = document.querySelector('#theme-toggle');
toggle.textContent = `Switch to ${theme === 'dark' ? 'light' : 'dark'}`;

function cssColor(name, fallback = '') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Copied from viewer/app/lib/markdown.js. Keep the Mermaid config and tint pass
// identical so this compares renderers, rather than two different integrations.
function parseHex(hex) {
  const h = hex.replace('#', '').trim();
  if (h.length === 3) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
  if (h.length === 6) return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return null;
}

function mix(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const c = pa.map((n, i) => Math.round(n + (pb[i] - n) * t));
  return `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

const NODE_HANDLE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;
function colorNodesByType(svg, panel) {
  for (const node of svg.querySelectorAll('g.node')) {
    const handle = (node.textContent ?? '').trim();
    if (!NODE_HANDLE.test(handle)) continue;
    const color = cssColor(`--t-${handle.slice(0, handle.indexOf('-'))}`);
    if (!color) continue;
    const fill = mix(panel, color, 0.35);
    for (const shape of node.querySelectorAll('rect, polygon, circle, ellipse, path')) {
      shape.style.fill = fill;
      shape.style.stroke = color;
    }
  }
}

function configureMermaid(mermaid) {
  const accent = cssColor('--color-brand', '#5c7cfa');
  const panel = cssColor('--color-surface', '#101013');
  const inset = cssColor('--color-surface-sunken', '#18181c');
  const text = cssColor('--color-ink', '#f4f4f5');
  const muted = cssColor('--color-muted', '#7f7f88');
  const border = cssColor('--color-border-strong', '#3a3a42');
  const bg = parseHex(cssColor('--color-page', '#09090b'));
  const isDark = bg ? (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 < 0.5 : false;
  const fill = mix(panel, accent, 0.15);
  const nodeBorder = mix(panel, accent, 0.55);
  document.documentElement.style.setProperty('--diagram-fill', fill);
  document.documentElement.style.setProperty('--diagram-border', nodeBorder);
  document.documentElement.style.setProperty('--diagram-cluster', mix(panel, accent, 0.06));
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
    themeVariables: {
      darkMode: isDark,
      background: 'transparent',
      primaryColor: fill,
      primaryBorderColor: nodeBorder,
      primaryTextColor: text,
      mainBkg: fill,
      nodeBorder,
      secondaryColor: mix(panel, accent, 0.08),
      tertiaryColor: inset,
      lineColor: muted,
      textColor: text,
      titleColor: text,
      clusterBkg: mix(panel, accent, 0.06),
      clusterBorder: border,
      edgeLabelBackground: panel,
      nodeTextColor: text,
    },
  });
  return panel;
}

function colorPeleNodesByType(svg, panel) {
  for (const node of svg.querySelectorAll('g.pele-node[data-id]')) {
    const handle = node.getAttribute('data-id');
    if (!NODE_HANDLE.test(handle)) continue;
    const color = cssColor(`--t-${handle.slice(0, handle.indexOf('-'))}`);
    if (!color) continue;
    // Exclude nested nodes, text, and icons; tint only this node's shapes.
    for (const shape of node.querySelectorAll('rect, polygon, circle, ellipse, path')) {
      if (shape.closest('g.pele-node') !== node || shape.closest('.pele-icon')) continue;
      shape.style.fill = mix(panel, color, 0.35);
      shape.style.stroke = color;
    }
  }
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function makeRow(diagram, index) {
  const row = element('section', 'comparison');
  row.id = `diagram-${index}`;
  row.append(element('h2', '', diagram.name));
  const columns = element('div', 'columns');
  const source = element('details', 'source');
  source.append(element('summary', '', 'Source'), element('pre', '', diagram.source));
  columns.append(source);
  const renderers = {};
  for (const name of ['mermaid', 'pele']) {
    const cell = element('div', `renderer ${name}`);
    const metrics = element('div', 'metrics', `${name} · waiting`);
    const canvas = element('div', 'canvas');
    cell.append(metrics, canvas);
    columns.append(cell);
    renderers[name] = { metrics, canvas };
  }
  row.append(columns);
  document.querySelector('#comparisons').append(row);
  return renderers;
}

function structure(canvas) {
  const svg = canvas.querySelector('svg');
  if (!svg) return null;
  return {
    root: Object.fromEntries([...svg.attributes].map(({ name, value }) => [name, value])),
    text: [...svg.querySelectorAll('text, foreignObject')].map((el) => el.textContent.trim()),
    textElements: svg.querySelectorAll('text').length,
    foreignObjects: svg.querySelectorAll('foreignObject').length,
    nodes: [...svg.querySelectorAll('g.node, g.pele-node, g.pele-cluster')].map((node) => ({
      id: node.getAttribute('data-id') ?? node.id,
      class: node.getAttribute('class'), text: node.textContent.trim(),
      shapes: [...node.children].filter((el) => ['rect', 'circle', 'ellipse', 'path', 'polygon'].includes(el.localName))
        .map((el) => ({ tag: el.localName, fill: el.style.fill || el.getAttribute('fill'), stroke: el.style.stroke || el.getAttribute('stroke') })),
    })),
    edges: [...svg.querySelectorAll('g.pele-edge, path.flowchart-link, path.transition, path.relation, .messageLine0, .messageLine1')]
      .map((el) => ({ tag: el.localName, id: el.id, class: el.getAttribute('class'), text: el.textContent.trim() })),
    classes: [...new Set([...svg.querySelectorAll('[class]')].map((el) => el.getAttribute('class')))],
    renderedWidth: svg.getBoundingClientRect().width,
    containerWidth: canvas.clientWidth,
  };
}

function resourceTotals() {
  const totals = {};
  for (const name of ['mermaid', 'pele']) {
    const entries = performance.getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname.startsWith(`/vendor/${name}/`));
    totals[name] = {
      transferBytes: entries.reduce((sum, entry) => sum + entry.transferSize, 0),
      encodedBodyBytes: entries.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      decodedBodyBytes: entries.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
      requests: entries.length,
      resources: entries.map((entry) => ({ path: new URL(entry.name).pathname,
        transferBytes: entry.transferSize, bodyBytes: entry.encodedBodySize })),
    };
  }
  return totals;
}

window.comparison = { ready: false };
async function run() {
  performance.setResourceTimingBufferSize(2000);
  const [mermaidModule, pele, allDiagrams, versions] = await Promise.all([
    import('/vendor/mermaid/mermaid.esm.min.mjs'),
    import('/vendor/pele/esm/lazy.js'),
    fetch('/diagrams.json').then((response) => response.json()),
    fetch('/versions.json').then((response) => response.json()),
  ]);
  const mermaid = mermaidModule.default;
  const panel = configureMermaid(mermaid);
  const diagrams = parameters.get('suite') === 'flow-state'
    ? allDiagrams.filter(({ name }) => /DIAGRAM-SYSTEM-OVERVIEW\.md:|STATE-TICKET\.md:/.test(name))
    : allDiagrams;
  const rows = [];
  for (const [index, diagram] of diagrams.entries()) {
    const cells = makeRow(diagram, index);
    const result = { name: diagram.name, type: null, mermaidMs: null, peleMs: null,
      mermaidError: null, peleError: null, mermaidType: null, peleType: null, structure: {} };
    try { result.peleType = pele.detectType(diagram.source); } catch { /* render records the error */ }
    try { result.mermaidType = mermaid.detectType(diagram.source); } catch { /* render records the error */ }
    result.type = result.peleType ?? result.mermaidType;
    // Load each parser outside the timer, including Mermaid's async diagram loader.
    // Parsing itself is measured again inside render() on both sides.
    try { await mermaid.mermaidAPI.getDiagramFromText(diagram.source); } catch { /* show render's verbatim error */ }
    try { await pele.load(result.peleType); } catch (error) { result.peleError = error.message ?? String(error); }
    for (const name of ['mermaid', 'pele']) {
      const { canvas, metrics } = cells[name];
      const start = performance.now();
      try {
        if (name === 'mermaid') {
          const rendered = await mermaid.render(`compare-${index}`, diagram.source);
          canvas.innerHTML = rendered.svg;
          colorNodesByType(canvas.querySelector('svg'), panel);
        } else {
          if (result.peleError) throw new Error(result.peleError);
          const rendered = pele.render(diagram.source, {
            maxWidth: canvas.clientWidth - 24,
            fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
            idPrefix: `pele-${index}-`,
            // Keep links/images disabled to match our strict viewer integration.
            links: false, images: false,
          });
          canvas.innerHTML = rendered.svg;
          colorPeleNodesByType(canvas.querySelector('svg'), panel);
        }
      } catch (error) {
        result[`${name}Error`] = error.message ?? String(error);
        canvas.replaceChildren(element('pre', 'error', result[`${name}Error`]));
        // Mermaid inserts an error SVG outside our container before rejecting.
        if (name === 'mermaid') document.getElementById(`dcompare-${index}`)?.remove();
      }
      result[`${name}Ms`] = Number((performance.now() - start).toFixed(3));
      metrics.textContent = `${name === 'mermaid' ? 'Mermaid' : 'Pele'} ${versions[name]} · ${result[`${name}Type`] ?? 'unknown'} · ${result[`${name}Ms`].toFixed(2)} ms${result[`${name}Error`] ? ' · ERROR' : ''}`;
      result.structure[name] = structure(canvas);
    }
    rows.push(result);
    document.querySelector('#status').textContent = `Rendered ${rows.length} / ${diagrams.length}`;
  }
  // ResourceTiming entries can arrive in the task following an import's resolution.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const bytes = resourceTotals();
  document.querySelector('#bytes').textContent = `Transferred · Mermaid ${bytes.mermaid.transferBytes.toLocaleString()} B (${bytes.mermaid.requests} requests) · Pele ${bytes.pele.transferBytes.toLocaleString()} B (${bytes.pele.requests} requests)`;
  const errors = rows.filter((row) => row.mermaidError || row.peleError).length;
  document.querySelector('#status').textContent = `${rows.length} diagrams · ${errors} rows with errors · ${theme} theme`;
  Object.assign(window.comparison, { versions, theme, rows, bytes, ready: true });
  toggle.disabled = false;
  document.querySelector('#download-results').disabled = false;
}

document.querySelector('#download-results').addEventListener('click', () => {
  const blob = new Blob([`${JSON.stringify(window.comparison, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `compare-${theme}${parameters.get('suite') === 'flow-state' ? '-flow-state' : ''}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

toggle.addEventListener('click', () => {
  parameters.set('theme', theme === 'dark' ? 'light' : 'dark');
  // A fresh page also re-renders Mermaid's literal theme colors and re-measures.
  location.search = parameters.toString();
});
run().catch((error) => {
  window.comparison.fatalError = error.message ?? String(error);
  document.querySelector('#status').textContent = window.comparison.fatalError;
});
