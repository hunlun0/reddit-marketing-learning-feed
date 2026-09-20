# Reddit Marketing Learning Feed 技术 Review

日期：2026-09-20。输入：用户提供的 `reddit-marketing-learning-feed.zip`。检查对象为压缩包中的全部实际文件，而非仅依据 README。原始项目共 9 个文件，包括 4 个源代码文件。

## 结论

**原架构已经足够简单，应该保留；原实现尚不适合直接作为长期运行版本。** 问题主要集中在可构建性、缓存语义、API 容错、私密访问与实际运维，而不是缺少数据库或复杂基础设施。

本次继续使用单 Worker + 原生 Static Assets + 每日 Cron + 单 KV namespace。不引入 D1、Queues、Durable Objects、前端框架、复杂账号系统。源码版本由原来的 1.0.0 改为 1.0.1，定位为 v1 完整交付候选；不能把离线测试通过等同于真实部署验收通过。

## 实际发现及处理

| 编号 | 严重性 | 原始实现证据 | 处理 |
| --- | --- | --- | --- |
| R01 | 阻断 | `src/ui.js:75` 附近：外层 `String.raw` 模板中嵌入未转义反引号模板；显式 ES-module 语法检查报 `Unexpected token 'class'` | 拆为原生静态资源；所有 JS 做语法检查 |
| R02 | 高 | `src/reddit.js:175–193`：即使每项搜索均失败，仍设置 `last_success=completedAt` 并覆盖缓存 | 区分 complete / partial / failed；仅完整成功推进检查点；无可保存结果不重写内容 |
| R03 | 高 | `src/reddit.js:119–125`：score/comments 取 `Math.max`，且保留旧 title/body/author | 用最新复核结果更新；旧分数可以下降，编辑与删除作者信息可以生效 |
| R04 | 高 | `src/reddit.js:166–193`：仅刷新时按帖子日期裁剪，没有 TTL、删除复核；停止刷新后内容可能长期留存 | 30 天帖子窗口 + 每日 `/api/info` + 48 小时未复核到期；按最早到期时间设置整个 snapshot 过期 |
| R05 | 高 | `src/index.js:40–42`：Feed 无鉴权公开读取；与个人私密阅读工具定位不一致 | 复用 REFRESH_KEY 保护读取和刷新；不增加账号库 |
| R06 | 中 | `src/reddit.js:80–104`：32 条 query 各取 50 条，没有 after 分页 | 9 个组合全站搜索 + 1 个组合 subreddit listing；每源最多 2 页 |
| R07 | 中 | `src/reddit.js:33–45,90–104,148–162`：只有固定 sleep，无 timeout / rate reset / retry / 401 恢复 | 单客户端、有界重试/超时/响应大小/HTTP 请求数，403 不绕过 |
| R08 | 中 | `src/reddit.js:39–41,97–99,157–158` 与 `index.js:65–66`：把上游文本放入错误、日志或返回内容 | 固定错误码；不输出原始异常体。未声称发现了实际 Token 泄露 |
| R09 | 中 | `src/reddit.js:166–168`：数值仅取 `Number/Math.max`，未处理 NaN/Infinity 或上限 | 有限整数和上下限；MAX_POSTS 默认 400，最高 800 |
| R10 | 中 | 原配置分类主要来自搜索来源，无独立内容相关性判定、无 matched_keywords | 内容分类 + 可解释相关度 + 四类 provenance 去重并集 |
| R11 | 中 | `src/index.js:40–56`：读取/health 没有总入口安全错误处理；缺凭据刷新会抛错 | 总入口安全错误响应、轻量 health、显式 not_configured 状态 |
| R12 | 中 | 原版无刷新并发/频繁触发保护 | 同 isolate 防重 + 15 分钟 KV 冷却。明确不是全局锁 |
| R13 | 中 | 原 `.gitignore` 未完整覆盖 `.env.*` / `.dev.vars.*`；没有核心测试、锁文件或 build/check 流程 | 加忽略模式、空示例、原生测试、两级构建验证和后续 lockfile 步骤 |
| R14 | 低至中 | 原版有 HTML escaping，但缺统一 CSP/链接目标构造与完整移动端筛选 | 保留安全目标，用 textContent/DOM 构建；不是声称原版完全没有 escaping |

原版本的 `wrangler.jsonc` 格式、Cron UTC 换算、单 KV 思路、Bearer 刷新方向均没有必要推翻。原版手动刷新本来就 await 完成，本次继续保留，而非把一个不存在的“原版 202 问题”写成修复项。

## 20 项审查覆盖

