# dsh-task-cost — 会话/任务消费估算插件（DSH Web）

在 DeepSeek Harness Web GUI 输入框底部的统计条里加一个 **≈¥ 消费估算** 胶囊：
显示**当前会话 + 它派生的所有子会话**（子代理会话）的预估花费。点开可看主会话的
缓存命中/未命中输入、输出明细，以及每个子会话各自的 token 与花费；可在「高峰 / 空闲」
两档官方单价间切换。

```
🕐 1 轮 50 步 · 261 tok/s   🗄 4M tok · 缓存命中 99%   ≈¥7.68   ◔ 11%
                                                       ↑ 本插件
```

## 安装

要求 DSH `>=0.2.1-rc.2`（Web 版）。

**方式 A：Plugins 页面**
打开 Web GUI 左侧 **Plugins**，安装/启用本插件（发布到 npm 后可直接按包名安装）。

**方式 B：命令行**

```powershell
dsh plugin --profile web add dsh-task-cost
```

安装后 bundle 会被加进该 profile 的 `dsh.profile.bundles`，HMR 会热加载；
若页面未立即出现胶囊，`Ctrl+F5` 硬刷新一次。

**方式 C：本地 tarball（不经过 npm）**

```powershell
dsh plugin --profile web add .\dsh-task-cost-0.1.0.tgz
```

## 价格口径

人民币 / 百万 tokens，取自 [DeepSeek 官方价格表](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：

| 模型 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|---|---|---|---|
| `deepseek-flash` 高峰 / 空闲 | ¥0.04 / ¥0.02 | ¥2 / ¥1 | ¥8 / ¥4 |
| `deepseek-v4-pro` 高峰 / 空闲 | ¥0.30 / ¥0.15 | ¥9 / ¥4.5 | ¥27 / ¥13.5 |

- 高峰时段：北京时间周一至周五（不含法定节假日）9:00–12:00、14:00–18:00；其余为空闲时段。
- 会话是跨时段累计的，无法反推每笔请求的时段，因此**默认按高峰价估算（偏高、保守）**；弹层可切空闲。
- 模型取会话的 `modelSelection.lastUsed`；名字含 `pro` 按 pro 价，否则按 flash 价（未知模型会标注兜底）。
- 子会话按会话列表的 `parentId` 链递归聚合（含孙会话），各用自己的 token 与模型；同一父会话下的兄弟不互相计入。

## 特点

- 纯前端展示，无额外网络请求、不读 DOM、不轮询；数据来自 Harness 的 `tokenUsage` 投影。
- 文案跟随 DSH 界面语言（插件向 Client locale 服务注册 zh/en 字典）。
- 跟随明暗主题与换肤（`--dsw-alias-*` 主题 token）。
- 只在有 token 用量时出现；无用量不占位。

## 已知限制

- 估算值，非账单；不含 Search/Fetch 按次费用。
- 已结束的子会话取持久化投影检查点，可能短暂显示「待统计」，列表刷新后补齐。
- 会话中途切换模型时，全部 token 按最后用过的模型统一计价。

## 开发

源码结构、测试与验证脚本见仓库 README；本文件是发布包内的用户说明。

## License

MIT
