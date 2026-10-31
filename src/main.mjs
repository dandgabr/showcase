import { filterCatalog, heroSceneMode, readPreferences, resolveMotion, resolveCoacusBlobUrl } from './site-core.mjs';
import { CATALOG_COUNT_KEYS, COACUS_CATALOG_URL, createCatalogLoadSequence, createIndexedDbCatalogStore, normalizeCoacusCatalog, startCatalogLoad } from './catalog-cache.mjs';
import { getLocale, getLocalePreference, readLocalePreference, setLocalePreference, subscribeLocale, t } from './i18n.mjs';

const root = document.documentElement;
let mediaReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const mediaFinePointer = window.matchMedia('(pointer: fine)');
const announcer = document.querySelector('[data-announcer]');
const safeStorage = (() => { try { return window.localStorage; } catch { return null; } })();
const catalogLoadSequence = createCatalogLoadSequence();
const catalogStore = createIndexedDbCatalogStore();
const phaseNames = () => Array.from({ length: 8 }, (_, index) => t(`moon.${index}`));
const LAYERS = { skills: { count: 'skills' }, agents: { count: 'agents' }, tools: { count: 'mcps' } };
const AGENTS = {
  design: { names: 'ui-ux-designer · ui-motion-specialist · design-qa-specialist' },
  engineering: { names: 'frontend-developer · browser-graphics-specialist · fullstack-developer' },
  data: { names: 'data-engineer-specialist · data-architect · code-explorer' },
  quality: { names: 'design-qa-specialist · qa-testing-specialist · web-accessibility-wcag' },
  orchestration: { names: 'multi-agent-orchestrator · code-optimizer · general' },
};
const app = {
  localePreference: 'auto',
  updateStoryProgress: null,
  snapshot: null,
  catalogSource: { status: 'loading', source: 'none', savedAt: null },
  preferences: readPreferences((() => { try { return safeStorage; } catch { return null; } })(), mediaReduce.matches),
  catalog: [],
  catalogFailed: false,
  catalogKind: 'all',
  catalogQuery: '',
  catalogLimit: 90,
  sceneVisible: false,
  pageFrozen: false,
  sceneArt: null,
  sceneFallback: null,
  sceneMode: null,
  heroSceneSnapshot: null,
  raf: 0,
  observer: null,
  particles: [],
  canvas: null,
  context: null,
  resizeObserver: null,
};

// localStorage may throw in restricted contexts; preference persistence is optional.
function persistPreferences() {
  try {
    window.localStorage.setItem('coacus-showcase-preferences', JSON.stringify(app.preferences));
  } catch { /* The current view still works without persistence. */ }
}

function announce(message) {
  if (announcer) announcer.textContent = message;
}

function syncPreferences(reducedMotionOverride) {
  const reducedMotion = typeof reducedMotionOverride === 'boolean' ? reducedMotionOverride : mediaReduce.matches;
  root.dataset.theme = app.preferences.theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = ({ dual: '#f7f3e8', solar: '#f2eddd', lunar: '#101424' })[app.preferences.theme];
  root.dataset.motion = reducedMotion ? 'reduced' : app.preferences.paused ? 'paused' : app.preferences.lightweight ? 'light' : 'full';
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === app.preferences.theme));
  });
  const motionButton = document.querySelector('[data-motion-toggle]');
  if (motionButton) {
    const reduced = reducedMotion;
    const active = reduced || app.preferences.paused;
    motionButton.setAttribute('aria-pressed', String(active));
    motionButton.setAttribute('aria-label', reduced ? t('motion.reduced') : active ? t('motion.resume') : t('motion.pause'));
    motionButton.disabled = reduced;
    motionButton.querySelector('[data-motion-label]').textContent = reduced ? t('motion.reducedLabel') : app.preferences.paused ? t('motion.resumeLabel') : t('motion.pauseLabel');
  }
  const lightButton = document.querySelector('[data-light-toggle]');
  if (lightButton) {
    lightButton.setAttribute('aria-pressed', String(app.preferences.lightweight));
    lightButton.setAttribute('aria-label', app.preferences.lightweight ? t('light.disable') : t('light.enable'));
    lightButton.title = t('light.enable');
    lightButton.querySelector('[data-light-label]').textContent = app.preferences.lightweight ? t('light.on') : t('light.label');
  }
  syncHeroScene();
  updateCanvasLoop();
}

function watchReducedMotion() {
  const onChange = (event) => {
    mediaReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    syncPreferences(event.matches);
  };
  if (typeof mediaReduce.addEventListener === 'function') mediaReduce.addEventListener('change', onChange);
  else mediaReduce.addListener?.(onChange);
}

function applyTheme(theme) {
  if (!['dual', 'solar', 'lunar'].includes(theme)) return;
  app.preferences.theme = theme;
  persistPreferences();
  syncPreferences();
  announce(t(`announce.theme.${theme}`));
}

