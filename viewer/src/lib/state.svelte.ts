import type { Card, Connection, Issue } from './types';

class PlanState {
  cards = $state<Card[]>([]);
  connections = $state<Connection[]>([]);
  errors = $state<Issue[]>([]);
  warnings = $state<Issue[]>([]);
  loaded = $state(false);
  editable = $state(false);

  byHandle = $derived(new Map(this.cards.map((c) => [c.handle, c])));

  byType = $derived.by(() => {
    const map = new Map<string, Card[]>();
    for (const card of this.cards) {
      if (!map.has(card.type)) map.set(card.type, []);
      map.get(card.type)!.push(card);
    }
    return map;
  });

  neighbors = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const { a, b } of this.connections) {
      if (!map.has(a)) map.set(a, []);
      if (!map.has(b)) map.set(b, []);
      map.get(a)!.push(b);
      map.get(b)!.push(a);
    }
    for (const list of map.values()) list.sort();
    return map;
  });

  async load(): Promise<void> {
    const res = await fetch('/api/plan');
    const data = await res.json();
    this.cards = data.cards;
    this.connections = data.connections;
    this.errors = data.errors;
    this.warnings = data.warnings;
    this.editable = data.editable ?? false;
    this.loaded = true;
  }

  listen(): void {
    const source = new EventSource('/events');
    source.onmessage = (event) => {
      if (event.data === 'change') void this.load();
    };
  }
}

export const plan = new PlanState();

// Hash-based routing: the URL path always stays "/", so refreshing a deep view
// (or opening it from a file path) never breaks asset loading.
function readHashPath(): string {
  const h = location.hash;
  return h.startsWith('#/') ? h.slice(1) : '/';
}

class RouteState {
  path = $state(readHashPath());

  go(path: string): void {
    if (path === this.path) return;
    location.hash = path; // triggers hashchange → sync()
  }

  sync(): void {
    this.path = readHashPath();
    window.scrollTo(0, 0);
  }
}

export const route = new RouteState();

export const THEMES = [
  { id: 'observatory', label: 'Observatory' },
  { id: 'dim', label: 'Dim' },
  { id: 'claw', label: 'Claw' },
  { id: 'black', label: 'Black' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'sumi', label: 'Sumi' },
  { id: 'daylight', label: 'Daylight' },
  { id: 'nord', label: 'Nord' },
  { id: 'ember', label: 'Ember' },
] as const;

const THEME_IDS = THEMES.map((t) => t.id) as readonly string[];

class ThemeState {
  current = $state(
    THEME_IDS.includes(localStorage.getItem('constellation-theme') ?? '')
      ? (localStorage.getItem('constellation-theme') as string)
      : 'observatory',
  );

  set(id: string): void {
    this.current = id;
    document.documentElement.dataset.theme = id;
    localStorage.setItem('constellation-theme', id);
  }
}

export const theme = new ThemeState();

/** One quiet status line; only problems speak — silence is success. */
class NoticeState {
  text = $state('');
  #timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string): void {
    this.text = message;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => (this.text = ''), 4000);
  }
}

export const notice = new NoticeState();
