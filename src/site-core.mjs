const DEFAULT_PREFERENCES = Object.freeze({ theme: 'dual', paused: false, lightweight: false });
const THEMES = new Set(['dual', 'solar', 'lunar']);

export function readPreferences(storage, prefersReducedMotion) {
  let saved = {};
  try {
    saved = JSON.parse(storage?.getItem('coacus-showcase-preferences') ?? '{}');
  } catch {
    saved = {};
  }

  return {
    theme: THEMES.has(saved?.theme) ? saved.theme : DEFAULT_PREFERENCES.theme,
    paused: typeof saved?.paused === 'boolean' ? saved.paused : DEFAULT_PREFERENCES.paused,
    lightweight: typeof saved?.lightweight === 'boolean' ? saved.lightweight : DEFAULT_PREFERENCES.lightweight,
  };
}

export function resolveMotion(preferences, prefersReducedMotion) {
  return !prefersReducedMotion && !preferences.paused;
}

export function heroSceneMode(theme) {
  if (theme === 'solar') return 'day';
  if (theme === 'lunar') return 'night';
  return 'cycle';
}

function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

export function filterCatalog(entries, { kind = 'all', query = '' } = {}) {
  const needle = normalizeSearchText(query).trim();
  return entries.filter((entry) => {
    const matchesKind = kind === 'all' || entry.kind === kind;
    const haystack = normalizeSearchText(`${entry.name} ${entry.description ?? ''} ${entry.category ?? ''}`);
    return matchesKind && (!needle || haystack.includes(needle));
  });
}