function motionIsActive() {
  return resolveMotion(app.preferences, mediaReduce.matches) && app.sceneVisible && !app.pageFrozen && document.visibilityState === 'visible';
}

function sceneDocument() {
  try {
    const svg = app.sceneArt?.contentDocument?.documentElement;
    return svg?.localName === 'svg' ? svg : null;
  } catch {
    return null;
  }
}

function heroSceneAnimations(target) {
  return target?.getAnimations?.({ subtree: true }).filter((animation) => animation.effect?.target?.hasAttribute('data-cycle-layer')) || [];
}

function captureHeroSceneState(target) {
  if (app.sceneMode !== 'cycle') return null;
  if (!target) return app.heroSceneSnapshot;
  const animations = heroSceneAnimations(target);
  if (!animations.length) return app.heroSceneSnapshot;
  const time = animations.find((animation) => Number.isFinite(animation.currentTime))?.currentTime ?? 0;
  app.heroSceneSnapshot = { time, paused: animations.some((animation) => animation.playState === 'paused') || !motionIsActive() };
  return app.heroSceneSnapshot;
}

function rememberHeroSceneState() {
  if (app.sceneMode !== 'cycle') return;
  const target = app.sceneArt?.hidden ? app.sceneFallback : sceneDocument();
  if (target) captureHeroSceneState(target);
}

function prepareHeroScene(target, mode, state) {
  if (!target) return;
  const host = target === sceneDocument() ? app.sceneArt : target;
  host.hidden = false;
  host.style.visibility = 'hidden';
  if (target !== host) target.style.visibility = 'hidden';
  target.dataset.mode = mode;
  target.dataset.running = 'false';
  void target.getBoundingClientRect();
  const animations = mode === 'cycle' ? heroSceneAnimations(target) : [];
  if (mode === 'cycle') {
    const time = state?.time ?? 0;
    animations.forEach((animation) => { animation.currentTime = time; });
    const paused = state?.paused || !motionIsActive();
    animations.forEach((animation) => paused ? animation.pause() : animation.play());
    target.dataset.running = String(!paused);
    app.heroSceneSnapshot = { time, paused };
  } else {
    app.heroSceneSnapshot = null;
  }
  if (target !== host) target.style.visibility = '';
  host.style.visibility = '';
}

function replaceHeroScene(outgoing, incoming, state = captureHeroSceneState(outgoing)) {
  const mode = heroSceneMode(app.preferences.theme);
  const stage = document.querySelector('[data-motion-scene]');
  const outgoingHost = outgoing === sceneDocument() ? app.sceneArt : outgoing;
  const incomingHost = incoming === sceneDocument() ? app.sceneArt : incoming;
  if (stage) stage.dataset.skyMode = mode;
  prepareHeroScene(incoming, mode, state);
  if (outgoingHost && outgoingHost !== incomingHost) outgoingHost.hidden = true;
  app.sceneMode = mode;
  syncHeroScene();
}

function syncHeroScene() {
  const stage = document.querySelector('[data-motion-scene]');
  const svg = sceneDocument();
  const fallback = app.sceneFallback;
  if (!stage) return;
  const mode = heroSceneMode(app.preferences.theme);
  const activeScene = app.sceneArt?.hidden ? (fallback && !fallback.hidden ? fallback : null) : svg;
  const sceneTargets = activeScene ? [activeScene] : [];
  stage.dataset.skyMode = mode;
  if (app.sceneMode === 'cycle' && mode !== 'cycle') captureHeroSceneState(activeScene);
  else if (mode === 'cycle' && app.sceneMode === 'cycle') captureHeroSceneState(activeScene);
  if (app.sceneMode !== mode) {
    sceneTargets.forEach((target) => { target.dataset.running = 'false'; target.dataset.mode = mode; });
    app.sceneMode = mode;
    if (mode === 'cycle') {
      // A new Dual session always begins at daytime; CSS visibility and orbital tracks share this timeline.
      sceneTargets.forEach((target) => {
        void target.getBoundingClientRect();
        target.getAnimations({ subtree: true }).forEach((animation) => {
          if (animation.effect?.target?.hasAttribute('data-cycle-layer')) animation.currentTime = 0;
        });
      });
    }
  }
  const shouldAnimate = mode === 'cycle' && motionIsActive();
  sceneTargets.forEach((target) => {
    target.dataset.running = String(shouldAnimate);
    if (mode === 'cycle') {
      target.getAnimations({ subtree: true }).forEach((animation) => {
        if (!animation.effect?.target?.hasAttribute('data-cycle-layer')) return;
        if (shouldAnimate) animation.play();
        else animation.pause();
      });
    }
  });
  if (mode === 'cycle') app.heroSceneSnapshot = captureHeroSceneState(activeScene) || app.heroSceneSnapshot;
}

