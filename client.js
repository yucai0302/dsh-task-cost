// dsh-task-cost — browser half (client plugin bundle).
//
// Loaded by @deepseek-ai/dsh-client-modules at /plugins/dsh-task-cost/client.js
// and executed through the vendored Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS whose require()
// resolves against the shell's frozen platform module table, so only baseline
// modules (react, react-dom, react/jsx-runtime) are requested here.
//
// What it does: registers one more entry into `conversation.composer.dock` —
// the status row under the message composer that already shows
// "{turns} 轮 {steps} 步 · {tps} tok/s", "{tokens} tok · 缓存命中 {pct}%" and the
// context-window meter. The entry reads the `tokenUsage` Session projection
// (the durable, whole-log provider-reported token total) and shows the estimated
// money spent, with a click-through breakdown.
//
// Everything is derived through slot props (`useProjection`), so re-renders are
// driven by the framework's projection publication — no DOM reads, no polling,
// no subscriptions of our own.

window.__ModuleLoader__.load({
  id: 'dsh-task-cost',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const jsx = require('react/jsx-runtime').jsx;
    const jsxs = require('react/jsx-runtime').jsxs;
    const Fragment = React.Fragment;

    //#region dsh-task-cost: pricing
    /**
     * DeepSeek official CNY pricing per 1,000,000 tokens, per model and rate
     * window. Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
     *
     * peak    高峰时段：北京时间周一至周五（不含法定节假日）9:00–12:00、14:00–18:00
     * offpeak 空闲时段：其余全部时间（空闲价 = 高峰价的一半）
     *
     * `cacheMiss` is also applied to `cacheWriteTokens`: DeepSeek does not bill a
     * separate cache-write bucket, and billing a write as a miss is the
     * conservative reading. The bucket is 0 on this provider anyway.
     *
     * The `tokenUsage` projection is a whole-session total without per-request
     * model attribution, so the *last used* model from the `modelSelection`
     * projection prices all of it. A session that switched models mid-way is
     * therefore an approximation (documented in the dialog and README).
     */
    const PRICES = {
      'deepseek-flash': {
        peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
        offpeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      },
      'deepseek-v4-pro': {
        peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
        offpeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
      },
    };
    const PRICE_SOURCE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing';
    const DEFAULT_MODEL = 'deepseek-flash';
    const TIER_KEY = 'dsh-task-cost:tier';
    const DEFAULT_TIER = 'peak';
    const PER_MILLION = 1e6;
    /** DeepSeek model ids this plugin can price, mapped onto their rate table. */
    const KNOWN_MODELS = {
      'deepseek-flash': 'deepseek-flash',
      'deepseek-v4-flash': 'deepseek-flash',
      'deepseek-v4-flash-vision-exp': 'deepseek-flash',
      'deepseek-chat': 'deepseek-flash',
      'deepseek-reasoner': 'deepseek-flash',
      'deepseek-v4-pro': 'deepseek-v4-pro',
    };

    /**
     * Resolve the rate table of one model id.
     * @param model - `modelSelection.lastUsed.model` or undefined.
     * @returns the table key, or null when the id is not a DeepSeek model this
     * plugin prices (a non-DeepSeek route or a future renamed id).
     */
    function knownModelOf(model) {
      const name = typeof model === 'string' ? model.trim().toLowerCase() : '';
      if (name === '') return null;
      if (Object.prototype.hasOwnProperty.call(KNOWN_MODELS, name)) return KNOWN_MODELS[name];
      if (name.indexOf('deepseek') === -1) return null;
      if (name.indexOf('pro') !== -1) return 'deepseek-v4-pro';
      if (name.indexOf('flash') !== -1) return DEFAULT_MODEL;
      return null;
    }

    /** Map one model id onto a rate table (unknown ids bill as flash). */
    function priceModelOf(model) {
      return knownModelOf(model) ?? DEFAULT_MODEL;
    }
    //#endregion

    //#region dsh-task-cost: copy
    /** Locale namespace registered with the Client locale service. */
    const LOCALE_NS = 'dsh-task-cost';

    /**
     * UI dictionaries, registered into the Client locale service so the pill
     * follows the DSH UI language (not just the browser language). The same
     * tables back the fallback used when the component receives no `t` seat.
     */
    const DICTS = {
      en: {
        'pill.title': 'Estimated session cost',
        'pill.titleChildren': 'Estimated task cost (incl. {count} sub-sessions)',
        'dialog.title': 'Session cost estimate',
        'label.estimate': '≈',
        'row.cacheHit': 'Cached input',
        'row.cacheMiss': 'Uncached input',
        'row.cacheWrite': 'Cache write',
        'row.output': 'Output',
        'section.main': 'Main session',
        'section.children': 'Sub-sessions · {count}',
        'row.total': 'Total (incl. sub-sessions)',
        'child.pending': 'pending',
        'tier.label': 'Rate window',
        'tier.peak': 'Peak',
        'tier.offpeak': 'Off-peak',
        'note.known':
          'Estimated from the official DeepSeek {model} price list; off-peak is half of peak. Excludes Search/Fetch request fees.',
        'note.unknown':
          'Model “{model}” is outside this price table; the estimate falls back to deepseek-flash rates. Excludes Search/Fetch request fees.',
        'note.children':
          'Sub-sessions are separate sessions with their own billing; the same rate window applies to them.',
        'link.pricing': 'Official pricing',
      },
      zh: {
        'pill.title': '本会话预估消费',
        'pill.titleChildren': '本任务预估消费（含 {count} 个子会话）',
        'dialog.title': '本会话消费估算',
        'label.estimate': '≈',
        'row.cacheHit': '缓存命中输入',
        'row.cacheMiss': '缓存未命中输入',
        'row.cacheWrite': '缓存写入',
        'row.output': '输出',
        'section.main': '主会话',
        'section.children': '子会话 · {count} 个',
        'row.total': '合计（含子会话）',
        'child.pending': '待统计',
        'tier.label': '计价时段',
        'tier.peak': '高峰',
        'tier.offpeak': '空闲',
        'note.known': '按 DeepSeek 官方 {model} 单价折算，仅供参考；空闲时段单价为高峰的一半。不含 Search/Fetch 调用费。',
        'note.unknown': '模型“{model}”不在本插件价格表内，暂按 deepseek-flash 单价估算。不含 Search/Fetch 调用费。',
        'note.children': '子会话是独立计费的会话，同样按这里的单价档位估算。',
        'link.pricing': '官方价格表',
      },
    };

    /** Fallback dictionary chosen from the browser language when no `t` seat exists. */
    function fallbackDict() {
      const lang = typeof navigator !== 'undefined' && navigator.language ? String(navigator.language).toLowerCase() : '';
      return lang.indexOf('zh') === 0 ? DICTS.zh : DICTS.en;
    }

    /** Fill `{name}` placeholders in one copy string. */
    function fill(template, params) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
      );
    }
    //#endregion

    //#region dsh-task-cost: cost math
    /** Coerce one projection value into the four non-negative token buckets. */
    function normalizeUsage(usage) {
      const source = usage !== null && typeof usage === 'object' ? usage : {};
      const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
      return {
        cacheReadTokens: num(source.cacheReadTokens),
        uncachedInputTokens: num(source.uncachedInputTokens),
        cacheWriteTokens: num(source.cacheWriteTokens),
        outputTokens: num(source.outputTokens),
      };
    }

    /**
     * Cost one session's token usage in CNY at one rate window.
     * @param usage - the `tokenUsage` Session projection value.
     * @param tier - `'peak'` or `'offpeak'`; anything else falls back to peak.
     * @param model - model id used for the rate table; unknown ids bill as flash
     * and report `modelKnown: false` so the dialog can say so.
     * @returns per-bucket costs, the billed total, and the applied unit prices.
     */
    function computeCost(usage, tier, model) {
      const tokens = normalizeUsage(usage);
      const resolved = knownModelOf(model);
      const priceModel = resolved ?? DEFAULT_MODEL;
      const price = PRICES[priceModel][tier === 'offpeak' ? 'offpeak' : 'peak'];
      const cacheHitCost = (tokens.cacheReadTokens * price.cacheHit) / PER_MILLION;
      const cacheMissCost = (tokens.uncachedInputTokens * price.cacheMiss) / PER_MILLION;
      const cacheWriteCost = (tokens.cacheWriteTokens * price.cacheMiss) / PER_MILLION;
      const outputCost = (tokens.outputTokens * price.output) / PER_MILLION;
      return {
        tokens,
        priceModel,
        // An absent projection (no model reported yet) is not an unknown model.
        modelKnown: model === undefined || model === null || model === '' || resolved !== null,
        sourceModel: typeof model === 'string' && model !== '' ? model : priceModel,
        price,
        cacheHitCost,
        cacheMissCost,
        cacheWriteCost,
        outputCost,
        total: cacheHitCost + cacheMissCost + cacheWriteCost + outputCost,
        billedInputTokens: tokens.cacheReadTokens + tokens.uncachedInputTokens + tokens.cacheWriteTokens,
      };
    }

    /** Adaptive CNY formatting: keep small session costs readable. */
    function formatCny(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '¥0';
      if (value < 0.0001) return '<¥0.0001';
      if (value < 0.01) return '¥' + value.toFixed(4);
      // Round first so 0.9999 reads "¥1.00" rather than "¥1.000".
      const three = value.toFixed(3);
      if (Number(three) < 1) return '¥' + three;
      return '¥' + value.toFixed(2);
    }

    /** Format one token count with thousands separators. */
    function formatTokens(value) {
      const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
      try {
        return n.toLocaleString('en-US');
      } catch {
        return String(n);
      }
    }

    /** Compact token count for one breakdown row: 18.8M, 934k, 812. */
    function formatCompactTokens(value) {
      const n = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
      const trim = (text) => text.replace(/\.0$/, '');
      if (n >= 1e9) return trim((n / 1e9).toFixed(1)) + 'B';
      if (n >= 1e6) return trim((n / 1e6).toFixed(1)) + 'M';
      if (n >= 1e3) return trim((n / 1e3).toFixed(1)) + 'k';
      return String(Math.round(n));
    }

    /**
     * Collect every descendant Session of `rootId` from the Client session list.
     *
     * `tokenUsage` is a whole-session projection, so a spawn/fork child session is
     * billed on its own. The list snapshot carries each row's current projection
     * values (live sessions report live units, persisted ones their checkpoint),
     * which lets the dock show the task's full spend without opening the children.
     *
     * @param list - `SessionListState` from `useSessions`.
     * @param rootId - the Session whose descendants to collect.
     * @returns descendants breadth-first with the raw usage and model they carry.
     */
    function collectDescendants(list, rootId) {
      if (list === null || typeof list !== 'object' || typeof rootId !== 'string') return [];
      const byId = list.byId !== null && typeof list.byId === 'object' ? list.byId : null;
      if (byId === null) return [];
      const byParent = new Map();
      for (const id of Object.keys(byId)) {
        const row = byId[id];
        const parent = row !== null && typeof row === 'object' ? row.parentId : undefined;
        if (typeof parent !== 'string' || parent === '') continue;
        const bucket = byParent.get(parent);
        if (bucket === undefined) byParent.set(parent, [id]);
        else bucket.push(id);
      }
      const projections = list.projectionsBySession !== null && typeof list.projectionsBySession === 'object' ? list.projectionsBySession : {};
      const found = [];
      const seen = new Set([rootId]);
      let frontier = byParent.get(rootId) ?? [];
      while (frontier.length > 0) {
        const next = [];
        for (const id of frontier) {
          if (seen.has(id)) continue;
          seen.add(id);
          const row = byId[id];
          if (row === null || typeof row !== 'object') continue;
          const projected = projections[id] !== undefined && projections[id] !== null ? projections[id].values : undefined;
          const values = row.projectionValues !== undefined && row.projectionValues !== null ? row.projectionValues : projected !== undefined && projected !== null ? projected : {};
          const modelSelection = values.modelSelection;
          const lastUsed = modelSelection !== null && typeof modelSelection === 'object' ? modelSelection.lastUsed : null;
          const title = typeof row.displayTitle === 'string' && row.displayTitle !== '' ? row.displayTitle : typeof row.title === 'string' && row.title !== '' ? row.title : id;
          found.push({
            id,
            label: title,
            usage: values.tokenUsage,
            model: lastUsed !== null && typeof lastUsed === 'object' ? lastUsed.model : undefined,
            depth: typeof row.depth === 'number' ? row.depth : 0,
          });
          const kids = byParent.get(id);
          if (kids !== undefined) next.push(...kids);
        }
        frontier = next;
      }
      return found;
    }

    /**
     * Price every descendant and rank the rows by spend.
     * @param descendants - output of {@link collectDescendants}.
     * @param tier - the chosen rate window.
     * @returns priced child rows plus their summed total.
     */
    function priceChildren(descendants, tier) {
      const rows = descendants.map((child) => ({
        id: child.id,
        label: child.label,
        pending: child.usage === undefined || child.usage === null,
        cost: computeCost(child.usage, tier, child.model),
      }));
      rows.sort((left, right) => right.cost.total - left.cost.total);
      return {
        rows,
        total: rows.reduce((sum, row) => sum + row.cost.total, 0),
        count: rows.length,
      };
    }

    /** Format one ¥/M unit price without trailing zeros. */
    function formatRate(value) {
      const n = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
      return '¥' + (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2)) + '/M';
    }

    /** Read the persisted rate window, defaulting to peak (conservative). */
    function readTier() {
      try {
        const stored = window.localStorage.getItem(TIER_KEY);
        if (stored === 'offpeak' || stored === 'peak') return stored;
      } catch {
        /* storage unavailable: use the default */
      }
      return DEFAULT_TIER;
    }

    /** Persist the chosen rate window. */
    function writeTier(tier) {
      try {
        window.localStorage.setItem(TIER_KEY, tier === 'offpeak' ? 'offpeak' : 'peak');
      } catch {
        /* storage unavailable: the value stays page-local */
      }
    }
    //#endregion

    //#region dsh-task-cost: components
    const ICON = jsxs('svg', {
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      'aria-hidden': true,
      children: [
        jsx('circle', {
          cx: 8,
          cy: 8,
          r: 6.25,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        jsx('path', {
          d: 'M5.4 4.7 8 8.2 10.6 4.7 M8 8.2v3.6 M6 9.4h4 M6 11h4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      ],
    });

    /** One labelled detail row: name, token count and its money share. */
    function detailRow(label, tokens, cost, rate) {
      return jsxs('div', {
        className: 'dcm_row',
        children: [
          jsxs('span', {
            className: 'dcm_rowLabel',
            children: [
              label,
              jsx('span', { className: 'dcm_rowMeta', children: ' · ' + formatTokens(tokens) + ' tok · ' + formatRate(rate) }),
            ],
          }),
          jsx('span', { className: 'dcm_rowValue', children: formatCny(cost) }),
        ],
      });
    }

    /** Section heading with its own subtotal. */
    function sectionHead(label, total) {
      return jsxs('div', {
        className: 'dcm_sectionHead',
        children: [
          jsx('span', { children: label }),
          jsx('span', { className: 'dcm_sectionTotal', children: formatCny(total) }),
        ],
      });
    }

    /** One child-session row: display title, compact token count and its spend. */
    function childRow(row, tr) {
      const tokens = row.cost.billedInputTokens + row.cost.tokens.outputTokens;
      const meta = row.pending ? tr('child.pending') : formatCompactTokens(tokens) + ' tok';
      const known = row.cost.modelKnown ? '' : ' · ' + row.cost.priceModel;
      return jsxs('div', {
        className: 'dcm_childRow',
        children: [
          jsxs('span', {
            className: 'dcm_childLabel',
            title: row.label,
            children: [row.label, jsx('span', { className: 'dcm_childMeta', children: ' · ' + meta + known })],
          }),
          jsx('span', { className: 'dcm_childCost', children: row.pending ? '—' : formatCny(row.cost.total) }),
        ],
      });
    }

    /**
     * The click-through breakdown panel, portaled to <body> above/below the
     * pill. `tr` is the locale seat (`t` from the slot registration), `style`
     * carries the clamped, measured position from {@link CostPill}, and
     * `children` is the priced descendant-session rows.
     */
    function CostPanel(props) {
      const { cost, children, childTotal, total, tier, chooseTier, style, tr, panelRef } = props;
      const hasChildren = children.length > 0;
      const mainRows = [
        jsx(Fragment, { children: detailRow(tr('row.cacheHit'), cost.tokens.cacheReadTokens, cost.cacheHitCost, cost.price.cacheHit) }, 'hit'),
        jsx(Fragment, { children: detailRow(tr('row.cacheMiss'), cost.tokens.uncachedInputTokens, cost.cacheMissCost, cost.price.cacheMiss) }, 'miss'),
        cost.tokens.cacheWriteTokens > 0
          ? jsx(Fragment, { children: detailRow(tr('row.cacheWrite'), cost.tokens.cacheWriteTokens, cost.cacheWriteCost, cost.price.cacheMiss) }, 'write')
          : null,
        jsx(Fragment, { children: detailRow(tr('row.output'), cost.tokens.outputTokens, cost.outputCost, cost.price.output) }, 'output'),
      ];
      return jsxs('div', {
        ref: panelRef,
        className: 'dcm_panel',
        role: 'dialog',
        'aria-label': tr('dialog.title'),
        style,
        children: [
          jsxs('div', {
            className: 'dcm_header',
            children: [
              jsx('span', { className: 'dcm_title', children: tr('dialog.title') }),
              jsx('span', { className: 'dcm_total', children: formatCny(total) }),
            ],
          }),
          jsx('div', { className: 'dcm_rule', 'aria-hidden': true }),
          hasChildren ? sectionHead(tr('section.main'), cost.total) : null,
          jsxs('div', { className: 'dcm_rows', children: mainRows }),
          hasChildren
            ? jsxs('div', {
                className: 'dcm_section',
                children: [
                  sectionHead(tr('section.children', { count: children.length }), childTotal),
                  jsxs('div', {
                    className: 'dcm_children',
                    children: children.map((row) => jsx(Fragment, { children: childRow(row, tr) }, row.id)),
                  }),
                ],
              })
            : null,
          hasChildren
            ? jsxs('div', {
                className: 'dcm_foot',
                children: [
                  jsx('span', { children: tr('row.total') }),
                  jsx('span', { className: 'dcm_footValue', children: formatCny(total) }),
                ],
              })
            : null,
          jsxs('div', {
            className: 'dcm_tier',
            children: [
              jsx('span', { className: 'dcm_tierLabel', children: tr('tier.label') }),
              jsxs('span', {
                className: 'dcm_seg',
                role: 'group',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'dcm_segBtn',
                    'aria-pressed': tier === 'peak',
                    onClick: () => chooseTier('peak'),
                    children: tr('tier.peak'),
                  }, 'peak'),
                  jsx('button', {
                    type: 'button',
                    className: 'dcm_segBtn',
                    'aria-pressed': tier === 'offpeak',
                    onClick: () => chooseTier('offpeak'),
                    children: tr('tier.offpeak'),
                  }, 'offpeak'),
                ],
              }),
            ],
          }),
          jsxs('div', {
            className: 'dcm_note',
            children: [
              tr(cost.modelKnown ? 'note.known' : 'note.unknown', { model: cost.sourceModel }),
              hasChildren ? ' ' + tr('note.children') : '',
              ' ',
              jsx('a', {
                className: 'dcm_link',
                href: PRICE_SOURCE,
                target: '_blank',
                rel: 'noopener noreferrer',
                children: tr('link.pricing'),
              }),
            ],
          }),
        ],
      });
    }

    /**
     * The dock entry: a status pill showing the estimated session spend,
     * including every descendant Session (spawn/fork children) the Client
     * session list links to this one.
     *
     * Props are the composed slot contract for a `session`-scope list slot:
     * `useProjection` (host-computed Session projection hook), `useSessions`
     * (session-list selector hook), `sessionId`, `useSession`, `t` (this
     * plugin's registered locale namespace), plus the framework render shares.
     * Only the projections, the session list and `t` are used.
     */
    function CostPill(props) {
      const usage = props.useProjection('tokenUsage');
      const modelSelection = props.useProjection('modelSelection');
      const sessionList = props.useSessions((state) => state);
      const descendants = React.useMemo(() => collectDescendants(sessionList, props.sessionId), [sessionList, props.sessionId]);
      const [tier, setTier] = React.useState(readTier);
      const [open, setOpen] = React.useState(false);
      const [panelStyle, setPanelStyle] = React.useState(null);
      const buttonRef = React.useRef(null);
      const panelRef = React.useRef(null);

      React.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const button = buttonRef.current;
          const panel = panelRef.current;
          const target = event.target;
          if (target instanceof Node && ((button && button.contains(target)) || (panel && panel.contains(target)))) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const close = () => setOpen(false);
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('resize', close);
          window.removeEventListener('scroll', close, true);
        };
      }, [open]);

      // The framework `t` seat is present because the registration declares
      // `locale`; the browser-language dictionaries stay as a fallback so the
      // component still renders if a composition omits the locale face.
      const localeT = typeof props.t === 'function' ? props.t : null;
      const dict = localeT === null ? fallbackDict() : null;
      const tr = (key, params) => (localeT !== null ? localeT(key, params) : fill(dict[key] !== undefined ? dict[key] : key, params || {}));

      const lastUsed = modelSelection !== null && typeof modelSelection === 'object' ? modelSelection.lastUsed : null;
      const model = lastUsed !== null && typeof lastUsed === 'object' ? lastUsed.model : undefined;
      const cost = computeCost(usage, tier, model);
      const childPricing = priceChildren(descendants, tier);
      const total = cost.total + childPricing.total;
      const hasUsage = (usage !== undefined && usage !== null && cost.total > 0) || childPricing.total > 0;
      if (!hasUsage) return null;

      const chooseTier = (next) => {
        if (next === tier) return;
        writeTier(next);
        setTier(next);
      };

      const toggle = () => {
        if (!open) {
          const button = buttonRef.current;
          const rect = button ? button.getBoundingClientRect() : null;
          if (rect) {
            const margin = 8;
            const gap = 8;
            const viewportWidth = window.innerWidth || 0;
            const viewportHeight = window.innerHeight || 0;
            const width = Math.max(200, Math.min(268, viewportWidth - margin * 2));
            const right = Math.max(margin, Math.min(viewportWidth - width - margin, viewportWidth - rect.right));
            // Prefer above the pill; fall back to below when the upper half is tight.
            const placeBelow = rect.top < Math.min(320, viewportHeight / 2);
            const available = placeBelow ? viewportHeight - rect.bottom - gap - margin : rect.top - gap - margin;
            const maxHeight = Math.max(140, Math.min(320, available));
            const base = {
              position: 'fixed',
              right: right + 'px',
              width: width + 'px',
              maxHeight: maxHeight + 'px',
              overflowY: 'auto',
              zIndex: 1100,
            };
            setPanelStyle(
              placeBelow
                ? { ...base, top: rect.bottom + gap + 'px' }
                : { ...base, bottom: viewportHeight - rect.top + gap + 'px' },
            );
          }
        }
        setOpen(!open);
      };

      const pillTitle = childPricing.count > 0 ? tr('pill.titleChildren', { count: childPricing.count }) : tr('pill.title');
      const label = tr('label.estimate') + formatCny(total);
      return jsxs('span', {
        className: 'dcm_anchor',
        'data-composer-stat': 'cost',
        children: [
          jsxs('button', {
            ref: buttonRef,
            type: 'button',
            className: 'dcm_pill',
            title: pillTitle,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': pillTitle + ' ' + label,
            onClick: toggle,
            children: [ICON, jsx('span', { className: 'dcm_label', children: label })],
          }),
          open && panelStyle
            ? ReactDOM.createPortal(
                jsx(CostPanel, {
                  cost,
                  children: childPricing.rows,
                  childTotal: childPricing.total,
                  total,
                  tier,
                  chooseTier,
                  style: panelStyle,
                  tr,
                  panelRef,
                }),
                document.body,
              )
            : null,
        ],
      });
    }
    //#endregion

    //#region dsh-task-cost: styles
    // Only host theme tokens are referenced, so the pill follows light/dark
    // themes and any third-party skin without plugin-side color logic.
    const CSS = `
.dcm_anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}
.dcm_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}
.dcm_pill svg{flex:none;width:14px;height:14px}
.dcm_pill:hover,.dcm_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dcm_label{text-overflow:ellipsis;min-width:0;overflow:hidden}
.dcm_panel{box-sizing:border-box;padding:10px 12px;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-panel);font-size:12px;line-height:18px;text-align:left;max-height:320px;overflow-y:auto}
.dcm_header{align-items:baseline;justify-content:space-between;gap:12px;display:flex}
.dcm_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.dcm_total{color:var(--dsw-alias-state-business-primary);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;flex:none}
.dcm_rule{height:.5px;background:var(--dsw-alias-border-l1);margin:7px 0 8px}
.dcm_section{margin-top:8px}
.dcm_sectionHead{align-items:baseline;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;display:flex;margin-bottom:4px}
.dcm_sectionTotal{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dcm_children{flex-direction:column;gap:4px;display:flex}
.dcm_childRow{justify-content:space-between;gap:12px;display:flex}
.dcm_childLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dcm_childMeta{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dcm_childCost{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;flex:none}
.dcm_foot{align-items:baseline;justify-content:space-between;gap:12px;color:var(--dsw-alias-label-primary);font-weight:600;display:flex;border-top:.5px solid var(--dsw-alias-border-l1);margin-top:9px;padding-top:7px}
.dcm_footValue{font-variant-numeric:tabular-nums}
.dcm_rows{flex-direction:column;gap:5px;display:flex}
.dcm_row{justify-content:space-between;gap:12px;display:flex}
.dcm_rowLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dcm_rowMeta{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dcm_rowValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;flex:none}
.dcm_tier{align-items:center;gap:6px;margin-top:11px;display:flex}
.dcm_tierLabel{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dcm_seg{border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;gap:1px;padding:1px;display:inline-flex}
.dcm_segBtn{font:inherit;font-size:11px;line-height:16px;border:0;border-radius:999px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:2px 8px}
.dcm_segBtn[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dcm_note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-top:9px}
.dcm_link{color:var(--dsw-alias-state-business-primary);text-decoration:none}
.dcm_link:hover{text-decoration:underline}
`;

    /**
     * Install this fiber's stylesheet. Ownership is per instance: a tag left by
     * a previous fiber (crash during teardown, duplicate load) is replaced so
     * the current CSS constants always win.
     */
    function installStyles() {
      const stale = document.querySelectorAll('style[data-dsh-plugin="dsh-task-cost"]');
      stale.forEach((element) => element.remove());
      const tag = document.createElement('style');
      tag.dataset.dshPlugin = 'dsh-task-cost';
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => {
        tag.remove();
      };
    }
    //#endregion

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => installStyles());
        ctx.effect(() => {
          // Register through a guard: a hot replacement can briefly overlap the
          // previous fiber, whose identical dictionary registration then holds
          // the (ns, locale) seat. Failing activation over that would drop the
          // pill, so keep the slot mounted instead.
          const registerDict = (locale, dict) => {
            try {
              return ctx.locale.register(LOCALE_NS, locale, dict);
            } catch (error) {
              if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('dsh-task-cost: locale dictionary already registered', error);
              }
              return () => {};
            }
          };
          const removeEn = registerDict('en', DICTS.en);
          const removeZh = registerDict('zh', DICTS.zh);
          return () => {
            removeZh();
            removeEn();
          };
        });
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'cost-meter',
              order: 2,
              locale: LOCALE_NS,
            },
            CostPill,
          ),
        );
      },
      // Exposed for the package's pure-math tests; the Harness ignores it.
      __test: {
        PRICES,
        KNOWN_MODELS,
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
        CostPill,
      },
    };
  },
});
