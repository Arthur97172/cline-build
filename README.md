# cline-build

Cline CLI（`@cline/cli`）的 **musl Linux 非官方构建**，供 [luci-app-fcc](https://github.com/Arthur97172/luci-app-fcc)
在 OpenWrt 等 musl 系统上安装 `cline` 智能体时下载。

## 为什么需要这个仓库

上游 `cline` 的 npm 包只发布 glibc 平台的二进制（`@cline/cli-linux-x64`、
`@cline/cli-linux-arm64`），在 musl 上 `execve` 直接以 `ENOENT` 失败——文件在，
但内核找不到 `/lib64/ld-linux-x86-64.so.2`。

- 上游请求：<https://github.com/cline/cline/issues/15271>
- 上游补丁 PR：<https://github.com/cline/cline/pull/15328>（增加 musl 目标）

PR 合并并发布 `@cline/cli-linux-*-musl` 之前，这个仓库用同样的改动手工构建两个
musl 二进制。**上游一旦发布官方 musl 包，luci-app-fcc 会优先使用官方包，本仓库
即可归档。**

## 发布物

每次发布（tag 形如 `v3.0.74-musl.1`）包含：

| 文件 | 内容 |
| --- | --- |
| `cli-linux-x64-musl` | x86_64 musl 二进制 |
| `cli-linux-arm64-musl` | aarch64 musl 二进制 |
| `SHA256SUMS` | 两个文件的 sha256 |
| `manifest.json` | 版本、上游 tag/commit、构建时间、文件校验和 |
| `LICENSE` | 上游 cline/cline 的 Apache-2.0 许可证 |

稳定下载地址（无需 GitHub API、不消耗限流）：

```
https://github.com/Arthur97172/cline-build/releases/latest/download/manifest.json
https://github.com/Arthur97172/cline-build/releases/latest/download/SHA256SUMS
https://github.com/Arthur97172/cline-build/releases/latest/download/cli-linux-x64-musl
https://github.com/Arthur97172/cline-build/releases/latest/download/cli-linux-arm64-musl
```

`latest` 重定向后的 `Location` 里带着 tag，可据此得知当前版本，不必调用 API。

## 运行要求

- 目标系统需要 **libstdc++**（OpenWrt：`libstdcpp6`）。缺了它二进制会在 loader
  阶段失败，与当初的 glibc 问题看起来很像。
- 这些构建**不带遥测密钥**：上游发布流程会从 secrets 注入 OTEL/telemetry 变量，
  这里不注入，所以对应的 `define` 是空串。

## 自动构建

- 每天 **05:00（Asia/Shanghai，cron `0 21 * * *` UTC）** 运行一次。
- 先查 npm 上 `@cline/cli` 的最新版本；该版本已发布过就直接跳过。**每天检查，
  按版本发布**——不是每天一个 release。
- 只从上游 tag（`cli-v<version>`）构建，绝不构建 `main`。
- x64 二进制在 Alpine 容器里做一次 `--version` 冒烟；arm64 由真实设备验证。
- 发布时附上 `actions/attest-build-provenance` 生成的来源证明。
- 只保留最近 5 个 release。

手动补跑：Actions → *Build musl binaries* → *Run workflow*，可填版本号；勾选
`force` 会覆盖已存在的同名 release。

## 本地构建

```sh
git clone https://github.com/cline/cline /tmp/cline
git -C /tmp/cline checkout cli-v3.0.74
node scripts/patch-cline.mjs /tmp/cline
(cd /tmp/cline && bun install)
bun run scripts/build-musl.ts /tmp/cline out
```

Bun 版本要与 `.github/workflows/build-musl.yml` 里的 `BUN_VERSION` 一致（当前
1.4.2，取自上游发布流程）。

## 维护要点

- **补丁锚点**：`scripts/patch-cline.mjs` 在 `apps/cli/script/compile-binary.ts`
  的 telemetry 注释前插入 `OPENTUI_LIBC` 的 `define`。上游改了这个区块，构建会
  立刻变红并打印缺的锚点；此时更新锚点和 `patches/opentui-musl-libc.patch`。
- **Bun 版本**：musl 目标依赖 Bun 的 `bun-linux-*-musl` 交叉编译，跟随上游发布
  流程的版本。
- **定时任务**：GitHub 对 60 天无提交的仓库会自动停用 `schedule`；本仓库改动
  不多时，记得每两个月推一次提交或手动触发一次。
- **上游合并后**：删除 workflow（或在 `Resolve version` 里加"官方 musl 包存在
  则退出"的判断），归档仓库。

## 许可与免责声明

构建的是 cline/cline 的源代码，遵循其 **Apache-2.0** 许可证；本仓库只包含构建
脚本与补丁。这些二进制**不是官方发布**，不由 Cline 团队支持。使用者应自行
校验 `SHA256SUMS` 与来源证明。