function seedParticles(count) {
  app.particles = Array.from({ length: count }, (_, index) => {
    const seed = index * 127.1 + 17.7;
    const random = (offset) => (Math.sin(seed + offset * 78.233) * 43758.5453) % 1;
    return {
      x: Math.abs(random(1)),
      y: Math.abs(random(2)),
      radius: 0.7 + Math.abs(random(3)) * 1.5,
      speed: 0.000035 + Math.abs(random(4)) * 0.00009,
      drift: (random(5) * 0.000045),
      phase: Math.abs(random(6)) * Math.PI * 2,
    };
  });
}

function resizeCanvas() {
  const canvas = app.canvas;
  const context = app.context;
  if (!canvas || !context) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4_000_000 / (rect.width * rect.height)));
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!motionIsActive() && !app.preferences.lightweight) paintParticles(0);
}

function paintParticles(time = 0) {
  const canvas = app.canvas;
  const context = app.context;
  if (!canvas || !context) return;
  const rect = canvas.getBoundingClientRect();
  context.clearRect(0, 0, rect.width, rect.height);
  const lunar = app.preferences.theme === 'lunar';
  for (const particle of app.particles) {
    const y = (particle.y - time * particle.speed) % 1;
    const x = (particle.x + Math.sin(time * .0004 + particle.phase) * .025 + time * particle.drift) % 1;
    const alpha = .25 + (Math.sin(time * .001 + particle.phase) + 1) * .2;
    context.beginPath();
    context.fillStyle = lunar ? `rgba(177, 222, 211, ${alpha})` : `rgba(255, 229, 163, ${alpha})`;
    context.arc(((x + 1) % 1) * rect.width, ((y + 1) % 1) * rect.height, particle.radius, 0, Math.PI * 2);
    context.fill();
  }
}

function renderFrame(time) {
  app.raf = 0;
  if (!motionIsActive()) return;
  rememberHeroSceneState();
  paintParticles(time);
  app.raf = window.requestAnimationFrame(renderFrame);
}

function updateCanvasLoop() {
  if (app.raf) {
    window.cancelAnimationFrame(app.raf);
    app.raf = 0;
  }
  if (!app.canvas) return;
  if (app.preferences.lightweight) {
    app.canvas.hidden = true;
    return;
  }
  app.canvas.hidden = false;
  if (motionIsActive()) app.raf = window.requestAnimationFrame(renderFrame);
  else paintParticles(0);
}

function setupCanvas() {
  app.canvas = document.querySelector('[data-spores]');
  if (!app.canvas) return;
  try { app.context = app.canvas.getContext('2d', { alpha: true, desynchronized: true }); }
  catch { app.context = null; }
  if (!app.context) return;
  seedParticles(mediaFinePointer.matches ? 72 : 32);
  resizeCanvas();
  if ('ResizeObserver' in window) {
    app.resizeObserver = new ResizeObserver(resizeCanvas);
    app.resizeObserver.observe(app.canvas);
  } else {
    window.addEventListener('resize', resizeCanvas, { passive: true });
    app.cleanup.push(() => window.removeEventListener('resize', resizeCanvas));
  }
  const scene = document.querySelector('[data-motion-scene]');
  if (typeof window.IntersectionObserver === 'function' && scene) {
    app.observer = new IntersectionObserver((entries) => {
      app.sceneVisible = entries.some((entry) => entry.isIntersecting);
      syncHeroScene();
      updateCanvasLoop();
    }, { rootMargin: '80px' });
    app.observer.observe(scene);
  } else {
    app.sceneVisible = true;
  }
  syncHeroScene();
  updateCanvasLoop();
}

function setupHeroScene() {
  app.sceneArt = document.querySelector('[data-scene-art]');
  const fallback = document.querySelector('[data-scene-fallback]');
  app.sceneFallback = fallback;
  if (!app.sceneArt || !fallback) return;
  const showFallback = () => {
    const active = app.sceneArt.hidden ? fallback : sceneDocument();
    const state = captureHeroSceneState(active);
    replaceHeroScene(active, fallback, state);
  };
  const handleLoad = () => {
    if (!sceneDocument()) { showFallback(); return; }
    const active = fallback.hidden ? null : fallback;
    const state = captureHeroSceneState(active);
    replaceHeroScene(active, sceneDocument(), state);
  };
  app.sceneArt.addEventListener('load', handleLoad);
  app.sceneArt.addEventListener('error', showFallback);
  // Module scripts may run after an eager object has already emitted `load`.
  if (sceneDocument()) handleLoad();
}

