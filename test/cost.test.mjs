// Pure-math and structure tests for dsh-task-cost.
// The client bundle is a browser artifact, so we evaluate its factory with a
// minimal module table and assert on the exposed `__test` helpers — no DOM, no
// React renderer, no browser control required.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

let bundleDefinition;
let dockComponent;
const element = (type, props) => ({ type, props });
const moduleTable = {
  react: {
    createElement: element,
    memo: (component) => component,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: () => ({ current: null }),
    Fragment: Symbol('Fragment'),
  },
  'react-dom': { createPortal: (children) => element('portal', { children }) },
  'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: Symbol('jsxFragment') },
};

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(definition) {
        bundleDefinition = definition;
      },
    },
  },
  console,
};
vm.runInNewContext(read('client.js'), sandbox, { filename: 'client.js' });

const plugin = bundleDefinition.factory((id) => {
  if (!Object.prototype.hasOwnProperty.call(moduleTable, id)) {
    throw new Error(`unexpected module request: ${id}`);
  }
  return moduleTable[id];
});

const {
  PRICES,
  DICTS,
  LOCALE_NS,
  knownModelOf,
  priceModelOf,
  computeCost,
  formatCny,
  formatRate,
  formatTokens,
  formatCompactTokens,
  normalizeUsage,
  collectDescendants,
  priceChildren,
  fill,
  fallbackDict,
  readTier,
  writeTier,
  CostPanel,
} = plugin.__test;

test('bundle identity matches the package and patch', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(bundleDefinition.id, pkg.name);
  assert.equal(pkg.name, 'dsh-task-cost');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');

  const patch = read('cordis.patch.yml');
  assert.match(patch, new RegExp(`name:\\s*${pkg.name}`));
  assert.match(patch, /id:\s*cost-meter/);
});

test('bundle requests only platform baseline modules', () => {
  const requests = [...read('client.js').matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(requests)].sort(), ['react', 'react-dom', 'react/jsx-runtime']);
});

test('registers into the composer dock', () => {
  assert.match(read('client.js'), /conversation\.composer\.dock/);
});

test('uses the official deepseek-flash and deepseek-v4-pro CNY rate tables', () => {
  // Objects built inside the vm context have their own prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(PRICES['deepseek-flash'].peak)), { cacheHit: 0.04, cacheMiss: 2, output: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(PRICES['deepseek-flash'].offpeak)), { cacheHit: 0.02, cacheMiss: 1, output: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(PRICES['deepseek-v4-pro'].peak)), { cacheHit: 0.3, cacheMiss: 9, output: 27 });
  assert.deepEqual(JSON.parse(JSON.stringify(PRICES['deepseek-v4-pro'].offpeak)), { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 });
});

test('prices each bucket per million tokens', () => {
  const usage = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 };

  const peak = computeCost(usage, 'peak', 'deepseek-flash');
  assert.equal(peak.cacheMissCost, 2);
  assert.equal(peak.outputCost, 8);
  assert.equal(peak.total, 10);

  const offpeak = computeCost(usage, 'offpeak', 'deepseek-flash');
  assert.equal(offpeak.total, 5);

  const cached = computeCost({ cacheReadTokens: 1_000_000 }, 'peak', 'deepseek-flash');
  assert.ok(Math.abs(cached.total - 0.04) < 1e-12);

  // Cache writes have no separate DeepSeek price and are billed as misses.
  const write = computeCost({ cacheWriteTokens: 1_000_000 }, 'peak', 'deepseek-flash');
  assert.equal(write.total, 2);
});

test('unknown rate windows fall back to peak', () => {
  const usage = { uncachedInputTokens: 1_000_000 };
  assert.equal(
    computeCost(usage, 'bogus', 'deepseek-flash').total,
    computeCost(usage, 'peak', 'deepseek-flash').total,
  );
});

