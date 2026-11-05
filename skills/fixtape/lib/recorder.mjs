import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const VIEWPORT = { width: 1280, height: 800 };
const PACING = { intro: 3000, step: 2500, action: 900, observation: 4200 };

function requiredText(value, name, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${name} must be nonempty text of at most ${max} characters.`);
  }
  return value;
}

function selector(value, name = 'target') {
  return requiredText(value, name, 500);
}

function publicUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function publicError(error) {
  return error.message.replace(/https?:\/\/[^\s"'<>]+/g, value => {
    try { return publicUrl(value); } catch { return '[URL omitted]'; }
  });
}

function validateScenario(scenario, side) {
  if (!['before', 'after'].includes(side)) throw new TypeError('side must be before or after.');
  if (!scenario || typeof scenario !== 'object') throw new TypeError('scenario is required.');
  requiredText(scenario.title, 'scenario.title', 100);
  requiredText(scenario.goal, 'scenario.goal');
  if (typeof scenario.run !== 'function') throw new TypeError('scenario.run must be a function.');
  for (const name of ['before', 'after']) {
    const entry = scenario[name];
    if (!entry || typeof entry !== 'object') throw new TypeError(`scenario.${name} is required.`);
    let url;
    try { url = new URL(entry.url); } catch { throw new TypeError(`scenario.${name}.url must be a valid HTTP(S) URL.`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`scenario.${name}.url must use HTTP(S).`);
    if (entry.label !== undefined) requiredText(entry.label, `scenario.${name}.label`, 60);
  }
}

// This function executes in the recorded page. All author-provided content is text.
function installOverlay({ id, binding, presentation }) {
  const create = (tag, className, parent) => {
    const node = document.createElement(tag);
    node.className = className;
    parent.append(node);
    return node;
  };
  const ensure = () => {
    let host = document.querySelector(`[data-fixtape="${id}"]`);
    if (host) return host;
    host = document.createElement('div');
    host.dataset.fixtape = id;
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;isolation:isolate;';
    if (presentation === 'clean') host.style.opacity = '0';
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const style = create('style', '', root);
    style.textContent = `
      :host{font-family:Arial,Helvetica,sans-serif;color:#fff}
      *{box-sizing:border-box}
      .ring{display:none;position:fixed;border:3px solid #60a5fa;border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,42,.16);transition:none}
      .panel{position:fixed;width:740px;padding:22px 26px;background:#111827;border:1px solid #475569;border-radius:16px;box-shadow:0 10px 36px #0005;color:white;font-family:Arial,Helvetica,sans-serif}
      .eyebrow{font-size:15px;line-height:20px;font-weight:700;letter-spacing:1.5px;color:#93c5fd;margin:0 0 9px}
      .caption{font-size:28px;line-height:36px;font-weight:600;margin:0;overflow-wrap:anywhere}
      .detail{font-size:17px;line-height:24px;color:#cbd5e1;margin:12px 0 0;overflow-wrap:anywhere}
    `;
    const ring = create('div', 'ring', root);
    const panel = create('div', 'panel', root);
    const eyebrow = create('p', 'eyebrow', panel);
    const caption = create('p', 'caption', panel);
    const detail = create('p', 'detail', panel);
    host.reel = { ring, panel, eyebrow, caption, detail, target: null };
    return host;
  };
  if (document.documentElement) ensure();
  else document.addEventListener('DOMContentLoaded', ensure, { once: true });
  for (const type of ['pointerdown', 'keydown', 'input']) {
    document.addEventListener(type, (event) => {
      if (!event.isTrusted) return;
      const host = ensure();
      const ui = host.reel;
      if (event.target === host) return;
      const focused = ui.target ? document.querySelector(ui.target) : null;
      const withinTarget = Boolean(focused && focused.contains(event.target));
      window[binding]({ type, withinTarget }).catch(() => {});
    }, true);
  }
}

async function inspectTarget(page, target, { count = false, anchor } = {}) {
  const result = await page.evaluate(({ target, count, anchor }) => {
    let nodes;
    try { nodes = [...document.querySelectorAll(target)]; }
    catch { return { error: `Invalid CSS selector: ${target}` }; }
    if (nodes.some(node => node.closest('[data-fixtape]'))) {
      return { error: 'Targets cannot select the recording overlay.' };
    }
    if (nodes.some(node => !(node instanceof HTMLElement) || ['IFRAME', 'CANVAS'].includes(node.tagName))) {
      return { error: 'Only regular main-document HTML targets are supported; iframe, canvas, and SVG targets are not.' };
    }
    const visibilityError = (node, margin) => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || !node.getClientRects().length) return `Target is hidden: ${target}`;
      if (rect.left < margin || rect.top < margin || rect.right > innerWidth - margin || rect.bottom > innerHeight - margin) {
        return `Target is outside the viewport or too close to its edge: ${target}`;
      }
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return `Target is hidden: ${target}`;
        if (parent === node) continue;
        const bounds = parent.getBoundingClientRect();
        const clipX = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX);
        const clipY = ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY);
        if ((clipX && (rect.left < bounds.left || rect.right > bounds.right)) ||
            (clipY && (rect.top < bounds.top || rect.bottom > bounds.bottom))) return `Target is clipped by its container: ${target}`;
      }
      // Interior samples avoid transparent rounded corners; this is not a pixel-complete occlusion check.
      for (const fraction of [0.5, 0.25, 0.75]) {
        const x = rect.left + rect.width * fraction;
        const y = rect.top + rect.height * fraction;
        const top = document.elementFromPoint(x, y);
        if (!top || (top !== node && !node.contains(top))) return `Target is covered by another element: ${target}`;
      }
      return null;
    };
    if (count) {
      const container = document.querySelector(anchor);
      if (!container || nodes.some(node => !container.contains(node))) {
        return { error: 'Every count target must belong to its visible anchor.' };
      }
      const visible = nodes.filter(node => !visibilityError(node, 0));
      const bounds = container.getBoundingClientRect();
      if (visible.some(node => {
        const rect = node.getBoundingClientRect();
        return rect.left < bounds.left || rect.top < bounds.top || rect.right > bounds.right || rect.bottom > bounds.bottom;
      })) return { error: 'Every counted element must fit inside its visible anchor.' };
      return { count: visible.length };
    }
    if (nodes.length !== 1) return { error: `Target must match exactly one element; matched ${nodes.length}: ${target}` };
    const node = nodes[0];
    const error = visibilityError(node, 8);
    if (error) return { error };
    const rect = node.getBoundingClientRect();
    return { bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }, { target, count, anchor });
  if (result.error) throw new Error(result.error);
  return result;
}

async function present(page, { id, target = null, bounds, eyebrow, caption, detail = '', outcome }) {
  const layout = await page.evaluate(({ id, target, bounds, eyebrow, caption, detail, outcome }) => {
    const host = document.querySelector(`[data-fixtape="${id}"]`);
    if (!host?.reel) throw new Error('Recording overlay is missing after navigation.');
    const ui = host.reel;
    ui.target = target;
    ui.eyebrow.textContent = eyebrow;
    ui.caption.textContent = caption;
    ui.detail.textContent = detail;
    ui.detail.style.display = detail ? 'block' : 'none';
    const color = outcome === 'problem' ? '#f87171' : outcome === 'fixed' ? '#4ade80' : '#93c5fd';
    ui.eyebrow.style.color = color;
    ui.ring.style.borderColor = color;
    ui.ring.style.display = bounds ? 'block' : 'none';
    if (bounds) Object.assign(ui.ring.style, { left: `${bounds.x - 7}px`, top: `${bounds.y - 7}px`, width: `${bounds.width + 14}px`, height: `${bounds.height + 14}px` });
    const panel = ui.panel;
    panel.style.width = '740px';
    const height = panel.getBoundingClientRect().height;
    const placements = bounds && bounds.y + bounds.height / 2 < innerHeight / 2
      ? [{ x: 24, y: innerHeight - height - 24 }, { x: 24, y: 24 }]
      : [{ x: 24, y: 24 }, { x: 24, y: innerHeight - height - 24 }];
    if (!bounds) placements.unshift({ x: (innerWidth - 740) / 2, y: (innerHeight - height) / 2 });
    const candidate = placements.find(({ x, y }) => {
      if (x < 24 || y < 24 || x + 740 > innerWidth - 24 || y + height > innerHeight - 24) return false;
      return !bounds || x + 740 < bounds.x - 16 || x > bounds.x + bounds.width + 16 ||
        y + height < bounds.y - 16 || y > bounds.y + bounds.height + 16;
    });
    if (!candidate) return { error: 'Caption cannot fit without covering the target. Choose a smaller target or shorten the caption.' };
    panel.style.left = `${candidate.x}px`;
    panel.style.top = `${candidate.y}px`;
    const rect = panel.getBoundingClientRect();
    if (panel.scrollHeight > panel.clientHeight || panel.scrollWidth > panel.clientWidth) return { error: 'Caption is clipped.' };
    return { panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, captionFontPx: Number.parseFloat(getComputedStyle(ui.caption).fontSize), captionFontFamily: getComputedStyle(ui.caption).fontFamily };
  }, { id, target, bounds, eyebrow, caption, detail, outcome });
  if (layout.error) throw new Error(layout.error);
  return layout;
}

async function readProduct(page, target, read, anchor) {
  if (read === 'count') return (await inspectTarget(page, target, { count: true, anchor })).count;
  return page.locator(target).evaluate((node, read) => {
    if (read === 'text') {
      if (typeof node.innerText !== 'string') throw new Error('Text observations require a regular HTML element.');
      for (const child of node.querySelectorAll('*')) {
        const style = getComputedStyle(child);
        if (!child.innerText?.trim() || !child.getClientRects().length || style.visibility !== 'visible') continue;
        if (Number(style.opacity) === 0) throw new Error('Text target contains transparent text. Choose a target containing only visible text.');
        if (style.clip !== 'auto' || style.clipPath !== 'none' || child.scrollHeight > child.clientHeight + 1 || child.scrollWidth > child.clientWidth + 1) {
          throw new Error('Text target contains clipped descendant text. Choose a target containing only visible text.');
        }
      }
      if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
        throw new Error('Text target contains clipped or scrollable content. Choose fully visible text.');
      }
      return node.innerText.trim();
    }
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) throw new Error('Value observations require an input, textarea, or select element.');
    return node.value;
  }, read);
}

function unchangedBounds(previous, current) {
  if (Object.keys(previous).some(key => Math.abs(previous[key] - current[key]) > 1)) {
    throw new Error('Target moved while its caption was visible. Wait for the interface to settle before this operation.');
  }
}

/** Record one side. timingScale is for tests; delivery footage must use its default, 1. */
export async function record({ scenario, side, outDir, headless = true, timingScale = 1, presentation = 'annotated' }) {
  validateScenario(scenario, side);
  requiredText(outDir, 'outDir', 4096);
  if (typeof headless !== 'boolean') throw new TypeError('headless must be boolean.');
  if (!['annotated', 'clean'].includes(presentation)) throw new TypeError('presentation must be annotated or clean.');
  if (!Number.isFinite(timingScale) || timingScale <= 0 || timingScale > 1) throw new TypeError('timingScale must be greater than 0 and at most 1.');
  await mkdir(path.dirname(path.resolve(outDir)), { recursive: true });
  try { await mkdir(outDir); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Refusing to overwrite existing recording evidence: ${outDir}`);
    throw error;
  }
  const videoPath = path.resolve(outDir, 'raw.webm');
  const receiptPath = path.resolve(outDir, 'receipt.json');
  const receipt = {
    schemaVersion: 1, status: 'recording', side, title: scenario.title, goal: scenario.goal, presentation,
    url: publicUrl(scenario[side].url), viewport: VIEWPORT, startedAt: new Date().toISOString(),
    pacing: { scale: timingScale, milliseconds: PACING },
    timestampBasis: 'Milliseconds since recorded page creation; approximate video offsets.',
    events: [], observations: [],
  };
  const id = randomUUID();
  const binding = `reelInput${id.replaceAll('-', '')}`;
  let browser;
  let context;
  let video;
  let videoSaved = false;
  let failure;
  let started = performance.now();
  let activeAction;
  let actionCount = 0;
  let operationActive = false;
  let operationFailure;
  const elapsed = () => Math.round(performance.now() - started);
  const hold = ms => new Promise(resolve => setTimeout(resolve, ms * timingScale));
  const guarded = operation => async args => {
    if (operationActive) {
      operationFailure ??= new Error('Reel operations must be awaited sequentially.');
      throw operationFailure;
    }
    operationActive = true;
    try { return await operation(args); }
    catch (error) { operationFailure ??= error; throw error; }
    finally { operationActive = false; }
  };
  try {
    browser = await chromium.launch({ headless });
    context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, recordVideo: {
      dir: outDir, size: VIEWPORT, fps: 30,
      showActions: { cursor: 'pointer', duration: 800, style: { point: 'width:28px;height:28px;border:3px solid #2563eb;border-radius:50%;background:#2563eb33', title: 'display:none' } },
    } });
    await context.exposeBinding(binding, (_, event) => { if (activeAction) activeAction.push({ ...event, atMs: elapsed() }); });
    await context.addInitScript(installOverlay, { id, binding, presentation });
    started = performance.now();
    const page = await context.newPage();
    video = page.video();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(30000);
    await page.goto(scenario[side].url, { waitUntil: 'domcontentloaded' });
    const customLabel = scenario[side].label;
    const label = `${side.toUpperCase()}${customLabel && customLabel.trim().toLowerCase() !== side ? ` · ${customLabel}` : ''}`;
    const intro = { kind: 'intro', startMs: elapsed(), caption: scenario.goal };
    Object.assign(intro, await present(page, { id, eyebrow: label, caption: scenario.title, detail: scenario.goal }));
    await hold(PACING.intro);
    intro.endMs = elapsed();
    receipt.events.push(intro);

    const reel = {
      step: guarded(async ({ caption, target, action } = {}) => {
        requiredText(caption, 'step.caption');
        selector(target);
        if (action !== undefined && typeof action !== 'function') throw new TypeError('step.action must be a function.');
        const { bounds } = await inspectTarget(page, target);
        const event = { kind: 'step', caption, target, bounds, startMs: elapsed() };
        Object.assign(event, await present(page, { id, target, bounds, eyebrow: `${label} · ${action ? 'ACTION' : 'FOCUS'}`, caption }));
        receipt.events.push(event);
        await hold(PACING.step);
        if (action) {
          unchangedBounds(bounds, (await inspectTarget(page, target)).bounds);
          const input = [];
          activeAction = input;
          event.actionStartMs = elapsed();
          try {
            await action(page.locator(target));
            await hold(PACING.action);
          } finally {
            activeAction = undefined;
            event.input = input;
            event.actionEndMs = elapsed();
          }
          if (!input.length || !input.some(item => item.withinTarget)) throw new Error(`Action produced no real pointer or keyboard input on target: ${target}`);
          if (input.some(item => !item.withinTarget)) throw new Error(`Action interacted outside its focused target: ${target}`);
          actionCount += 1;
        }
        event.endMs = elapsed();
      }),
      observe: guarded(async ({ target, anchor, read, equals, caption, outcome } = {}) => {
        selector(target);
        requiredText(caption, 'observe.caption');
        if (!['text', 'value', 'count'].includes(read)) throw new TypeError('observe.read must be text, value, or count.');
        const expectedOutcome = side === 'before' ? 'problem' : 'fixed';
        if (outcome !== expectedOutcome) throw new TypeError(`observe.outcome must be ${expectedOutcome} for ${side}.`);
        if (read === 'count') {
          if (!Number.isInteger(equals) || equals < 0) throw new TypeError('Count equality requires a nonnegative integer.');
          selector(anchor, 'observe.anchor');
        } else {
          if (typeof equals !== 'string') throw new TypeError('Text and value equality require a string.');
          if (anchor !== undefined) throw new TypeError('observe.anchor is only supported for count.');
        }
        const focused = read === 'count' ? anchor : target;
        const { bounds } = await inspectTarget(page, focused);
        const observed = await readProduct(page, target, read, anchor);
        const observation = { kind: 'observation', target, ...(anchor ? { anchor } : {}), read, expected: equals, observed, caption, outcome, pass: observed === equals, bounds, startMs: elapsed() };
        receipt.observations.push(observation);
        receipt.events.push(observation);
        if (!observation.pass) throw new Error(`Observation failed for ${target}: expected ${JSON.stringify(equals)}, observed ${JSON.stringify(observed)}.`);
        Object.assign(observation, await present(page, {
          id, target: focused, bounds, eyebrow: `${label} · ${outcome === 'problem' ? 'PROBLEM' : 'FIXED'}`,
          caption, outcome,
        }));
        await hold(PACING.observation);
        unchangedBounds(bounds, (await inspectTarget(page, focused)).bounds);
        observation.observedAfterHold = await readProduct(page, target, read, anchor);
        if (observation.observedAfterHold !== equals) {
          observation.pass = false;
          throw new Error(`Observed result changed while its verdict was visible: expected ${JSON.stringify(equals)}, observed ${JSON.stringify(observation.observedAfterHold)}.`);
        }
        observation.endMs = elapsed();
      }),
    };
    await scenario.run({ page, reel, side });
    if (operationActive) throw new Error('scenario.run returned with an unawaited reel operation.');
    if (operationFailure) throw operationFailure;
    if (!actionCount) throw new Error('A recording requires at least one real action through reel.step().');
    if (!receipt.observations.length) throw new Error('A recording requires at least one asserted observation.');
    if (receipt.events.at(-1)?.kind !== 'observation') throw new Error('The final reel operation must be an asserted observation.');
    const final = receipt.observations.at(-1);
    unchangedBounds(final.bounds, (await inspectTarget(page, final.anchor ?? final.target)).bounds);
    if (await readProduct(page, final.target, final.read, final.anchor) !== final.expected) throw new Error('Product content changed after the terminal observation.');
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    receipt.events.push({ kind: 'failure', atMs: elapsed(), message: publicError(failure) });
  } finally {
    try {
      receipt.closeMs = elapsed();
      await context?.close();
      if (video) {
        await rename(await video.path(), videoPath);
        videoSaved = true;
      }
    } catch (error) {
      failure ??= error;
    }
    try { await browser?.close(); } catch (error) { failure ??= error; }
  }
  receipt.status = failure ? 'failed' : 'passed';
  receipt.finishedAt = new Date().toISOString();
  receipt.durationMs = elapsed();
  receipt.actionCount = actionCount;
  if (failure) receipt.error = publicError(failure);
  if (videoSaved) receipt.videoPath = 'raw.webm';
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  if (failure) {
    failure.receipt = receipt;
    failure.videoPath = videoSaved ? videoPath : undefined;
    throw failure;
  }
  return { videoPath, receipt };
}
