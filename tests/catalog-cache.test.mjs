import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_CACHE_TTL_MS,
  CATALOG_STALE_LIMIT_MS,
  createCatalogLoadSequence,
  catalogCacheFreshness,
  normalizeCoacusCatalog,
  startCatalogLoad,
  validateCoacusCatalog,
} from '../src/catalog-cache.mjs';

const catalog = () => ({
  schema: 1,
  counts: { agents: 1, skills: 2, mcps: 1 },
  agents: [{ name: 'ui-agent', category: 'engineering', description: 'Designs interfaces', source: 'knowledge/agents/ui/agent.source.md' }],
  skills: [
    { name: 'color-systems', path: 'knowledge/skills/design/color/color-systems/SKILL.md' },
    { name: 'planning', path: 'methodology/workflows/planning/SKILL.md' },
  ],
  mcps: [{ name: 'catalog-mcp', path: 'knowledge/mcps/catalog/MCP.md' }],
});

const memoryStore = (record = null) => ({
  record,
  async get() { return this.record; },
  async set(next) { this.record = next; },
  async deleteIfUnchanged(expected) {
    if (this.record && expected && this.record.savedAt === expected.savedAt && JSON.stringify(this.record.payload) === JSON.stringify(expected.payload)) this.record = null;
  },
});

test('validates the current Coacus catalog schema and exact measured counts', () => {
  const payload = catalog();
  assert.equal(validateCoacusCatalog(payload), payload);
  assert.throws(() => validateCoacusCatalog({ ...payload, counts: { ...payload.counts, skills: 99 } }), /count/i);
  assert.throws(() => validateCoacusCatalog({ ...payload, counts: { ...payload.counts, 'bad"]': 0 } }), /count/i);
  assert.throws(() => validateCoacusCatalog({ ...payload, schema: 2 }), /schema/i);
  assert.throws(() => validateCoacusCatalog({ ...payload, agents: [{ name: 'missing-source' }] }), /agent/i);
  assert.throws(() => validateCoacusCatalog({ ...payload, mcps: [{ name: ' ', path: 'knowledge/mcps/x/MCP.md' }], counts: { ...payload.counts, mcps: 1 } }), /mcp/i);
});

test('normalizes repository paths into searchable catalog entries without losing canonical paths', () => {
  const entries = normalizeCoacusCatalog(catalog());
  assert.deepEqual(entries.map(({ kind }) => kind), ['skill', 'skill', 'agent', 'mcp']);
  assert.equal(entries[0].category, 'design/color');
  assert.equal(entries[1].category, 'methodology/workflows');
  assert.equal(entries[2].description, 'Designs interfaces');
  assert.equal(entries[0].path, 'knowledge/skills/design/color/color-systems/SKILL.md');
});

test('classifies the browser cache as fresh, stale, expired, or invalid', () => {
  const now = 1_000_000;
  assert.equal(catalogCacheFreshness({ savedAt: now, payload: catalog() }, now), 'fresh');
  assert.equal(catalogCacheFreshness({ savedAt: now - CATALOG_CACHE_TTL_MS, payload: catalog() }, now), 'fresh');
  assert.equal(catalogCacheFreshness({ savedAt: now - CATALOG_CACHE_TTL_MS - 1, payload: catalog() }, now), 'stale');
  assert.equal(catalogCacheFreshness({ savedAt: now - CATALOG_STALE_LIMIT_MS - 1, payload: catalog() }, now), 'expired');
  assert.equal(catalogCacheFreshness({ savedAt: now + 1, payload: catalog() }, now), 'invalid');
  assert.equal(catalogCacheFreshness({ savedAt: now, payload: { schema: 0 } }, now), 'invalid');
});

test('uses a fresh IndexedDB entry without requesting the network', async () => {
  const now = 2_000_000;
  const store = memoryStore({ savedAt: now - 100, payload: catalog() });
  const states = [];
  await startCatalogLoad({
    store, now: () => now,
    fetcher: async () => { throw new Error('must not request'); },
    onState: (state) => states.push(state),
  });
  assert.equal(states.length, 1);
  assert.equal(states[0].status, 'fresh');
  assert.deepEqual(states[0].payload, catalog());
});

test('renders stale browser data first, then replaces it with a validated response', async () => {
  const now = 3_000_000;
  const store = memoryStore({ savedAt: now - CATALOG_CACHE_TTL_MS - 10, payload: catalog() });
  const newer = catalog();
  newer.agents[0].name = 'new-agent';
  const states = [];
  await startCatalogLoad({
    store, now: () => now,
    fetcher: async (options) => {
      assert.equal(options.cache, 'no-cache');
      return { ok: true, json: async () => newer };
    },
    onState: (state) => states.push(state),
  });
  assert.deepEqual(states.map(({ status }) => status), ['refreshing', 'fresh']);
  assert.equal(store.record.payload.agents[0].name, 'new-agent');
  assert.equal(store.record.savedAt, now);
});

test('keeps a stale browser cache when the network fails and does not extend its age', async () => {
  const now = 4_000_000;
  const record = { savedAt: now - CATALOG_CACHE_TTL_MS - 20, payload: catalog() };
  const store = memoryStore(record);
  const states = [];
  await startCatalogLoad({ store, now: () => now, fetcher: async () => { throw new Error('offline'); }, onState: (state) => states.push(state) });
  assert.deepEqual(states.map(({ status }) => status), ['refreshing', 'stale']);
  assert.equal(store.record.savedAt, record.savedAt);
});

