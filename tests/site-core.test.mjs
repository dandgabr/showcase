import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalog, heroSceneMode, readPreferences, resolveMotion, resolveCoacusBlobUrl, COACUS_REPO_BLOB_BASE } from '../src/site-core.mjs';

const storageWith = (value) => ({
  getItem: () => JSON.stringify(value),
});

test('preferences fall back to defaults when storage is unavailable', () => {
  const preferences = readPreferences({ getItem() { throw new Error('blocked'); } }, false);
  assert.deepEqual(preferences, { theme: 'dual', paused: false, lightweight: false });
});

test('preferences reject unknown themes and keep valid user choices', () => {
  assert.deepEqual(readPreferences(storageWith({ theme: 'lunar', paused: true, lightweight: false }), false), {
    theme: 'lunar', paused: true, lightweight: false,
  });
  assert.equal(readPreferences(storageWith({ theme: '<img>', paused: 'yes' }), false).theme, 'dual');
});

test('system preference and pause disable motion while lightweight keeps it running', () => {
  assert.equal(resolveMotion({ theme: 'solar', paused: false, lightweight: false }, true), false);
  assert.equal(resolveMotion({ theme: 'solar', paused: true, lightweight: false }, false), false);
  assert.equal(resolveMotion({ theme: 'solar', paused: false, lightweight: true }, false), true);
  assert.equal(resolveMotion({ theme: 'solar', paused: true, lightweight: true }, false), false);
  assert.equal(resolveMotion({ theme: 'solar', paused: false, lightweight: false }, false), true);
});

test('hero scene maps valid themes and safely falls back to Dual', () => {
  assert.equal(heroSceneMode('dual'), 'cycle');
  assert.equal(heroSceneMode('solar'), 'day');
  assert.equal(heroSceneMode('lunar'), 'night');
  assert.equal(heroSceneMode('unknown'), 'cycle');
});

test('catalog search filters all resource kinds without mutating source records', () => {
  const entries = [
    { kind: 'skill', name: 'Lunarpunk design', description: 'Nocturnal garden', category: 'Design' },
    { kind: 'agent', name: 'Frontend developer', description: 'Accessible UI', category: 'Engineering' },
    { kind: 'mcp', name: 'Coacus catalog', description: 'Resource index', category: 'Tools' },
  ];
  const snapshot = structuredClone(entries);
  assert.deepEqual(filterCatalog(entries, { kind: 'skill', query: 'NOCTURNAL' }), [entries[0]]);
  assert.deepEqual(filterCatalog(entries, { kind: 'all', query: 'catalog' }), [entries[2]]);
  assert.deepEqual(filterCatalog(entries, { kind: 'agent', query: '' }), [entries[1]]);
  assert.deepEqual(filterCatalog(entries, { query: 'lunarpunk' }), [entries[0]]);
  assert.deepEqual(filterCatalog(entries, { query: 'NOCTÚRNAL' }), [entries[0]]);
  assert.deepEqual(entries, snapshot);
});

test('resolveCoacusBlobUrl builds canonical github blob links safely', () => {
  assert.equal(resolveCoacusBlobUrl('knowledge/skills/design/color/SKILL.md'), `${COACUS_REPO_BLOB_BASE}/knowledge/skills/design/color/SKILL.md`);
  assert.equal(resolveCoacusBlobUrl('/knowledge/agents/ui/agent.source.md'), `${COACUS_REPO_BLOB_BASE}/knowledge/agents/ui/agent.source.md`);
  assert.equal(resolveCoacusBlobUrl(''), COACUS_REPO_BLOB_BASE);
  assert.equal(resolveCoacusBlobUrl(null), COACUS_REPO_BLOB_BASE);
});