| 用户检查项 | 最终判断 |
| --- | --- |
| 1 架构 | 保留；真正的存储量不需要数据库 |
| 2 Workers | 普通 ES modules；fetch/scheduled 入口；零运行期 npm 依赖 |
| 3 Wrangler | JSONC 已合适；补 assets，pin Wrangler；真实 schema/bundle 仍待工具验收 |
| 4 Cron | 原 `0 1 * * *` 正确；09:00 北京时间；缺 API 安全跳过 |
| 5 KV | 一个 snapshot + 两个无内容状态键；不做逐帖写入、KV list 扫描或假事务 |
| 6 OAuth/API | app-only + 可选 read-scope refresh token；按实际 API 权限配置；无凭据时安全跳过 |
| 7 搜索 | 合并 query；全站发现 + 优先社区补充；独立相关性过滤 |
| 8 分页 | after 游标，页数/数量/时间窗口上限，重复游标停止 |
| 9 rate limit | 750ms 节奏、remaining/reset、429 Retry-After；总请求和重试预算 |
| 10 去重 | post_id 唯一；categories/keywords/queries/sources 集合合并 |
| 11 保留 | 选择 A，无历史索引；删除复核与过期优先于无限保旧数据 |
| 12 Dashboard | 原生 DOM；移动端二级筛选折叠；原帖链接 |
| 13 Manual Refresh | 私密鉴权、同源校验、等待结果、冷却；不是持久后台队列 |
| 14 Secrets | Cloudflare Secret；本地空示例；没有真实凭据写入交付代码 |
| 15 错误处理 | 安全错误码；区分部分、整体、存储及状态写入失败 |
| 16 安全 | 默认私密、最少路由、无 CORS、无任意上游 URL、无写入型 Reddit API |
| 17 XSS | textContent；纯文本 excerpt；构造 Reddit HTTPS 链接；CSP 等响应头 |
| 18 未配置 fallback | 页面正常；状态清晰；不尝试匿名 JSON、RSS、镜像或 HTML scraping |
| 19 免费/低成本 | 请求/KV 很小，但 Free CPU 10ms 不能保证；正式采集要测实际 CPU，必要时用 Paid |
| 20 复杂度 | 增加的模块对应独立故障边界；没有新增常驻服务/队列/账号数据库 |

## 缓存设计中最重要的权衡

“保留近 30 天的帖子”与“把同一份未更新内容缓存 30 天”不是一回事。本次按创建时间展示近 30 天，按最后成功复核时间决定内容缓存寿命。官方对已删除内容有删除要求，并推荐较短的例行清理窗口；这里没有宣称一个无条件、所有场景统一的 48 小时法律期限。具体官方来源见 `OFFICIAL_SOURCES.md` 的 Reddit 部分。

为了不增加每帖 KV key 或数据库，只保留一个 snapshot。如果某个旧批次复核失败、另一个批次成功，整个 snapshot 使用仍保留内容的最早到期时间。这样可能较早丢掉部分较新的有效缓存，但不会因为无关成功就把未复核内容重新延长 48 小时。下次运行重新发现即可。这是有意选择的简单、保守方案。

KV 的读写不是线性一致：跨区域可能短暂读旧数据，冷却不是强锁，两个极少见重叠运行可能覆盖彼此新合并的来源标签。要彻底消除这一点，需要 DO 等串行化机制；对一个人的日更阅读列表收益有限，故没有引入。不能据此承诺绝对不重跑或绝不丢失并发增量。

## 结果质量与覆盖边界

不以 Reddit 分数设置硬门槛，避免新帖因低互动被排除。只对明确主题或有上下文的工具/优化/模板信号收录。标题匹配、关键词、社区、互动、时间都在可解释分值中展示。具体 GA4 可独立命中，模糊 GTM/attribution 需要上下文；中文短语支持自然句子内匹配。

这不是全量抓取。每 query 最多最新 100 条、全局 HTTP 上限 44 次，热门主题可能覆盖不到完整时间窗；过旧索引、搜索排序和平台自身限制也会造成漏帖。默认保守只接受 `subreddit_type=public`，不接受 restricted/unknown 类型，即使部分 restricted 社区可能公开可读；这是当前版本明确的召回限制。后续应根据真实返回和可用 API 范围决定是否扩展，而不是假定所有类型均可采集。

## 验证边界

Node 测试、Wrangler/workerd、真实 HTTPS 与原生浏览器的独立验证结果见 `../TEST_REPORT.md`。当前 Reddit API 未配置，未执行真实 Reddit 接口测试。空 Feed 的云端 CPU 采样不能代替完整刷新的性能验证，自然云端 Cron 也必须单独观察。

完整原始 Review 与运维证据留存在本机；公开版本保留技术结论，不包含本机路径、账号邮箱或 Secret。
