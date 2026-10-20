# dsh-task-cost — session & sub-session cost meter for DeepSeek Harness

English | [简体中文](README.md)

> A DSH Web plugin (bundle package) that shows the estimated spend of **the current
> session plus every sub-agent session it spawned** in the composer status bar.
> Distribution is via this GitHub repository; the npm package is not published yet.

<img width="1709" height="625" alt="dsh-task-cost preview" src="https://github.com/user-attachments/assets/1fcca89e-aa67-4d74-9c60-3a8927f550ff" />

## Install

Requires DSH `>=0.2.1-rc.2` (Web UI).

```powershell
# from GitHub (rolling main)
dsh plugin --profile web add github:yucai0302/dsh-task-cost

# or pin a tag/release
dsh plugin --profile web add github:yucai0302/dsh-task-cost#v0.1.0

# or install an offline tarball
dsh plugin --profile web add .\dsh-task-cost-0.1.0.tgz
```

The plugin declares `dsh.bundle`, so installing it adds the bundle to the profile's
`dsh.profile.bundles` automatically. The running Web page hot-loads it (no restart);
press `Ctrl+F5` once if the pill does not appear. It is also visible and manageable
on the **Plugins** page.

## What it shows

```
🕐 1 turn 50 steps · 261 tok/s   🗄 4M tok · cache hit 99%   ≈¥0.16   ◔ 11%
                                                              ↑ this plugin
```

The number is computed from Harness's `tokenUsage` session projection (the durable,
provider-reported usage of the whole session) and the model from the
`modelSelection` projection's `lastUsed.model`, priced with DeepSeek's official CNY
rates. **Every descendant session (spawn/fork sub-agents) is included**, so the pill
shows "main session + all descendant sessions". Click it for a breakdown:

```
Main session                              ¥4.12
  Cached input · 56.1M tok · ¥0.04/M      ¥2.24
  ...
Sub-sessions · 2                          ¥3.56
  Review — slot API · 19.2M tok           ¥1.99
  READ-ONLY recon · 17.3M tok             ¥1.57
Total (incl. sub-sessions)                ¥7.68
```

## Pricing

