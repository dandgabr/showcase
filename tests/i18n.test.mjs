import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolveLocale, readLocalePreference, writeLocalePreference, messages, resolveMessage, staticEnglishKeys } from '../src/i18n.mjs';

const storage = (value = null) => ({
  value,
  getItem() { return this.value; },
  setItem(_key, next) { this.value = next; },
});

test('automatic locale follows browser preference order and supported base languages', () => {
  assert.equal(resolveLocale('auto', ['es-MX', 'pt-PT', 'en-US']), 'pt-BR');
  assert.equal(resolveLocale('auto', ['en-GB', 'pt-BR']), 'en-US');
  assert.equal(resolveLocale('auto', ['pt']), 'pt-BR');
  assert.equal(resolveLocale('auto', ['en']), 'en-US');
  assert.equal(resolveLocale('auto', []), 'en-US');
  assert.equal(resolveLocale('auto', ['bad_locale', 'fr-FR']), 'en-US');
});

test('manual locale wins and invalid modes return to automatic detection', () => {
  assert.equal(resolveLocale('pt-BR', ['en-US']), 'pt-BR');
  assert.equal(resolveLocale('en-US', ['pt-BR']), 'en-US');
  assert.equal(resolveLocale('fr-FR', ['pt-BR']), 'pt-BR');
});

test('locale preference storage recovers from invalid values and storage errors', () => {
  assert.equal(readLocalePreference(storage('fr-FR')), 'auto');
  assert.equal(readLocalePreference({ getItem() { throw new Error('blocked'); } }), 'auto');
  const memory = storage();
  writeLocalePreference('pt-BR', memory);
  assert.equal(readLocalePreference(memory), 'pt-BR');
  assert.equal(writeLocalePreference('xx', memory), 'auto');
});

test('English and Portuguese catalogs have the same complete message keys', () => {
  assert.deepEqual(Object.keys(messages['en-US']).sort(), Object.keys(messages['pt-BR']).sort());
});

test('missing translated messages fall back to English, then the key', () => {
  assert.equal(resolveMessage('pt-BR', 'fallback', { 'pt-BR': {}, 'en-US': { fallback: 'English fallback' } }), 'English fallback');
  assert.equal(resolveMessage('pt-BR', 'unknown', { 'pt-BR': {}, 'en-US': {} }), 'unknown');
});


test('every static HTML text node is translated or explicitly canonical/runtime text', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const textNodes = [...html.matchAll(/>([^<>]+)</g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const translated = new Set(staticEnglishKeys);
  const runtimeOrCanonical = new Set([
    '.', '/ 100', 'coacus', 'Auto · PT', 'Lua nova', 'REGENERANDO', 'Revelar amostra',
    'English', 'pt-BR', 'en-US', 'A—01', 'UI · UX · Motion',
    'motion · focus', 'solar · scroll', 'lunar · state', 'state · layout', 'data · contrast', 'privacy · reveal',
    'ui-ux-designer · ui-motion-specialist · design-qa-specialist',
    '⌕', '⌘ K', 'ⓘ', '◌', '◎', '●', '◒', '☼', '✳', '·', '—', '↑', '→', '↓', '↗', '↙',
  ]);
  const missing = textNodes.filter((text) => !translated.has(text) && !runtimeOrCanonical.has(text) && !/^\d+(?: \/ \d+| — \d+)?$/.test(text));
  assert.deepEqual([...new Set(missing)], []);
});
