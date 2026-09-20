# Official references

Documentation checked on 2026-09-20. Platform documentation and the account's actual permissions take precedence over examples in this repository.

| Source | Topic |
| --- | --- |
| [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) | OAuth, User-Agent, rate headers and deletion handling. |
| [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) | Permitted data access and application use. |
| [Data API Terms](https://redditinc.com/policies/data-api-terms) | API use and data obligations. |
| [OAuth2 technical guide](https://github.com/reddit-archive/reddit/wiki/OAuth2) | Grant and token-flow examples linked by the API Wiki. |
| [Reddit API reference](https://www.reddit.com/dev/api) | Search, listings and info endpoint reference. |
| [Wrangler KV commands](https://developers.cloudflare.com/workers/wrangler/commands/kv/) | Namespace creation and configuration updates. |
| [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) | Runtime credentials separate from source code. |
| [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | UTC schedules and local scheduled-handler testing. |
| [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/) | Eventually consistent storage and concurrency limits. |
| [KV limits](https://developers.cloudflare.com/kv/platform/limits/) | TTL and write constraints. |
| [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | CPU, wall time and execution limits. |
| [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Current plan-dependent usage and cost. |

The 44-attempt request cap, 90-second client deadline, eight-second timeout, 400 default records, 600-character excerpts, 15-minute cooldown and relevance score are implementation choices. They do not imply exhaustive coverage, strong distributed locking, instantaneous deletion propagation or guaranteed operating cost.