test('model ids select their rate table, unknown ids bill as flash', () => {
  assert.equal(priceModelOf('deepseek-flash'), 'deepseek-flash');
  assert.equal(priceModelOf('deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.equal(priceModelOf('deepseek-official/deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.equal(priceModelOf('some-other-model'), 'deepseek-flash');
  assert.equal(priceModelOf(undefined), 'deepseek-flash');

  assert.equal(knownModelOf('deepseek-flash'), 'deepseek-flash');
  assert.equal(knownModelOf('deepseek-v4-flash'), 'deepseek-flash');
  assert.equal(knownModelOf('deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.equal(knownModelOf('claude-sonnet'), null);
  assert.equal(knownModelOf(''), null);

  const usage = { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000 };
  const pro = computeCost(usage, 'peak', 'deepseek-v4-pro');
  assert.equal(pro.priceModel, 'deepseek-v4-pro');
  assert.equal(pro.modelKnown, true);
  assert.equal(pro.total, 36);
  assert.equal(computeCost(usage, 'offpeak', 'deepseek-v4-pro').total, 18);

  // A non-DeepSeek route still gets a fallback estimate, but says so.
  const foreign = computeCost(usage, 'peak', 'claude-sonnet');
  assert.equal(foreign.priceModel, 'deepseek-flash');
  assert.equal(foreign.modelKnown, false);
  assert.equal(foreign.sourceModel, 'claude-sonnet');
  // No model reported yet is not an unknown model.
  assert.equal(computeCost(usage, 'peak', undefined).modelKnown, true);
});

test('a mostly-cached session stays cheap but non-zero', () => {
  // ~4M total tokens, 97.5% cache hits — the shape of a long coding session.
  const usage = { cacheReadTokens: 3_900_000, uncachedInputTokens: 100_000, cacheWriteTokens: 0, outputTokens: 20_000 };
  const peak = computeCost(usage, 'peak', 'deepseek-flash');
  assert.ok(Math.abs(peak.total - 0.516) < 1e-9);
  assert.ok(Math.abs(computeCost(usage, 'offpeak', 'deepseek-flash').total - 0.258) < 1e-9);
  assert.equal(peak.billedInputTokens, 4_000_000);
});

test('normalizeUsage clamps junk to zero', () => {
  const zero = { cacheReadTokens: 0, uncachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeUsage(null))), zero);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        normalizeUsage({ cacheReadTokens: -5, uncachedInputTokens: Number.NaN, cacheWriteTokens: '9', outputTokens: Infinity }),
      ),
    ),
    zero,
  );
});

test('currency and token formatting', () => {
  assert.equal(formatCny(0), '¥0');
  assert.equal(formatCny(0.00005), '<¥0.0001');
  assert.equal(formatCny(0.00512), '¥0.0051');
  assert.equal(formatCny(0.516), '¥0.516');
  assert.equal(formatCny(0.9999), '¥1.00');
  assert.equal(formatCny(1.2345), '¥1.23');
  assert.equal(formatRate(0.04), '¥0.04/M');
  assert.equal(formatRate(2), '¥2/M');
  assert.equal(formatRate(Number.NaN), '¥0/M');
  assert.equal(formatRate(-1), '¥0/M');
  assert.equal(formatTokens(4_000_000), '4,000,000');
});

test('locale dictionaries are balanced and cover both languages', () => {
  const enKeys = Object.keys(DICTS.en).sort();
  const zhKeys = Object.keys(DICTS.zh).sort();
  assert.deepEqual(zhKeys, enKeys);
  assert.ok(enKeys.includes('pill.title'));
  assert.ok(enKeys.includes('note.unknown'));
  assert.ok(enKeys.includes('link.pricing'));
  assert.equal(fallbackDict(), DICTS.en);
  assert.equal(LOCALE_NS, 'dsh-task-cost');
});

test('rate-window preference is persisted, defaulting to peak', () => {
  assert.equal(readTier(), 'peak');
  const store = new Map();
  sandbox.window.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  writeTier('offpeak');
  assert.equal(readTier(), 'offpeak');
  writeTier('peak');
  assert.equal(readTier(), 'peak');
});

