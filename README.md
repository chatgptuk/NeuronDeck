<p align="right">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

<div align="center">
  <img src="./public/favicon.svg" width="72" height="72" alt="NeuronDeck" />
  <h1>NeuronDeck</h1>
  <p>一个清新、专注、由 Cloudflare Workers AI 驱动的多模型聊天工作台。</p>

  <p>
    <a href="https://ai.chatgpt.org.uk">在线体验</a>
    ·
    <a href="https://github.com/chatgptuk/NeuronDeck/issues">反馈问题</a>
  </p>

  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/chatgptuk/NeuronDeck">
    <img src="https://deploy.workers.cloudflare.com/button" alt="一键部署到 Cloudflare" />
  </a>
</div>

## 这是什么

NeuronDeck 把 Cloudflare 托管的对话模型、多模态输入、图片生成与真实流式输出整合在同一个 Worker 中。对话保存在浏览器本地；默认部署直接使用部署者账户中的 Workers AI 额度，也可以进一步配置 Cloudflare OAuth，让每位用户授权并使用自己的账户额度。

## 主要功能

- 29 个 Cloudflare 托管的对话模型，默认并置顶 GLM 5.3 Flash，支持搜索、能力筛选、收藏、上下文大小与价格排序
- 中文与英文界面，默认浅色外观，并可持久化切换主题
- 真正的 SSE 流式生成；生成事件由 Durable Object 临时保存，刷新、切后台或短暂断网后可从游标续传
- 视觉模型支持图片输入；支持 PDF、Word、表格、HTML、XML、OpenDocument 与 Numbers 等附件
- Markdown、GitHub 风格表格、代码高亮、代码复制与推理过程渲染
- 通过 Function Calling 调用 FLUX.2 Klein 9B、FLUX.2 Dev、Lucid Origin 与 Phoenix 1.0 生图
- 支持基于上一张真实图片进行编辑、变体与最多四图参考；参考图任务自动使用 FLUX.2 Dev
- AI 消息可按需朗读：默认自然音质优先，英语/西班牙语使用 Aura-2，中文与其他语言使用设备系统声线
- 生图自动选择返回通道：默认直接返回浏览器；配置 R2 与 Workflows 后可承接耗时任务，并在持久化不可用时自动回退
- 根据模型能力设置合理的最大输出 Token，并提供对话级系统提示词、温度与输出上限
- IndexedDB 本地对话历史、移动端优化、消息时间与生成耗时
- 可选站点公共额度池：管理员可安全接入多个 Cloudflare 账户，自动分流并在额度故障时切换
- 可选 Cloudflare OAuth：用户可授权自己的账户并使用自己的 Workers AI 额度
- 多轮 Function Calling：单次回复可连续调用多个工具、获得最多 10 张成功图片；临时生图失败共享 3 次自动补偿机会，并通过 Browser Run 搜索、读取和截取公开网页
- 可选研究模式：自动检索并打开多个独立来源，正文使用稳定的 `[1] [2]` 行内引用，来源卡片显示标题、域名和访问时间，并可一键导出带引用的 PDF 报告
- AI 文件工具：模型可在对话中真正创建并发送 TXT、Markdown、PDF、CSV 与 JSON 下载文件；PDF 使用安全的 Markdown 到 HTML 渲染链路
- 服务端为每次请求注入可信当前时间与浏览器时区；无需联网即可正确判断今天、过去与未来日期
- 可选“模型健康与成本中心”：按模型统计成功率、首字耗时、总耗时、Token、工具调用和估算聊天成本，并保留匿名访问趋势
- PWA 安装与生成完成提醒：可添加到主屏幕/作为独立应用运行，页面在后台时由 Service Worker 提醒聊天或生图已经完成
- 同源 API 校验、请求验证、加密 OAuth 会话与每分钟请求限制

## 一键部署

点击上方的 **Deploy to Cloudflare** 按钮，登录 Cloudflare 和 GitHub 后即可创建一份属于你的仓库与 Worker。Cloudflare 会读取根目录的 `wrangler.jsonc`，为新部署配置 Workers AI、Durable Objects 与 KV；应用默认发布到部署者自己的 `workers.dev` 地址，不会绑定 `ai.chatgpt.org.uk`，也不会连接本项目的生产资源。

默认部署**不要求开通 R2**。聊天、生图与文件工具在独立的 Durable Object 会话中继续执行，浏览器刷新、切到后台或短暂断网后会按事件游标补回遗漏内容。Durable Object 只临时保存流式事件、恢复游标和会话状态，创建 24 小时后由 Alarm 执行 `deleteAll()`；长期对话历史仍只保存在浏览器。若额外配置 R2 与 Workflows，FLUX.2 Dev 会使用更适合耗时任务的持久化通道，生成文件也会获得临时下载地址；R2 未配置或写入失败时会自动退化为会话内直接返回。

一键部署后的默认模式会使用 **Worker 所属 Cloudflare 账户** 的 Workers AI 额度。Cloudflare OAuth 用户登录不会自动启用，因为每个部署都必须拥有自己的 OAuth 客户端、回调域名与会话密钥。

