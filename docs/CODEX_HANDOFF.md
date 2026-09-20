# 维护与部署交接 — v1.0.1

当前状态：Reddit API 未配置。现有部署、私密访问及本机验证摘要见 `../TEST_REPORT.md`。

## 范围

继续维护同一仓库和现有 Worker：原生 Static Assets + 每日 Cron + 单 KV namespace。不要另建系统或默认增加 D1、Queues、Durable Objects、React、多用户系统、AI 分析服务或额外数据库。

常规代码更新保留现有 CACHE 绑定、Cron 和 Secrets。真实 Reddit 凭据配置及调用属于独立集成步骤，不随日常文案、修复或部署自动开启。不使用匿名 JSON、RSS、抓取或镜像作为替代。

## Gate 1：依赖与构建

使用 Node 22+，从仓库根目录执行：

```sh
npm ci
npm run verify
npm run build:worker
```

Wrangler 固定为 4.135.0，package-lock.json 已提交。修改依赖时才重新解析并检查 lockfile。`build` 为源码/资源复制；`build:worker` 才是真实 Wrangler dry-run。保留断言，不通过删除测试让构建通过。

## Gate 2：本机运行

```sh
npm run dev
# 另一个终端：
curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"
```

验证首页、CSS/JS、health/status，以及 `Reddit API not configured.` 状态。无凭据时刷新禁用或明确返回 not_configured，scheduled handler 安全 skip。无 KV 时，鉴权后 Feed 应返回 storage_missing，外壳仍可访问。

`npm run dev:offline` 和 `--fixture` 是禁用外部 fetch 的 Node harness，不能冒充 workerd。合成帖子只用于本机测试，不上传到生产 KV。

## Gate 3：部署与私密访问

确认当前账号和现有资源后部署：

```sh
npx wrangler whoami
npm run deploy
```

只在首次自建部署且没有合适的专用 namespace 时创建 CACHE。不要重复创建资源。Secret 通过交互式 `wrangler secret put` 设置，不能写进代码、Git、日志或命令参数。

真实 HTTPS 必须检查匿名 Feed/refresh 拒绝、错误 key 拒绝、正确 key 登录，Cookie 的 Secure / HttpOnly / SameSite=Strict 属性，以及输入清空、reload 保持会话、logout 清空会话和内容。同样检查精确同源控制、API query/method 拒绝、CSP、no-store、no CORS 和原生 CSS/JS。必要时单独复核 key 轮换失效行为。

发布源码不解除私密 Feed 鉴权。公开报告仅保留必要结论，不提交本机路径、账号邮箱、完整请求头、Token、Cookie 或内容缓存。

## Gate 4：旧数据

新版本使用 feed:v2、attempt:v2、run:v2。若发现旧 feed:v1 / run:last，先确认归属，再只处理这两个键。不能清空共享 namespace，也不备份 Reddit 内容。本次专用 namespace 的初始检查为空，无需迁移。

## Gate 5：后续 API 集成

这是独立的配置工作。按账号实际可用的 API 权限和 OAuth 流程设置凭据，并把 User-Agent 的占位用户名替换为真实联系用户名。可选 refresh token 只用于相应的只读用户授权流程。

首次真实验证只执行一次有界刷新，核对 token grant、User-Agent、响应结构、分页和 rate headers。401/403/429/timeout 等故障优先用本机 mocks 验证，不制造请求洪峰或 Reddit 写入操作。

## Gate 6：Cron 与性能

Cron 保持 `0 1 * * *`（UTC 01:00 / 北京 09:00）。自然云端执行必须有实际记录，不能由本机 scheduled handler 推断。

分别记录空壳、私密 Feed、完整刷新 CPU 和 wall time。当前空 Feed 的 0–2 ms 样本不代表完整刷新性能。不要自动购买套餐或增加架构组件。

## 后续更新方式

在当前 main 上继续提交，执行与变更有关的检查后更新同一 Worker。依赖锁、生产配置、源代码及可复现测试留在仓库；本机证据和运维工具由 .gitignore 排除。

Git 历史整理后的其他旧克隆应先同步新 main，避免把旧运维记录重新合入。当前维护目录应与远端 main 保持一致，备份仅留在本机。