test('copy interpolation fills known placeholders only', () => {
  assert.equal(fill('按 {model} 价，{missing} 保留', { model: 'deepseek-flash' }), '按 deepseek-flash 价，{missing} 保留');
});

test('client half mounts into the composer dock through ctx.slots.inject', () => {
  const appended = [];
  const removed = [];
  sandbox.document = {
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, textContent: '', remove: () => removed.push(true) }),
    head: { appendChild: (node) => appended.push(node) },
  };
  let registered;
  let injectedInto;
  const localeRegistrations = [];
  const disposers = [];
  const ctx = {
    effect: (factory) => {
      disposers.push(factory());
    },
    locale: {
      register: (ns, locale, dict) => {
        localeRegistrations.push({ ns, locale, keys: Object.keys(dict).length });
        return () => removed.push(`locale:${locale}`);
      },
    },
    slots: {
      inject: (name, callback) => {
        injectedInto = name;
        disposers.push(callback());
      },
      register: (options, component) => {
        registered = { options, component };
        return () => removed.push('registration');
      },
    },
  };

  plugin.apply(ctx);
  dockComponent = registered && registered.component;

  assert.equal(injectedInto, 'conversation.composer.dock');
  assert.deepEqual(JSON.parse(JSON.stringify(registered.options)), {
    name: 'conversation.composer.dock',
    id: 'cost-meter',
    order: 2,
    locale: 'dsh-task-cost',
  });
  assert.equal(typeof registered.component, 'function');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].dataset.dshPlugin, 'dsh-task-cost');
  assert.match(appended[0].textContent, /\.dcm_pill/);
  assert.deepEqual(localeRegistrations, [
    { ns: 'dsh-task-cost', locale: 'en', keys: Object.keys(DICTS.en).length },
    { ns: 'dsh-task-cost', locale: 'zh', keys: Object.keys(DICTS.zh).length },
  ]);

  // Unmounting removes the stylesheet, both dictionaries and the registration.
  for (const dispose of disposers) dispose();
  assert.ok(removed.includes(true));
  assert.ok(removed.includes('locale:en'));
  assert.ok(removed.includes('locale:zh'));
  assert.ok(removed.includes('registration'));
});

/** Build the composed slot props for one render of the dock entry. */
function dockProps(tokenUsage, modelSelection, t, sessionList) {
  const list = sessionList ?? { ids: [], byId: {}, projectionsBySession: {} };
  return {
    ...(typeof t === 'function' ? { t } : {}),
    sessionId: 'root',
    useProjection: (key) => (key === 'tokenUsage' ? tokenUsage : key === 'modelSelection' ? modelSelection : undefined),
    useSessions: (selector) => (typeof selector === 'function' ? selector(list) : list),
  };
}