function setupPointerSpotlight() {
  document.querySelectorAll('[data-spotlight]').forEach((element) => {
    const place = (x, y) => {
      if (mediaReduce.matches) return;
      const bounds = element.getBoundingClientRect();
      element.style.setProperty('--spot-x', `${x - bounds.left}px`);
      element.style.setProperty('--spot-y', `${y - bounds.top}px`);
    };
    const move = (event) => place(event.clientX, event.clientY);
    const focus = () => { const bounds = element.getBoundingClientRect(); place(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2); };
    element.addEventListener('pointermove', move, { passive: true });
    element.addEventListener('focus', focus);
    app.cleanup.push(() => { element.removeEventListener('pointermove', move); element.removeEventListener('focus', focus); });
  });
}

function setupThemeControls() {
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
  });
  document.querySelector('[data-motion-toggle]')?.addEventListener('click', () => {
    app.preferences.paused = !app.preferences.paused;
    persistPreferences();
    syncPreferences();
    announce(app.preferences.paused ? t('announce.paused') : t('announce.resumed'));
  });
  document.querySelector('[data-light-toggle]')?.addEventListener('click', (event) => {
    app.preferences.lightweight = !app.preferences.lightweight;
    const button = event.currentTarget;
    button.setAttribute('aria-pressed', String(app.preferences.lightweight));
    button.setAttribute('aria-label', app.preferences.lightweight
      ? t('light.disable') : t('light.enable'));
    button.querySelector('[data-light-label]').textContent = app.preferences.lightweight ? t('light.on') : t('light.label');
    persistPreferences();
    syncPreferences();
    const message = !app.preferences.lightweight
      ? t('announce.lightOn')
      : mediaReduce.matches ? t('announce.lightOffReduced')
        : app.preferences.paused ? t('announce.lightOffPaused') : t('announce.lightOff');
    announce(message);
  });
  watchReducedMotion();
}

