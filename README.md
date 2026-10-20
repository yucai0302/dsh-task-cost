# dsh-task-cost — 会话/子会话消费估算插件

简体中文 | [English](README.en.md)

> DSH Web 插件（bundle 包）：在输入框底部统计条显示**当前会话 + 全部子代理会话**的预估花费。
> 当前通过本 GitHub 仓库分发（npm 包暂未发布），发布/分发细节见 [PUBLISHING.md](PUBLISHING.md)。

## 安装（给使用者）

```powershell
# GitHub（跟随 main）
dsh plugin --profile web add github:yucai0302/dsh-task-cost

# 或锁定 tag / Release
dsh plugin --profile web add github:yucai0302/dsh-task-cost#v0.1.0

# 或离线 tarball
dsh plugin --profile web add .\dsh-task-cost-0.1.0.tgz
```

要求 DSH `>=0.2.1-rc.2`（Web）。插件声明了 `dsh.bundle`，安装时会自动把 bundle 加进
profile 的 `dsh.profile.bundles`；运行中的 Web 页面会热加载（无需重启），若没出现胶囊
`Ctrl+F5` 硬刷新一次即可。Plugins 页面也能看到并管理它。

在 DeepSeek Harness Web GUI 输入框底部的统计条里，追加一个 **≈¥ 消费估算** 胶囊：

```
🕐 1 轮 50 步 · 261 tok/s      🗄 4M tok · 缓存命中 99%      ¥0.16      ◔ 11%
                                                             ↑ 本插件
```

数字来自 Harness 的 `tokenUsage` 会话投影（整段对话的持久化 provider 用量），
模型取自 `modelSelection` 投影的 `lastUsed.model`，按 DeepSeek 官方单价折算。
**它会把当前会话派生的所有子会话（spawn/fork 出来的独立计费会话）也算进来**，
胶囊显示的是「主会话 + 全部子孙会话」的合计；点开会分区显示：主会话的
缓存命中输入 / 缓存未命中输入 / 输出明细，以及每个子会话的 token 量与花费，
可在「高峰 / 空闲」两档单价之间切换（档位对全部会话生效）。

```
主会话                ¥4.12
  缓存命中输入 · 56.1M tok · ¥0.04/M   ¥2.24
  ...
子会话 · 2 个          ¥3.56
  Review — slot API · 19.2M tok        ¥1.99
  READ-ONLY recon · 17.3M tok          ¥1.57
合计（含子会话）        ¥7.68
```

## 价格口径

单位：人民币 / 百万 tokens，取自 [DeepSeek 官方价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)。

| 模型 | 项目 | 高峰单价 | 空闲单价 |
|---|---|---|---|
| `deepseek-flash` | 输入（缓存命中） | ¥0.04 | ¥0.02 |
| `deepseek-flash` | 输入（缓存未命中） | ¥2 | ¥1 |
| `deepseek-flash` | 输出 | ¥8 | ¥4 |
| `deepseek-v4-pro` | 输入（缓存命中） | ¥0.30 | ¥0.15 |
| `deepseek-v4-pro` | 输入（缓存未命中） | ¥9 | ¥4.5 |
| `deepseek-v4-pro` | 输出 | ¥27 | ¥13.5 |

- 高峰时段：北京时间周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00；其余时间为空闲时段，空闲价 = 高峰价的一半。
- 会话是跨时段累计的，无法从聚合 token 数反推每笔请求的时段，因此胶囊**默认按高峰价估算（偏高、保守）**；弹层里切到「空闲」即可看另一档。
- 模型名含 `pro` 时按 `deepseek-v4-pro` 计价，其余/未知模型按 `deepseek-flash` 计价；未知模型的弹层文案会明确标注「按 flash 兜底估算」。`tokenUsage` 是会话累计值、没有按请求的模型归属，所以「会话中途换过模型」时全部 token 按最后用过的模型估算（近似）。
- `cacheWriteTokens`（DeepSeek 恒为 0）按未命中价计，属于保守处理。
- 不含 Search / Fetch 按次计费的部分。