/** A session list with two children and one grandchild under `root`. */
function descendantList() {
  const usage = (cacheRead) => ({ cacheReadTokens: cacheRead, uncachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
  return {
    ids: ['root', 'c1', 'c2', 'grand', 'other'],
    byId: {
      root: { id: 'root', displayTitle: '主会话', projectionValues: {} },
      c1: { id: 'c1', displayTitle: '子会话 A', parentId: 'root', projectionValues: { tokenUsage: usage(1_000_000) } },
      c2: { id: 'c2', displayTitle: '子会话 B', parentId: 'root', projectionValues: {} },
      grand: {
        id: 'grand',
        displayTitle: '孙会话',
        parentId: 'c1',
        projectionValues: { tokenUsage: { uncachedInputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      },
      other: { id: 'other', displayTitle: '别的任务', parentId: 'unrelated', projectionValues: { tokenUsage: usage(9_000_000) } },
    },
    projectionsBySession: {},
  };
}

test('collects every descendant session and never a sibling tree', () => {
  const descendants = collectDescendants(descendantList(), 'root');
  assert.deepEqual(JSON.parse(JSON.stringify(descendants.map((row) => row.id).sort())), ['c1', 'c2', 'grand']);
  const priced = priceChildren(descendants, 'peak');
  assert.equal(priced.count, 3);
  // 1M cached (0.04) + 100k uncached (0.2) + pending 0.
  assert.ok(Math.abs(priced.total - 0.24) < 1e-9);
  assert.equal(priced.rows[0].id, 'grand');
  assert.equal(priced.rows[priced.rows.length - 1].pending, true);
  assert.equal(collectDescendants({ byId: {} }, 'root').length, 0);
  assert.equal(collectDescendants(null, 'root').length, 0);
});

test('compact token formatting', () => {
  assert.equal(formatCompactTokens(18_800_000), '18.8M');
  assert.equal(formatCompactTokens(17_100_000), '17.1M');
  assert.equal(formatCompactTokens(1_000_000), '1M');
  assert.equal(formatCompactTokens(934_000), '934k');
  assert.equal(formatCompactTokens(812), '812');
});

test('the pill renders nothing without a token projection', () => {
  assert.equal(typeof dockComponent, 'function');
  assert.equal(dockComponent(dockProps(undefined, undefined)), null);
  assert.equal(dockComponent(dockProps({}, undefined)), null);
});

test('the pill labels the estimate and prices with the last-used model', () => {
  const usage = { cacheReadTokens: 4_000_000, uncachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const flashView = dockComponent(dockProps(usage, { lastUsed: { provider: 'deepseek', model: 'deepseek-flash' }, next: null }));
  assert.equal(flashView.type, 'span');
  assert.equal(flashView.props['data-composer-stat'], 'cost');
  const flashLabel = flashView.props.children[0].props.children[1].props.children;
  assert.equal(flashLabel, '≈¥0.160');

  const proView = dockComponent(dockProps(usage, { lastUsed: { provider: 'deepseek', model: 'deepseek-v4-pro' }, next: null }));
  const proLabel = proView.props.children[0].props.children[1].props.children;
  assert.equal(proLabel, '≈¥1.20');
});

test('the locale seat drives the pill copy when present', () => {
  const usage = { cacheReadTokens: 1_000_000, uncachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const seen = [];
  const t = (key, params) => {
    seen.push([key, params]);
    return `zh:${key}`;
  };
  const view = dockComponent(dockProps(usage, undefined, t));
  assert.equal(view.props.children[0].props.children[1].props.children, 'zh:label.estimate¥0.040');
  assert.equal(view.props.children[0].props.title, 'zh:pill.title');
  assert.deepEqual(seen.map(([key]) => key).includes('pill.title'), true);
});

/** Collect every rendered string from the fake element tree. */
function collectText(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  if (typeof node === 'object' && node.props !== undefined) collectText(node.props.children, out);
  return out;
}

test('the pill and panel include descendant sessions with a separate breakdown', () => {
  const usage = { cacheReadTokens: 4_000_000, uncachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const list = descendantList();
  const view = dockComponent(dockProps(usage, undefined, undefined, list));

  // 4M cached main (0.16) + 1M cached child (0.04) + 100k uncached grandchild (0.2).
  assert.equal(view.props.children[0].props.children[1].props.children, '≈¥0.400');
  assert.equal(view.props.children[0].props.title, 'Estimated task cost (incl. 3 sub-sessions)');

  const main = computeCost(usage, 'peak', 'deepseek-flash');
  const priced = priceChildren(collectDescendants(list, 'root'), 'peak');
  const panel = CostPanel({
    cost: main,
    children: priced.rows,
    childTotal: priced.total,
    total: main.total + priced.total,
    tier: 'peak',
    chooseTier: () => {},
    style: {},
    tr: (key, params) => key + (params === undefined ? '' : ':' + JSON.stringify(params)),
    panelRef: { current: null },
  });
  const text = collectText(panel).join('|');
  assert.match(text, /section\.main/);
  assert.match(text, /section\.children:\{"count":3\}/);
  assert.match(text, /¥0\.400/);
  assert.match(text, /¥0\.200/);
  assert.match(text, /¥0\.160/);
  assert.match(text, /孙会话/);
  assert.match(text, /子会话 B/);
  assert.match(text, /—/);
  assert.match(text, /row\.total/);
});