Cloudflare 文档：[Deploy to Cloudflare 按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [Wrangler 自动配置资源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

### 可选：启用 Workflow/R2 后台生图

需要为耗时的 FLUX.2 Dev 任务增加独立 Workflow 重试和 R2 结果暂存时，先在 Cloudflare 账户启用 R2，再在自己的 Wrangler 配置中加入以下绑定。普通的刷新、切后台和短暂断线续传由默认 Durable Object 会话处理，不要求 R2。完整示例见 [`wrangler.production.example.jsonc`](./wrangler.production.example.jsonc)：

```jsonc
"r2_buckets": [
  {
    "binding": "IMAGE_RESULTS",
    "bucket_name": "your-image-results-bucket"
  }
],
"workflows": [
  {
    "binding": "IMAGE_WORKFLOW",
    "name": "your-neurondeck-image-generation",
    "class_name": "ImageGenerationWorkflow"
  }
]
```

两项绑定必须同时存在。启用后，程序优先把 FLUX.2 Dev 作为 Workflow 执行并将结果暂存到 R2；其他较快的生图模型仍直接返回。R2 中的最终图片、临时参考图和 AI 生成文件统一保留 24 小时；Worker 每 6 小时扫描一次并删除过期对象，下载时也会即时拒绝并删除过期结果。这个清理任务同样会处理升级前没有过期元数据的旧图片。R2 写入异常时会停止无意义的 Workflow 重试，并自动回退为直接返回浏览器。

Cloudflare 文档：[启用 R2](https://developers.cloudflare.com/r2/get-started/) · [Workflows 配置](https://developers.cloudflare.com/workers/wrangler/configuration/#workflows)

### 可选：配置站点公共额度池

管理员可以提供最多 16 个 Cloudflare 账户供匿名访客公开使用。聊天、文件转换、Function Calling、语音合成与后台生图都会使用同一额度池；相同浏览器会稳定分配到同一入口，遇到鉴权、额度、容量或服务端错误时自动切换到下一账户。用户连接自己的 Cloudflare 账户后，Workers AI 请求优先使用用户自己的额度；Browser Run 搜索、网页读取与截图始终使用这个站点公共池，不会消耗 Worker 部署账户的 Browser Run 额度。

1. 在每个 Cloudflare 账户的 Workers AI 页面选择 **Use REST API → Create a Workers AI API Token**。如需自定义 Token，请授予该账户的 `Workers AI Read`、`Workers AI Edit`，并为搜索、网页读取、截图与 PDF 文件增加账户级 `Browser Rendering Edit` 权限；不要使用 Global API Key。若不增加 Browser 权限，聊天和普通文本文件仍可使用，但联网工具与 PDF 渲染会返回权限提示。

2. 将以下 JSON 填入名为 `PUBLIC_AI_ACCOUNTS` 的 Worker Secret。真实 Token 不要写入 Wrangler 配置、`.env`、README 或 Git：

   ```json
   {
     "accounts": [
       {
         "accountId": "32 位 Cloudflare Account ID",
         "apiToken": "Cloudflare Workers AI API Token"
       },
       {
         "accountId": "另一个 Account ID",
         "apiToken": "另一个 API Token"
       }
     ]
   }
   ```

3. 使用 Wrangler 的隐藏输入安全写入 Secret：

   ```bash
   wrangler secret put PUBLIC_AI_ACCOUNTS --config .wrangler.production.jsonc
   ```

   使用公开模板时，将配置路径换成 `wrangler.jsonc`。删除这个 Secret 即可停用额度池并恢复使用 Worker 所属账户的 AI Binding。

公共池在每个 Cloudflare 边缘位置额外受每分钟 60 次的池级限流保护；每位访客的聊天请求限制为每分钟 10 次，生图尝试限制为每分钟 15 次，语音合成限制为每分钟 6 次。单轮最多返回 10 张成功图片，并额外保留 3 次可恢复失败的自动补偿尝试；无效参数、引用图缺失和内容策略拒绝不会盲目重试。Secret 格式不合法时服务会拒绝匿名 AI 请求，不会静默消耗主站账户额度。Cloudflare 对单个 Secret/环境变量限制为 5 KB。

Browser Run 使用无状态 Quick Actions：页面读取、截图与 PDF 渲染都有 45 秒硬超时，请求完成或中断后不保留浏览器会话、Cookie 或后台标签页。截图会作为真实图片显示并可下载，但不会继承用户本地浏览器的登录状态。普通对话每轮最多执行 4 次 Browser Run 操作；用户显式开启研究模式后提高至 8 次，以便完成多来源检索与核实。研究报告 PDF 由同一公共额度池即时渲染并直接返回浏览器，不会创建持久浏览器会话。

Cloudflare 文档：[Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) · [Browser Run Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/) · [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Worker 环境变量限制](https://developers.cloudflare.com/workers/platform/limits/#environment-variables)

### 可选：启用 Cloudflare 账户登录

1. 在 Cloudflare 创建 OAuth 应用，并将回调地址设为：

   ```text
   https://你的域名/api/auth/cloudflare/callback
   ```

2. 在自己的 Wrangler 配置中增加 `CLOUDFLARE_OAUTH_CLIENT_ID`：

   ```jsonc
   "vars": {
     "CLOUDFLARE_OAUTH_CLIENT_ID": "你的 OAuth Client ID",
     "CLOUDFLARE_OAUTH_SCOPES": "ai.read account-settings.read offline_access"
   }
   ```

3. 生成一个 32 字节的会话密钥，并以 Worker Secret 保存：

   ```bash
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | wrangler secret put OAUTH_SESSION_SECRET
   ```

4. 重新部署。OAuth Token 会使用 AES-GCM 加密后存入 `AUTH_SESSIONS` KV，不会发送到浏览器。

> `CLOUDFLARE_OAUTH_CLIENT_ID` 不是密码；`OAUTH_SESSION_SECRET` 必须只保存在 Cloudflare Secret 中，不能提交到 Git。

### 可选：启用私有管理后台

后台位于 `/admin`，复用上面的 Cloudflare OAuth 登录。只有 `ADMIN_ACCOUNT_ID` Secret 中列出的 Cloudflare Account ID 才能读取统计；普通用户即使连接自己的 Cloudflare 账户也无法访问。

管理员登录只用于后台鉴权：管理员返回前台后，聊天、生图、语音与文件处理仍使用本站公共额度。其他用户连接 Cloudflare 后继续使用其所选账户的 Workers AI 额度。

```bash
wrangler secret put ADMIN_ACCOUNT_ID --config .wrangler.production.jsonc
```

使用公开模板时将配置路径换成 `wrangler.jsonc`。输入部署者的 32 位 Cloudflare Account ID 后重新部署，再使用该账户连接 Cloudflare 并打开 `https://你的域名/admin`。多个管理员账户可用英文逗号分隔。

统计从启用后台后开始累计，不能还原此前的访问量。“用户”按浏览器生成的随机标识去重；服务端只保存其 SHA-256 哈希和聚合事件数量，不记录消息内容、IP、文件名、生成图片或 Cloudflare Token。模型健康指标同样只保存按天聚合的请求结果、延迟、Token 和工具调用计数。成本按模型目录中的公开 Token 单价估算，图片、语音及 Cloudflare 最终账单仍以 Cloudflare 控制台为准。公开 Wrangler 配置已包含 `METRICS_DB` D1 绑定，部署时会自动创建数据库，表结构由 Worker 首次使用时初始化。

## 本地开发

### 环境要求

- Node.js
- npm
- 系统全局安装的 Wrangler
- 已启用 Workers AI 的 Cloudflare 账户

本仓库不会安装项目级 Wrangler。所有 Cloudflare 命令都应解析到系统全局二进制文件；macOS 上通常为 `/opt/homebrew/bin/wrangler`。

```bash
npm install
npm run check
```

启动包含 Worker API 的本地环境：

```bash
npm run build
wrangler dev --port 8787
```

如需 Vite HMR，请保持 Worker 运行在 `8787` 端口，再在第二个终端执行 `npm run dev`。Vite 会把 `/api` 请求代理到 Worker。

## 手动部署

`wrangler.jsonc` 是不强制依赖 R2 的可移植公开模板：它启用 `workers.dev`，并让 Wrangler 为当前账户配置 Workers AI、Durable Objects、D1 与 KV。需要 Workflow/R2 后台生图时，再按上文增加相应绑定。

```bash
command -v wrangler
wrangler --version
npm view wrangler version
wrangler whoami
npm install
npm run check
wrangler deploy
```

如需自定义域名，请复制 [`wrangler.production.example.jsonc`](./wrangler.production.example.jsonc)，填写你自己的域名与资源标识，并将真实配置保存为已被 Git 忽略的 `.wrangler.production.jsonc`。生产示例默认同时保留 `workers.dev` 地址；如果只希望使用自定义域名，可将 `workers_dev` 改为 `false`。部署前请确认域名和资源都属于当前 Cloudflare 账户。

## 更新模型目录

仓库中的模型目录是一份部署快照，因此运行时无需暴露 Cloudflare API Token。发布前可通过以下命令刷新：

```bash
node scripts/sync-models.mjs
```

同步脚本只允许调用系统全局 Wrangler，并会读取当前 Workers AI 文本生成目录、移除安全分类器，同时尽量保留人工整理的名称与中英文描述。

## 架构

```text
浏览器
├── React + Vite 界面
├── IndexedDB 对话与设置
└── /api/models · /api/chat · /api/tts · /api/attachments · /api/admin
                    │
                    ▼
Cloudflare Worker
├── 模型白名单、输入校验与真正的 SSE 转发
├── Workers AI Binding / 公共凭证池 / 用户授权后的 REST API
├── Function Calling、按需语音合成与自动退化的图片返回
├── Durable Object 流式续传 · D1 匿名站点统计 · KV 加密 OAuth 会话
├── 可选 Workflow/R2 图片结果
└── Workers Static Assets
```

## 说明

Llama Guard 是安全分类器而不是对话模型，因此未列入聊天模型目录。实验模型与支持 LoRA 的对话模型会保留，并在选择器中标明能力。

## 许可证

本项目采用 [MIT License](./LICENSE)。