function setupStoryScroll() {
  const chapters = [...document.querySelectorAll('[data-story-chapter]')];
  const links = [...document.querySelectorAll('.main-nav a[href^="#"]')];
  const progress = document.querySelector('[data-story-progress]');
  const fill = document.querySelector('[data-story-progress-fill]');
  if (!chapters.length || !progress || !fill) return;
  progress.hidden = false;

  const revealTargets = document.querySelectorAll('.hero-copy, .world-stage, .section-head, .ecosystem-panorama, .lab-grid, .constellation-layout, .atlas-shell, .closing h2, .closing-copy, .closing-actions, .closing-credits');
  let revealObserver = null;
  if (mediaReduce.matches || typeof window.IntersectionObserver !== 'function') {
    revealTargets.forEach((target) => { target.dataset.storyReveal = ''; target.classList.add('is-revealed'); });
  } else {
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('is-pending');
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: .08, rootMargin: '0px 0px -8% 0px' });
    revealTargets.forEach((target) => {
      target.dataset.storyReveal = '';
      target.classList.add('is-pending');
      revealObserver.observe(target);
    });
  }
  if (revealObserver) app.cleanup.push(() => revealObserver.disconnect());

  let frame = 0;
  const update = () => {
    frame = 0;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const amount = Math.min(100, Math.max(0, Math.round((window.scrollY / maxScroll) * 100)));
    const marker = Math.min(window.innerHeight * .38, 320);
    let active = chapters[0];
    for (const chapter of chapters) {
      if (chapter.getBoundingClientRect().top <= marker) active = chapter;
      else break;
    }
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) active = chapters.at(-1);
    links.forEach((link) => {
      if (link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    progress.setAttribute('aria-valuenow', String(amount));
    progress.setAttribute('aria-valuetext', t('story.progress', { chapter: active.querySelector('h1, h2')?.textContent.trim().replace(/\s+/g, ' ') || active.id, percent: amount }));
    fill.style.transform = `scaleX(${amount / 100})`;
  };
  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('hashchange', schedule);
  app.cleanup.push(() => {
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('hashchange', schedule);
    if (frame) window.cancelAnimationFrame(frame);
  });
  app.updateStoryProgress = update;
  update();
}

function setupReveal() {
  document.querySelectorAll('[data-grow]').forEach((specimen) => {
    const button = specimen.querySelector('[data-grow-toggle]');
    if (button) {
      button.disabled = false;
      specimen.classList.remove('is-grown');
      button.firstChild.nodeValue = `${t('growth.make')} `;
      button.setAttribute('aria-expanded', 'false');
    }
    const reveal = () => {
      specimen.classList.add('is-grown');
      if (button) { button.firstChild.nodeValue = `${t('growth.collapse')} `; button.setAttribute('aria-expanded', 'true'); }
    };
    if (typeof window.IntersectionObserver === 'function') {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { reveal(); observer.disconnect(); }
      }, { threshold: .35 });
      observer.observe(specimen);
      app.cleanup.push(() => observer.disconnect());
    } else reveal();
    button?.addEventListener('click', () => {
      const grown = specimen.classList.toggle('is-grown');
      button.firstChild.nodeValue = `${grown ? t('growth.collapse') : t('growth.make')} `;
      button.setAttribute('aria-expanded', String(grown));
      announce(grown ? t('announce.grow') : t('announce.shrink'));
    });
  });
  const range = document.querySelector('[data-moon-range]');
  if (range) range.disabled = false;
  range?.addEventListener('input', () => {
    const phase = Number(range.value);
    document.querySelector('[data-moon-name]').textContent = phaseNames()[phase];
    document.querySelector('[data-moon-value]').textContent = `${String(phase).padStart(2, '0')} / 08`;
    document.querySelector('[data-moon-dial]').style.setProperty('--moon-angle', `${phase * 45}deg`);
  });
  const tabs = [...document.querySelectorAll('[data-layer-tab]')];
  const selectTab = (tab) => {
    const layerKey = tab.dataset.layerTab;
    const layer = LAYERS[layerKey];
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    const panel = document.querySelector('[data-layer-panel]');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.querySelector('strong').textContent = t(`layer.${layerKey}.title`);
    panel.querySelector('p').textContent = t(`layer.${layerKey}.text`);
    document.querySelector('[data-layer-count]').textContent = String(app.snapshot?.counts?.[layer.count] ?? '—');
    if (!mediaReduce.matches) panel.querySelector('strong').parentElement.parentElement.animate?.([
      { opacity: .6, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' },
    ], { duration: 200, easing: 'cubic-bezier(.2,0,0,1)' });
  };
  tabs.forEach((tab) => {
    tab.disabled = false;
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tabs[next].focus();
      selectTab(tabs[next]);
    });
  });
  const energy = document.querySelector('[data-energy-range]');
  if (energy) energy.disabled = false;
  energy?.addEventListener('input', () => {
    const value = Number(energy.value);
    const points = Array.from({ length: 6 }, (_, index) => {
      const x = index * 92;
      const wave = Math.sin(index * 2.08 + 1.1) * 19;
      const y = Math.max(17, Math.min(119, 106 - value * .64 - wave + index * 4));
      return [x, y];
    });
    const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y.toFixed(1)}`).join(' ');
    document.querySelector('[data-chart-line]').setAttribute('d', line);
    document.querySelector('[data-chart-area]').setAttribute('d', `${line} L460 140 L0 140 Z`);
    const point = points[4];
    const marker = document.querySelector('[data-chart-point]');
    marker.setAttribute('cx', point[0]);
    marker.setAttribute('cy', point[1]);
    document.querySelector('[data-chart-value]').textContent = value;
    document.querySelector('[data-chart-state]').textContent = value > 70 ? t('energy.full') : value > 35 ? t('energy.regenerating') : t('energy.resting');
    document.querySelector('[data-chart-description]').textContent = getLocale() === 'en-US' ? `Fictional sample data: energy level ${value} on a scale from zero to one hundred.` : `Dado demonstrativo fictício: nível de energia ${value} em uma escala de zero a cem.`;
  });
  const veil = document.querySelector('[data-veil-toggle]');
  const veilData = document.querySelector('[data-veil-data]');
  if (veilData) {
    veilData.classList.add('is-veiled');
    veilData.setAttribute('aria-hidden', 'true');
    veilData.setAttribute('aria-live', 'off');
  }
  if (veil) veil.disabled = false;
  veil?.addEventListener('click', () => {
    const revealed = veil.getAttribute('aria-expanded') !== 'true';
    veil.setAttribute('aria-expanded', String(revealed));
    document.querySelector('[data-veil-data]').classList.toggle('is-veiled', !revealed);
    document.querySelector('[data-veil-data]').setAttribute('aria-hidden', String(!revealed));
    document.querySelector('[data-veil-data]').setAttribute('aria-live', revealed ? 'polite' : 'off');
    document.querySelector('[data-veil-label]').textContent = revealed ? t('veil.hide') : t('veil.reveal');
    announce(revealed ? t('announce.sampleShown') : t('announce.sampleHidden'));
  });
}

function setupConstellation() {
  document.querySelectorAll('[data-agent-node]').forEach((node, index) => {
    node.disabled = false;
    node.setAttribute('aria-pressed', String(index === 0));
    node.addEventListener('click', () => {
      const detail = AGENTS[node.dataset.agentNode];
      document.querySelectorAll('[data-agent-node]').forEach((item) => item.setAttribute('aria-pressed', String(item === node)));
      document.querySelector('[data-agent-title]').textContent = t(`agent.${node.dataset.agentNode}.title`);
      document.querySelector('[data-agent-copy]').textContent = t(`agent.${node.dataset.agentNode}.copy`);
      document.querySelector('[data-agent-names]').textContent = detail.names;
      announce(`${getLocale() === 'en-US' ? 'Selected specialty' : 'Especialidade selecionada'}: ${t(`agent.${node.dataset.agentNode}.title`)}.`);
    });
  });
}

function makeCatalogCard(entry) {
  const article = document.createElement('article');
  article.className = 'catalog-card';
  article.tabIndex = -1;
  article.dataset.kind = entry.kind;
  const badge = document.createElement('span');
  badge.className = 'catalog-kind';
  badge.textContent = t(`catalog.kind.${entry.kind}`);
  const body = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = entry.name;
  const description = document.createElement('p');
  description.textContent = entry.description || entry.category || entry.path;
  body.append(title, description);
  const sourcePath = entry.path || entry.source || t('catalog.sourceUnavailable');
  const origin = document.createElement('div');
  origin.className = 'catalog-origin';
  const source = document.createElement('code');
  source.textContent = sourcePath;
  source.title = sourcePath;
  origin.append(source);
  if (sourcePath !== 'origem indisponível') {
    const link = document.createElement('a');
    link.className = 'catalog-link';
    link.href = resolveCoacusBlobUrl(sourcePath);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = t('catalog.open');
    link.setAttribute('aria-label', t('catalog.openAria', { name: entry.name }));
    origin.append(link);
  }
  article.append(badge, body, origin);
  return article;
}

function refreshCatalogLocale() {
  const entries = filterCatalog(app.catalog, { kind: app.catalogKind, query: app.catalogQuery });
  const shown = Math.min(entries.length, app.catalogLimit);
  const count = app.catalog.length;
  const displayCount = t('catalog.searchStatus', { shown, total: entries.length });
  document.querySelector('[data-atlas-count]').textContent = `${displayCount} · ${count} ${getLocale() === 'en-US' ? 'RESOURCES' : 'RECURSOS'}`;
  const status = document.querySelector('[data-catalog-status]');
  if (status) status.textContent = t('catalog.results', { shown, total: entries.length, count });
  document.querySelector('[data-atlas-footer]').textContent = t('catalog.footer');
  document.querySelector('[data-catalog-empty]').hidden = entries.length > 0;
  document.querySelector('[data-catalog-empty] p').textContent = t('catalog.empty');
  document.querySelector('[data-catalog-more]').hidden = shown >= entries.length;
  document.querySelectorAll('[data-catalog-results] article').forEach((card) => {
    const kind = card.dataset.kind;
    const badge = card.querySelector('.catalog-kind');
    if (badge) badge.textContent = t(`catalog.kind.${kind}`);
    const link = card.querySelector('.catalog-link');
    if (link) {
      const name = card.querySelector('h3')?.textContent ?? '';
      link.textContent = t('catalog.open');
      link.setAttribute('aria-label', t('catalog.openAria', { name }));
    }
  });
}

function renderCatalog() {
  const container = document.querySelector('[data-catalog-results]');
  if (!container) return;
  const entries = filterCatalog(app.catalog, { kind: app.catalogKind, query: app.catalogQuery });
  const fragment = document.createDocumentFragment();
  entries.slice(0, app.catalogLimit).forEach((entry) => fragment.append(makeCatalogCard(entry)));
  container.replaceChildren(fragment);
  container.setAttribute('aria-busy', 'false');
  document.querySelector('[data-catalog-empty]').hidden = entries.length > 0;
  const shown = Math.min(entries.length, app.catalogLimit);
  const displayCount = t('catalog.searchStatus', { shown, total: entries.length });
  document.querySelector('[data-atlas-count]').textContent = `${displayCount} · ${app.catalog.length} ${getLocale() === 'en-US' ? 'RESOURCES' : 'RECURSOS'}`;
  const status = document.querySelector('[data-catalog-status]');
  if (status) status.textContent = t('catalog.results', { shown, total: entries.length, count: app.catalog.length });
  document.querySelector('[data-atlas-footer]').textContent = t('catalog.footer');
  document.querySelector('[data-catalog-more]').hidden = shown >= entries.length;
}

function updateCatalogSource() {
  const { status, source, savedAt } = app.catalogSource;
  const time = savedAt ? new Date(savedAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
  let label = t(`catalog.source.${status}`);
  if (status === 'fresh' && source === 'browser') label += ` · ${t('catalog.source.cachedAt', { time })}`;
  else if (status === 'fresh' && source === 'network') label = t('catalog.source.verifiedAt', { time });
  else if (status === 'refreshing' && savedAt) label += ` · ${t('catalog.source.cachedAt', { time })}`;
  else if (status === 'stale' && savedAt) label = t('catalog.source.staleAt', { time });
  document.querySelector('[data-snapshot-date]').textContent = label;
  document.querySelector('[data-footer-date]').textContent = label;
}

async function loadCatalog() {
  const result = document.querySelector('[data-catalog-results]');
  const loadSequence = catalogLoadSequence.next();
  const retryButton = document.querySelector('[data-catalog-retry]');
  if (retryButton) retryButton.disabled = true;
  result.setAttribute('aria-busy', 'true');
  app.catalogFailed = false;
  await startCatalogLoad({
    store: catalogStore,
    fetcher: ({ cache }) => fetch(COACUS_CATALOG_URL, { cache, mode: 'cors' }),
    isCurrent: () => catalogLoadSequence.isCurrent(loadSequence),
    onState: (state) => {
      app.catalogSource = state;
      if (state.payload) {
        app.snapshot = state.payload;
        app.catalog = normalizeCoacusCatalog(state.payload);
        app.catalogFailed = false;
        CATALOG_COUNT_KEYS.forEach((key) => {
          const value = state.payload.counts[key];
          const target = document.querySelector(`[data-count="${key}"]`);
          if (target) target.textContent = String(value);
        });
        const selectedLayer = document.querySelector('[data-layer-tab][aria-selected="true"]')?.dataset.layerTab || 'skills';
        const countKey = LAYERS[selectedLayer]?.count;
        document.querySelector('[data-layer-count]').textContent = String(state.payload.counts[countKey] ?? '—');
        updateCatalogSource();
        document.querySelector('[data-atlas-count]').textContent = t('catalog.indexed', { count: app.catalog.length });
        document.querySelector('[data-atlas-footer]').textContent = t('catalog.localFooter');
        document.querySelector('[data-catalog-empty]').hidden = true;
        document.querySelector('[data-catalog-retry]').hidden = true;
        document.querySelector('[data-catalog-retry]').disabled = false;
        document.querySelector('[data-catalog-search]')?.removeAttribute('disabled');
        document.querySelectorAll('[data-catalog-kind], [data-catalog-reset], [data-catalog-load-more]').forEach((button) => { button.disabled = false; });
        result.setAttribute('aria-busy', state.status === 'refreshing' ? 'true' : 'false');
        renderCatalog();
        return;
      }

      updateCatalogSource();
      if (state.status === 'unavailable') {
        app.catalogFailed = true;
        result.setAttribute('aria-busy', 'false');
        result.replaceChildren();
        document.querySelectorAll('[data-count]').forEach((node) => { node.textContent = '—'; });
        document.querySelector('[data-layer-count]').textContent = '—';
        document.querySelector('[data-atlas-count]').textContent = t('catalog.unavailable');
        document.querySelector('[data-atlas-footer]').textContent = t('catalog.source.unavailable');
        document.querySelector('[data-catalog-empty]').hidden = false;
        document.querySelector('[data-catalog-empty] p').textContent = t('catalog.loadError');
        document.querySelector('[data-catalog-retry]').hidden = false;
        document.querySelector('[data-catalog-retry]').disabled = false;
        document.querySelector('[data-catalog-search]')?.setAttribute('disabled', '');
        document.querySelectorAll('[data-catalog-kind], [data-catalog-reset], [data-catalog-load-more]').forEach((button) => { button.disabled = true; });
        const statusNode = document.querySelector('[data-catalog-status]');
        if (statusNode) statusNode.textContent = t('catalog.statusError');
        console.warn('Não foi possível carregar o catálogo do Coacus:', state.error?.message || 'Erro desconhecido');
      }
    },
  });
}

function setupCatalog() {
  document.querySelector('[data-catalog-retry]')?.addEventListener('click', () => loadCatalog());
  const input = document.querySelector('[data-catalog-search]');
  input?.addEventListener('input', () => { if (app.catalogFailed) return; app.catalogQuery = input.value; app.catalogLimit = 90; renderCatalog(); });
  document.querySelectorAll('[data-catalog-kind]').forEach((button) => button.addEventListener('click', () => {
    if (app.catalogFailed) return;
    app.catalogKind = button.dataset.catalogKind;
    app.catalogLimit = 90;
    document.querySelectorAll('[data-catalog-kind]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderCatalog();
  }));
  document.querySelector('[data-catalog-load-more]')?.addEventListener('click', () => {
    if (app.catalogFailed) return;
    const previousCount = document.querySelectorAll('[data-catalog-results] article').length;
    app.catalogLimit += 90;
    renderCatalog();
    const more = document.querySelector('[data-catalog-more]');
    if (more.hidden) document.querySelectorAll('[data-catalog-results] article')[previousCount]?.focus();
    else document.querySelector('[data-catalog-load-more]')?.focus();
  });
  document.querySelector('[data-catalog-reset]')?.addEventListener('click', () => {
    if (app.catalogFailed) return;
    app.catalogKind = 'all'; app.catalogQuery = ''; app.catalogLimit = 90;
    if (input) input.value = '';
    document.querySelectorAll('[data-catalog-kind]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.catalogKind === 'all')));
    renderCatalog(); input?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); input?.focus();
    }
    if (event.key === 'Escape' && document.activeElement === input && input.value) {
      input.value = ''; app.catalogQuery = ''; renderCatalog();
    }
  });
  loadCatalog();
}

function syncLocalizedDynamic() {
  const moon = document.querySelector('[data-moon-range]');
  if (moon) document.querySelector('[data-moon-name]').textContent = phaseNames()[Number(moon.value)];
  const activeLayer = document.querySelector('[data-layer-tab][aria-selected="true"]')?.dataset.layerTab || 'skills';
  document.querySelector('[data-layer-panel] strong').textContent = t(`layer.${activeLayer}.title`);
  document.querySelector('[data-layer-panel] p').textContent = t(`layer.${activeLayer}.text`);
  const activeAgent = document.querySelector('[data-agent-node][aria-pressed="true"]')?.dataset.agentNode || 'design';
  document.querySelector('[data-agent-title]').textContent = t(`agent.${activeAgent}.title`);
  document.querySelector('[data-agent-copy]').textContent = t(`agent.${activeAgent}.copy`);
  const energy = document.querySelector('[data-energy-range]');
  if (energy) {
    const value = Number(energy.value);
    document.querySelector('[data-chart-state]').textContent = value > 70 ? t('energy.full') : value > 35 ? t('energy.regenerating') : t('energy.resting');
    document.querySelector('[data-chart-description]').textContent = getLocale() === 'en-US' ? `Fictional sample data: energy level ${value} on a scale from zero to one hundred.` : `Dado demonstrativo fictício: nível de energia ${value} em uma escala de zero a cem.`;
  }
  const veil = document.querySelector('[data-veil-toggle]');
  if (veil) document.querySelector('[data-veil-label]').textContent = veil.getAttribute('aria-expanded') === 'true' ? t('veil.hide') : t('veil.reveal');
  const grow = document.querySelector('[data-grow-toggle]');
  if (grow) grow.firstChild.nodeValue = `${grow.getAttribute('aria-expanded') === 'true' ? t('growth.collapse') : t('growth.make')} `;
  syncPreferences();
  if (app.snapshot) updateCatalogSource();
  if (app.catalogFailed) {
    document.querySelector('[data-atlas-count]').textContent = t('catalog.unavailable');
    document.querySelector('[data-atlas-footer]').textContent = t('catalog.source.unavailable');
    document.querySelector('[data-catalog-empty] p').textContent = t('catalog.loadError');
    const status = document.querySelector('[data-catalog-status]');
    if (status) status.textContent = t('catalog.statusError');
  } else if (app.catalog.length) refreshCatalogLocale();
  app.updateStoryProgress?.();
}

function setupLocaleControls() {
  const control = document.querySelector('[data-locale-control]');
  const trigger = document.querySelector('[data-locale-trigger]');
  const panel = document.querySelector('[data-locale-panel]');
  if (!control || !trigger || !panel) return;
  control.hidden = false;
  app.localePreference = readLocalePreference(safeStorage);
  subscribeLocale(() => syncLocalizedDynamic());
  setLocalePreference(app.localePreference, navigator.languages, safeStorage);
  const close = (restoreFocus = false) => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };
  trigger.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) panel.querySelector('input:checked')?.focus();
  });
  panel.querySelectorAll('[data-locale-option]').forEach((option) => option.addEventListener('change', () => {
    if (!option.checked) return;
    app.localePreference = option.value;
    setLocalePreference(option.value, navigator.languages, safeStorage);
    close(true);
    announce(t('announce.localeChanged', { language: getLocale() === 'en-US' ? 'English' : 'Português (Brasil)' }));
  }));
  document.addEventListener('click', (event) => { if (!control.contains(event.target) && !panel.hidden) close(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); } });
  window.addEventListener('languagechange', () => {
    if (getLocalePreference() !== 'auto') return;
    setLocalePreference('auto', navigator.languages, safeStorage);
    announce(t('announce.autoLocaleChanged', { language: getLocale() === 'en-US' ? 'English' : 'Português (Brasil)' }));
  });
}

function teardown(event) {
  app.pageFrozen = true;
  syncHeroScene();
  if (app.raf) window.cancelAnimationFrame(app.raf);
  app.raf = 0;
  if (event.persisted) return;
  app.observer?.disconnect();
  app.resizeObserver?.disconnect();
  app.cleanup.forEach((cleanup) => cleanup());
}

app.cleanup = [];
root.classList.add('js');
setupLocaleControls();
syncLocalizedDynamic();
setupThemeControls();
syncPreferences();
setupCanvas();
setupPointerSpotlight();
setupStoryScroll();
setupReveal();
setupConstellation();
setupCatalog();
window.addEventListener('pagehide', teardown);
window.addEventListener('pageshow', (event) => {
  app.pageFrozen = false;
  syncHeroScene();
  if (event.persisted) { resizeCanvas(); updateCanvasLoop(); }
});
document.addEventListener('visibilitychange', () => { syncHeroScene(); updateCanvasLoop(); });
setupHeroScene();