CNY per 1,000,000 tokens, from the
[official DeepSeek price list](https://api-docs.deepseek.com/quick_start/pricing).

| Model | Bucket | Peak | Off-peak |
|---|---|---|---|
| `deepseek-flash` | input (cache hit) | ¥0.04 | ¥0.02 |
| `deepseek-flash` | input (cache miss) | ¥2 | ¥1 |
| `deepseek-flash` | output | ¥8 | ¥4 |
| `deepseek-v4-pro` | input (cache hit) | ¥0.30 | ¥0.15 |
| `deepseek-v4-pro` | input (cache miss) | ¥9 | ¥4.5 |
| `deepseek-v4-pro` | output | ¥27 | ¥13.5 |

- Peak hours: Monday–Friday 09:00–12:00 and 14:00–18:00 Beijing time (excluding
  Chinese public holidays); every other time is off-peak, at half the peak rate.
- A session accumulates across both windows and the aggregate token counts cannot
  recover per-request timestamps, so the pill **defaults to peak pricing (a
  conservative over-estimate)**; switch to off-peak in the popover.
- A model id containing `pro` is priced as `deepseek-v4-pro`; anything else/unknown is
  priced as `deepseek-flash` and the popover says so. `tokenUsage` is a whole-session
  total without per-request model attribution, so a session that switched models
  mid-way is priced with the last used model (an approximation).
- `cacheWriteTokens` (always 0 on DeepSeek) is billed at the cache-miss rate.
- Search/Fetch per-request fees are not included.

## Display and interaction

- Hidden while the session has no token usage; it never occupies space when empty.
- Sub-sessions are collected recursively through the client session list's `parentId`
  chain, so grandchildren count too; siblings under the same parent do not include
  each other.
- Each sub-session is priced with its own `tokenUsage` and `modelSelection` (live
  sessions use live projections, finished ones use the persisted checkpoint, which
  can lag briefly).
- Styling copies the host status pills and uses `--dsw-alias-*` theme tokens, so it
  follows light/dark themes and skins.
- Copy follows the DSH UI language: the plugin registers its own `dsh-task-cost`
  namespace (zh/en dictionaries) with the Client locale service.
- The breakdown is a portaled popover clamped to the viewport, scrollable, and closes
  on `Esc`, outside click, scroll or resize.
- The chosen rate window is stored in `localStorage` under `dsh-task-cost:tier`
  (`peak` | `offpeak`).

## Implementation

| File | Role |
|---|---|
| `package.json` | Bundle manifest: `dsh.bundle.patch` + `dsh.client` (`platform: web`, `immediately`, conversation UI injection) |
| `cordis.patch.yml` | Bundle patch layer: inserts one Loader row `id: cost-meter, name: dsh-task-cost` |
| `index.js` | Empty Host half; it only gives the package a Loader row for the client module graph |
| `client.js` | Browser bundle: `window.__ModuleLoader__.load({ id, factory })`, registers into `conversation.composer.dock` |
| `locale/*.json` | `meta.title` / `meta.description` for the Plugins page (zh/en); runtime UI dictionaries live in `client.js` and are registered with the Client locale service |
| `icon.svg` | Plugins page icon (hand-drawn: ¥ + coin outline) |
| `test/cost.test.mjs` | Pure math / wiring / component smoke / sub-session aggregation tests (20 cases, no browser needed) |
| `scripts/probe-bundle.mjs` | Checks that a running Host publishes the plugin's client module (no auth cookie needed) |
| `scripts/verify-live.mjs` | Verifies the running Host serves the current bundle revision byte-for-byte |
| `scripts/session-cost.mjs` | Host-side cross-check: folds any session log (multi-frame zstd) and prices it with the official rates |
| `scripts/link-profile.ps1` | Link-install + enable + verify (used on this machine) |
| `scripts/unlink-profile.ps1` | Disable + uninstall, restoring the profile |

Data flow: `tokenUsage` is folded by the Host from the session log and delivered as a
Session projection; the client reads it through the slot prop
`useProjection('tokenUsage')` and re-renders automatically — the plugin never
subscribes to events, polls, or reads the DOM.

## Development install / update / uninstall

Install from this checkout (profile `web`):

```powershell
# 1. link the package into the web profile (this machine's node_modules was created
#    by an older pnpm store, so the store dir must be given explicitly)
Set-Location "$env:USERPROFILE\.dsh\profiles\web"
pnpm add "link:D:\dsh\01814start\plugins\dsh-task-cost" `
  "--config.store-dir=C:\Users\liuchang\.pnpm\store\v11"

# 2. add the package name to the profile package.json's dsh.profile.bundles
#    (equivalent to enabling the bundle on the Plugins page; HMR applies it live)
```

Or just run `powershell -ExecutionPolicy Bypass -File plugins\dsh-task-cost\scripts\link-profile.ps1`.

After editing `client.js`, no restart is needed: touch the profile's
`cordis.patch.yml` to trigger an HMR recomposition; the Host replaces the linked
package and publishes a new client module revision (`scripts/verify-live.mjs` proves
it; a hard refresh guarantees the open page consumes it).

Uninstall:

```powershell
powershell -ExecutionPolicy Bypass -File plugins\dsh-task-cost\scripts\unlink-profile.ps1
```

## Verification

- `node --test test/cost.test.mjs`: 20/20 pass (pure math, `apply` wiring, component
  render smoke, locale dictionary completeness, sub-session aggregation; no browser).
- `dsh --profile web --patch plugins\dsh-task-cost\cordis.patch.yml --dump-config`
  composes the row `- id: cost-meter / name: dsh-task-cost`.
- Hot-applied to the running `dsh web` (PID 28380, no restart):
  `GET /plugins/??dsh-task-cost/client.js&rev=<sha>` returns **200** with content
  byte-identical to disk (`scripts/verify-live.mjs`).
- Real-data cross-check (`node scripts/session-cost.mjs`, folding session logs directly):
  sub-session `4e620e7f…` cacheRead 18,817,664 → peak **¥1.992** (pill ≈¥1.99);
  `1b5aba40…` cacheRead 17,093,120 → **¥1.5702** (≈¥1.57); main session ≈¥4.12 when
  written. Their `parentSession` headers point at the main session, matching the
  plugin's `parentId` aggregation.
- Rendered DOM cannot be observed from the agent session; if the pill is missing,
  hard-refresh and check the console for `dsh-task-cost` / `slot entry crashed` errors.

## Known limitations

- Estimate only: rates come from the public price list and may change; billing is
  authoritative.
- Session-level totals: the whole session is counted (including compaction and
  pre-fork history), not a single turn.
- Model attribution uses `modelSelection.lastUsed`; a session that switched models is
  priced uniformly with the last model (approximation).
- Sub-session costs depend on projection values carried by the session list; a
  finished sub-session whose checkpoint has not landed yet can briefly show
  "pending" and fills in after the next list refresh.
- Search/Fetch per-request fees are not included. Sub-agent sessions are counted via
  the `parentId` tree; sibling tasks under the same parent do not include each other.
- Rates live in the `PRICES` constant in `client.js`; edit it and save (hot reload)
  to change them.

## License

MIT — see [LICENSE](LICENSE).
