# 发布与分发指南（dsh-task-cost）

本仓库既是插件源码，也是一个可直接发布的 npm「bundle 包」：`package.json` 里声明了
`dsh.bundle`（给 DSH profile 应用配置层）和 `dsh.client`（Web 客户端 bundle）。
发布后，任何人在 DSH 里 `dsh plugin --profile web add dsh-task-cost` 即可安装。

> 仓库已推送：<https://github.com/yucai0302/dsh-task-cost>（main @ `3c8f1a2`）。
> 已实测 `pnpm add github:yucai0302/dsh-task-cost` 可直接安装（本包无构建步骤）。
> 剩余只差 npm 发布（需本机 `npm login`）与可选的社区市场提交。

## 0. 前置检查

```powershell
node --test test/cost.test.mjs          # 20/20
node scripts/build-release.mjs --pack   # 生成 dist/dsh-task-cost-0.1.0.tgz
```

`package.json` 中的 `repository` / `homepage` / `bugs` 已指向
<https://github.com/yucai0302/dsh-task-cost>；如需发布到别的仓库，用 `--repo` 覆盖：

```powershell
node scripts/build-release.mjs --repo https://github.com/yucai0302/dsh-task-cost --pack
```

## 1. 发布到 npm

需要你自己的 npm 账号（本机当前未登录）：

```powershell
npm login                      # 浏览器/OTP 交互登录，只需一次
npm whoami                     # 应输出你的 npm 用户名
npm publish                    # 在仓库根目录执行；包已预 build，无需构建
```

- 包名 `dsh-task-cost` 目前未被占用；若发布时提示 403/已存在，说明被别人抢注，
  可改用 scoped 名（如 `@你的用户名/dsh-task-cost`），同时把 `package.json` 的
  `name`、`cordis.patch.yml` 的 `name:`、`client.js` 的 bundle `id` 一起改掉
  （`node scripts/build-release.mjs --name <新名> --pack` 会生成一致的发布包）。
- 2FA 账号发布时可能要求 OTP：`npm publish --otp <6位码>`。
- 发布后验证：

```powershell
npm view dsh-task-cost version
```

## 2. 建 GitHub 仓库并推送

```powershell
cd D:\dsh\01814start\plugins\dsh-task-cost
git init -b main
git config user.name "<你的 GitHub 显示名>"
git config user.email "<你的 GitHub 邮箱>"
git add .
git commit -m "feat: dsh-task-cost 0.1.0 — session/sub-session cost meter for DSH Web"
git remote add origin https://github.com/yucai0302/dsh-task-cost.git
git push -u origin main
```

然后在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加
`NPM_TOKEN`（npm 的 Automation/granular token，需 publish 权限），之后推 tag 即自动发布：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

同时在仓库 **About** 里加上 topics：`deepseek-harness`、`dsh-plugin`、`dsh`、`cost`、`token`。
社区聚合站（如 `ZASENJC/dsh-plugins-store`）会自动收录同时带
`dsh-plugin` 与 `deepseek-harness` topic 的公开仓库。

## 3. 可选：提交社区插件市场

DSH 没有官方市场索引；社区市场通过「索引源 URL」工作。常用渠道：

| 渠道 | 提交方式 |
|---|---|
| [Open Plugin Market](https://github.com/polang233/dsh-plugin-index)（`https://dshopen.org/index.json`） | 按模板提 issue：<https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin.yml> |
| [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | 提 PR 加一行 |
| dsh-plugins-store / dsh-market | 带上述 GitHub topics 后自动抓取 |

提交前确认：

- GitHub 仓库公开可访问；
- npm 上 `dsh-task-cost@0.1.0` 已发布，`npm view dsh-task-cost` 正常；
- `package.json` 里 `engines.dsh` 与当前 DSH 版本匹配（当前 `>=0.2.1-rc.2 <0.3.0`）；
- 图标 `icon.svg` 与 `locale/*.json` 的 `meta.title` / `meta.description` 在仓库里可见。

## 4. 别人怎么装

```powershell
# 方式 A：Plugins 页面搜索/安装，或命令行
dsh plugin --profile web add dsh-task-cost

# 方式 B：直接从 GitHub（需要 pnpm 构建授权；本包是纯 JS，无 build 步骤）
dsh plugin --profile web add github:<你的用户名>/dsh-task-cost

# 方式 C：离线 tarball
dsh plugin --profile web add .\dsh-task-cost-0.1.0.tgz
```

安装后 bundle 会自动加入 `dsh.profile.bundles`；Web 页面按 HMR 热加载，
必要时 `Ctrl+F5` 刷新。