test('does not replace a valid browser cache with an invalid remote response', async () => {
  const now = 5_000_000;
  const record = { savedAt: now - CATALOG_CACHE_TTL_MS - 1, payload: catalog() };
  const store = memoryStore(record);
  const states = [];
  await startCatalogLoad({
    store, now: () => now,
    fetcher: async () => ({ ok: true, json: async () => ({ ...catalog(), counts: { agents: 99, skills: 2, mcps: 1 } }) }),
    onState: (state) => states.push(state),
  });
  assert.deepEqual(states.map(({ status }) => status), ['refreshing', 'stale']);
  assert.deepEqual(store.record, record);
});

test('reports unavailable when the network fails and there is no browser cache', async () => {
  const states = [];
  await startCatalogLoad({
    store: memoryStore(), now: () => 6_000_000,
    fetcher: async () => { throw new Error('offline'); },
    onState: (state) => states.push(state),
  });
  assert.deepEqual(states.map(({ status }) => status), ['unavailable']);
});

test('loads successfully from the network when IndexedDB has no record', async () => {
  const store = memoryStore();
  const states = [];
  await startCatalogLoad({
    store, now: () => 6_500_000,
    fetcher: async () => ({ ok: true, json: async () => catalog() }),
    onState: (state) => states.push(state),
  });
  assert.deepEqual(states.map(({ status }) => status), ['fresh']);
  assert.equal(store.record.payload.agents[0].name, 'ui-agent');
});

test('ignores expired browser cache and does not show it as current when refresh fails', async () => {
  const now = 7_000_000;
  const old = { savedAt: now - CATALOG_STALE_LIMIT_MS - 1, payload: catalog() };
  const store = memoryStore(old);
  const states = [];
  await startCatalogLoad({ store, now: () => now, fetcher: async () => { throw new Error('offline'); }, onState: (state) => states.push(state) });
  assert.deepEqual(states.map(({ status }) => status), ['unavailable']);
  assert.equal(store.record, null);
});

test('does not delete a newer cache record after reading an expired record', async () => {
  const now = 7_500_000;
  const expired = { savedAt: now - CATALOG_STALE_LIMIT_MS - 1, payload: catalog() };
  const store = memoryStore(expired);
  let releaseDelete;
  const originalDelete = store.deleteIfUnchanged.bind(store);
  store.deleteIfUnchanged = async (expected) => {
    await new Promise((resolve) => { releaseDelete = resolve; });
    await originalDelete(expected);
  };

  const expiredLoad = startCatalogLoad({
    store, now: () => now,
    fetcher: async () => { throw new Error('offline'); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const newer = { savedAt: now + 1, payload: { ...catalog(), agents: [{ ...catalog().agents[0], name: 'new-agent' }] } };
  store.record = newer;
  releaseDelete();
  await expiredLoad;

  assert.equal(store.record.payload.agents[0].name, 'new-agent');
});

test('superseded loads cannot publish state or overwrite the newer browser cache', async () => {
  const sequence = createCatalogLoadSequence();
  const now = 8_000_000;
  const store = memoryStore();
  let resolveOld;
  const oldStates = [];
  const oldId = sequence.next();
  const oldLoad = startCatalogLoad({
    store, now: () => now, isCurrent: () => sequence.isCurrent(oldId), onState: (state) => oldStates.push(state),
    fetcher: () => new Promise((resolve) => { resolveOld = resolve; }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  const newId = sequence.next();
  const freshStates = [];
  await startCatalogLoad({
    store, now: () => now + 1, isCurrent: () => sequence.isCurrent(newId), onState: (state) => freshStates.push(state),
    fetcher: async () => ({ ok: true, json: async () => ({ ...catalog(), agents: [{ ...catalog().agents[0], name: 'new-agent' }] }) }),
  });
  resolveOld({ ok: true, json: async () => ({ ...catalog(), agents: [{ ...catalog().agents[0], name: 'old-agent' }] }) });
  await oldLoad;
  assert.equal(freshStates.at(-1).payload.agents[0].name, 'new-agent');
  assert.equal(store.record.payload.agents[0].name, 'new-agent');
  assert.deepEqual(oldStates, []);
});

test('serializes cache mutations so a delayed older write cannot land after a newer write', async () => {
  const sequence = createCatalogLoadSequence();
  const now = 9_000_000;
  const store = memoryStore();
  let releaseOldWrite;
  const originalSet = store.set.bind(store);
  store.set = async (record) => {
    if (record.payload.agents[0].name === 'old-agent') {
      await new Promise((resolve) => { releaseOldWrite = resolve; });
    }
    await originalSet(record);
  };

  const oldId = sequence.next();
  const oldLoad = startCatalogLoad({
    store, now: () => now, isCurrent: () => sequence.isCurrent(oldId),
    fetcher: async () => ({ ok: true, json: async () => ({ ...catalog(), agents: [{ ...catalog().agents[0], name: 'old-agent' }] }) }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  const newId = sequence.next();
  const newLoad = startCatalogLoad({
    store, now: () => now + 1, isCurrent: () => sequence.isCurrent(newId),
    fetcher: async () => ({ ok: true, json: async () => ({ ...catalog(), agents: [{ ...catalog().agents[0], name: 'new-agent' }] }) }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseOldWrite();
  await Promise.all([oldLoad, newLoad]);

  assert.equal(store.record.payload.agents[0].name, 'new-agent');
  assert.equal(store.record.savedAt, now + 1);
});