## 显示与交互
<img width="1709" height="625" alt="image" src="https://github.com/user-attachments/assets/1fcca89e-aa67-4d74-9c60-3a8927f550ff" />

- 只在当前会话有 token 用量时出现，用量为 0 时自动隐藏，不占位。
- 子会话按「子孙关系」聚合：从 Client 会话列表的 `parentId` 链递归收集，因此孙会话也会计入；同一个父会话下的兄弟会话不会互相计入。
- 子会话的费用使用各自 `projectionValues` 里的 `tokenUsage` 与 `modelSelection`（活动会话取实时投影，已结束会话取持久化检查点，可能略有滞后）。
- 胶囊样式复刻宿主统计条（`--dsw-alias-*` 主题 token），跟随明暗主题与换肤。
- 文案跟随 DSH 界面语言：插件通过 Client locale 服务注册自己的 `dsh-task-cost` 命名空间（zh/en 字典），与宿主统计条一致，不再按浏览器语言硬切。
- 弹层是 portal，定位在胶囊上方（空间不足时在下方）；位置按视口夹取、限制最大高度并可滚动，`Esc`、点击外部、滚动、窗口缩放都会关闭。
- 所选单价档位存在浏览器 `localStorage`：`dsh-task-cost:tier`（`peak` | `offpeak`）。

## 实现

| 文件 | 作用 |
|---|---|
| `package.json` | 插件包清单：`dsh.bundle.patch` + `dsh.client`（`platform: web`, `immediately`, `inject` 会话 UI） |
| `cordis.patch.yml` | bundle 补丁层：插入一条 Loader 行 `id: cost-meter, name: dsh-task-cost` |
| `index.js` | Host 侧空实现（只为让包有一条 Loader 行，供客户端模块图扫描） |
| `client.js` | 浏览器侧 bundle：`window.__ModuleLoader__.load({ id, factory })`，注册到 `conversation.composer.dock` 槽位 |
| `locale/*.json` | Plugins 页面显示用的 `meta.title` / `meta.description`（中/英）；运行时 UI 文案的 zh/en 字典在 `client.js` 里，注册进 Client locale 服务 |
| `icon.svg` | Plugins 页面图标（自绘：¥ 符号 + 硬币轮廓） |
| `test/cost.test.mjs` | 纯函数 / 装配 / 组件渲染 / 子会话聚合测试（20 例，无浏览器依赖） |
| `scripts/probe-bundle.mjs` | 无需登录态验证「插件是否进入运行中宿主的前端模块图」 |
| `scripts/verify-live.mjs` | 校验运行中宿主按最新 revision 提供本插件的 bundle（内容逐字节比对） |
| `scripts/session-cost.mjs` | 宿主侧独立核算工具：直接折叠任意会话日志（含 zstd 分帧）按官方单价算钱，可用来对照插件显示 |
| `scripts/link-profile.ps1` | 链接安装 + 启用 + 校验（本机已执行） |
| `scripts/unlink-profile.ps1` | 停用 + 卸载，恢复 profile 原状 |

数据流：`tokenUsage` 是 Harness 在 Host 侧按会话日志折叠出的投影，客户端通过
slot props 的 `useProjection('tokenUsage')` 读取，随之自动重渲染 —— 插件自己不订阅事件、
不轮询、不读 DOM。

## 安装 / 更新 / 卸载（本机已装好，以下供复现）

安装（profile 是 `web`，插件源码在 `D:\dsh\01814start\plugins\dsh-task-cost`）：

```powershell
# 1. 链接进 web profile（本机 node_modules 由 pnpm 10 生成，必须显式指定旧 store）
Set-Location "$env:USERPROFILE\.dsh\profiles\web"
pnpm add "link:D:\dsh\01814start\plugins\dsh-task-cost" `
  "--config.store-dir=C:\Users\liuchang\.pnpm\store\v11"

# 2. 把包名加进 profile package.json 的 dsh.profile.bundles（顺序末尾）
#    等价于 Plugins 页面里启用该 bundle；HMR 会热生效，无需重启 dsh web
```

或者直接跑 `powershell -ExecutionPolicy Bypass -File plugins\dsh-task-cost\scripts\link-profile.ps1`。

改完 `client.js` 后无需重启：保存后 touch 一下 profile 的 `cordis.patch.yml` 触发 HMR 重组，
宿主会替换 linked 包并发布新的前端模块 revision（可用 `scripts/verify-live.mjs` 验证宿主
已按新 rev 提供 bundle；已打开的页面是否立即消费新模块取决于浏览器的 HMR 连接，硬刷新
可确保加载）。

卸载：

```powershell
powershell -ExecutionPolicy Bypass -File plugins\dsh-task-cost\scripts\unlink-profile.ps1
```

## 验证记录（2026-10-19）

- `node --test test/cost.test.mjs`：20/20 通过（纯函数 + `apply` 装配 + 组件渲染冒烟 + locale 字典完整性 + 子会话聚合，无浏览器依赖）。
- `dsh --profile web --patch plugins\dsh-task-cost\cordis.patch.yml --dump-config`：组合出
  `- id: cost-meter / name: dsh-task-cost`，无解析或解析错误。
- 启用后 **未重启** 运行中的 `dsh web`（PID 28380 保持运行）：`GET
  /plugins/??dsh-task-cost/client.js&rev=<sha>` 返回 **200** 且内容与磁盘逐字节一致
  （`scripts/verify-live.mjs`），说明插件已进入运行中宿主的前端模块图；改 `client.js` 后
  touch 一下 profile 的 `cordis.patch.yml` 即可换新 revision 热更新，无需重启。
- 为发布到 npm，包名从 `dsh-cost-meter` 改为 `dsh-task-cost`（前者在 npm 已被他人占用），
  并在运行中 profile 里完成 `link:` 重装 + bundle 名替换；当前 live rev 为
  `b07bb8fb8a0e`（34,709 B 源 / 34,779 B 宿主返回）。旧包名目录
  `plugins/dsh-cost-meter` 被宿主缓存句柄锁住，重启 `dsh web` 后可删除。
- 真实数据对照（`node scripts/session-cost.mjs`，直接折叠会话日志、不经过 UI）：本任务的
  `4e620e7f…` 子会话 cacheRead 18,817,664 → 高峰价 **¥1.992**（插件胶囊 ≈¥1.99 一致）；
  `1b5aba40…` cacheRead 17,093,120 → **¥1.5702**（≈¥1.57 一致）；主会话在写入时约 ¥4.12。
  三份日志的 session header 里 `parentSession` 指向主会话，和插件按 `parentId` 聚合的口径一致。
  也就是说：主会话 ¥4.12 + 两个子会话 ¥3.56，合计约 **¥7.68**，插件胶囊显示的就是这个合计。
- 浏览器内的最终渲染无法由本会话直接观察（无浏览器控制）；若页面未出现胶囊，先
  `Ctrl+F5` 硬刷新，再到控制台查看是否有 `dsh-task-cost` 相关报错。

## 已知限制

- 仅估算：单价来自官方公开价格表，产品价格可能调整；与账单口径以官方为准。
- 会话级累计：显示的是整段会话（含压缩、分支前历史）的累计用量，不是单轮。
- 模型归属取 `modelSelection.lastUsed`：中途换过模型的会话按最后用过的模型统一计价（近似）。
- 子会话费用依赖会话列表里携带的投影值：活动中的子会话是实时的；已结束且检查点尚未落盘的子会话可能短暂显示「待统计」，列表刷新后补齐。
- 不含 Search / Fetch 按请求计费；子代理会话已按 `parentId` 树计入，同一父会话下的兄弟任务不互相计入。
- 价格写死在 `client.js` 的 `PRICES` 常量里；要改档位/单价，改常量后保存即可热更新。
- 安装走的是本插件的脚本（`link:` + `dsh.profile.bundles`），而不是 UI 的插件管理器：本 profile 的 `node_modules` 由旧 pnpm store 生成，插件管理器的 `pnpm add` 会报 `ERR_PNPM_UNEXPECTED_STORE`。因此用界面里的「移除/升级」可能复现该错误，优先使用 `scripts/unlink-profile.ps1` / `scripts/link-profile.ps1`。
