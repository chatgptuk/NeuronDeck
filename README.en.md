<p align="right">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<div align="center">
  <img src="./public/favicon.svg" width="72" height="72" alt="NeuronDeck" />
  <h1>NeuronDeck</h1>
  <p>A calm, focused multi-model chat workspace powered by Cloudflare Workers AI.</p>

  <p>
    <a href="https://ai.chatgpt.org.uk">Live demo</a>
    ·
    <a href="https://github.com/chatgptuk/NeuronDeck/issues">Report an issue</a>
  </p>

  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/chatgptuk/NeuronDeck">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" />
  </a>
</div>

## What is NeuronDeck?

NeuronDeck brings Cloudflare-hosted chat models, multimodal input, image generation, and genuine streaming into a single Worker. Conversations remain in the browser by default. A deployment uses Workers AI quota from its owning Cloudflare account, while optional Cloudflare OAuth lets each user authorize and consume quota from their own account.

## Highlights

- 29 Cloudflare-hosted chat models with search, capability filters, favorites, context sizes, and price ordering
- Chinese and English interface, light appearance by default, and a persistent theme switch
- Genuine SSE streaming with temporary Durable Object event persistence and cursor-based resume after refresh, backgrounding, or a dropped connection
- Image input for vision models, plus PDF, Word, spreadsheet, HTML, XML, OpenDocument, and Numbers attachments
- Markdown, GitHub-flavored tables, syntax highlighting, code copying, and rendered reasoning
- Function Calling image generation with FLUX.2 Klein 9B, FLUX.2 Dev, Lucid Origin, and Phoenix 1.0
- Real edits, variations, and up to four reference images from previous generations; reference operations automatically use FLUX.2 Dev
- On-demand assistant read-aloud with natural quality by default: Aura-2 for English/Spanish and device voices for Chinese and other languages
- Adaptive image delivery: direct browser responses by default, optional Workflows and R2 for recovery, with automatic fallback when persistence is unavailable
- Model-aware output token limits, plus per-conversation system prompts, temperature, and output controls
- Browser-local IndexedDB history, mobile refinements, message timestamps, and generation duration
- Optional public quota pool with stable distribution and automatic failover across administrator-provided Cloudflare accounts
- Optional Cloudflare OAuth so users can authorize their own accounts and use their own Workers AI quota
- Same-origin API checks, request validation, encrypted OAuth sessions, and per-minute rate limiting

## One-click deployment

Select **Deploy to Cloudflare** above, then sign in to Cloudflare and GitHub to create your own repository and Worker. Cloudflare reads the portable `wrangler.jsonc` and configures Workers AI, Durable Objects, and KV for the new deployment. The application is published to the deployer's own `workers.dev` address; it does not bind `ai.chatgpt.org.uk` or connect to this project's production resources.

The default deployment **does not require an R2 subscription**. Chat and image generation continue inside an independent Durable Object session, and the browser can recover missed events by cursor after a refresh, backgrounding, or a temporary network loss. Active generation events are retained for up to 24 hours; long-term conversation history still stays in the browser. With optional R2 and Workflows, FLUX.2 Dev uses a more durable channel for slow jobs and automatically falls back to direct session delivery if persistence is unavailable.

By default, the deployed Worker consumes Workers AI quota from the **Cloudflare account that owns the Worker**. User-facing Cloudflare OAuth is not enabled automatically because every deployment needs its own OAuth client, callback domain, and session secret.

Cloudflare documentation: [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [Wrangler automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

### Optional: enable Workflow/R2 background image jobs

To add independent Workflow retries and R2 result persistence for slow FLUX.2 Dev jobs, enable R2 in your Cloudflare account and add both bindings below. Ordinary refresh, background, and temporary-disconnect recovery is already handled by the default Durable Object session and does not require R2. See [`wrangler.production.example.jsonc`](./wrangler.production.example.jsonc) for a complete example:

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

Both bindings must be present. Once enabled, FLUX.2 Dev runs as a Workflow and stores its result temporarily in R2, while faster image models continue to return directly. If an R2 write fails, NeuronDeck stops pointless Workflow retries, generates the image once more, and returns it directly to the browser.

Cloudflare documentation: [Enable R2](https://developers.cloudflare.com/r2/get-started/) · [Workflows configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#workflows)

### Optional: configure a public site quota pool

An administrator can provide up to 16 Cloudflare accounts for anonymous visitors. Chat, file conversion, Function Calling, speech synthesis, and background image jobs all use the same pool. A browser is assigned a stable starting entry, and the Worker automatically fails over when an account returns an authorization, quota, capacity, or server error. A user who connects their own Cloudflare account always uses their own quota first.

1. In each Cloudflare account, open Workers AI and select **Use REST API → Create a Workers AI API Token**. For a custom token, grant only `Workers AI Read` and `Workers AI Edit` on that account. Never use a Global API Key.

2. Store the following JSON as a Worker Secret named `PUBLIC_AI_ACCOUNTS`. Never put real tokens in Wrangler configuration, `.env`, README, or Git:

   ```json
   {
     "accounts": [
       {
         "accountId": "32-character Cloudflare Account ID",
         "apiToken": "Cloudflare Workers AI API Token"
       },
       {
         "accountId": "another Account ID",
         "apiToken": "another API Token"
       }
     ]
   }
   ```

3. Use Wrangler's hidden prompt to store the Secret safely:

   ```bash
   wrangler secret put PUBLIC_AI_ACCOUNTS --config .wrangler.production.jsonc
   ```

   Use `wrangler.jsonc` instead when deploying the public template. Deleting this Secret disables the pool and returns anonymous traffic to the owning account's AI binding.

The pool has an additional limit of 60 requests per minute in each Cloudflare location. Each visitor is limited to 10 chat requests and 6 speech-synthesis requests per minute. An invalid Secret fails closed instead of silently charging the Worker owner's account. Cloudflare limits an individual Secret/environment variable to 5 KB.

Cloudflare documentation: [Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) · [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Worker environment variable limits](https://developers.cloudflare.com/workers/platform/limits/#environment-variables)

### Optional: enable Cloudflare account sign-in

1. Create a Cloudflare OAuth application and configure this callback URL:

   ```text
   https://your-domain.example/api/auth/cloudflare/callback
   ```

2. Add `CLOUDFLARE_OAUTH_CLIENT_ID` to your own Wrangler configuration:

   ```jsonc
   "vars": {
     "CLOUDFLARE_OAUTH_CLIENT_ID": "your OAuth Client ID",
     "CLOUDFLARE_OAUTH_SCOPES": "ai.read account-settings.read offline_access"
   }
   ```

3. Generate a 32-byte session key and store it as a Worker Secret:

   ```bash
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | wrangler secret put OAUTH_SESSION_SECRET
   ```

4. Deploy again. OAuth tokens are AES-GCM encrypted before being stored in the `AUTH_SESSIONS` KV namespace and are never sent to the browser.

> `CLOUDFLARE_OAUTH_CLIENT_ID` is not a password. `OAUTH_SESSION_SECRET` must remain in Cloudflare Secrets and must never be committed to Git.

## Local development

### Requirements

- Node.js
- npm
- A system-global Wrangler installation
- A Cloudflare account with Workers AI enabled

This repository deliberately does not install Wrangler locally. All Cloudflare commands should resolve to the system-global binary, normally `/opt/homebrew/bin/wrangler` on macOS.

```bash
npm install
npm run check
```

Start the local Worker API and built frontend:

```bash
npm run build
wrangler dev --port 8787
```

For Vite HMR, keep the Worker on port `8787` and run `npm run dev` in a second terminal. Vite proxies `/api` requests to the Worker.

## Manual deployment

`wrangler.jsonc` is the portable public template without a mandatory R2 dependency. It enables `workers.dev` and lets Wrangler configure Workers AI, Durable Objects, and KV in the current account. Add R2 and Workflows only when the additional background image-job channel is needed.

```bash
command -v wrangler
wrangler --version
npm view wrangler version
wrangler whoami
npm install
npm run check
wrangler deploy
```

To use a custom domain, copy [`wrangler.production.example.jsonc`](./wrangler.production.example.jsonc), fill in your own domain and resource identifiers, and save the real configuration as `.wrangler.production.jsonc`, which Git ignores. The production example keeps the `workers.dev` address enabled alongside the custom domain; set `workers_dev` to `false` if you only want the custom domain. Confirm that the domain and resources belong to the active Cloudflare account before deploying.

## Refresh the model catalog

The committed catalog is a deployment snapshot, so the application never needs to expose a Cloudflare API token at runtime. Refresh it before a release with:

```bash
node scripts/sync-models.mjs
```

The sync script only permits a system-global Wrangler binary. It reads the current Workers AI text generation catalog, removes safety classifiers, and preserves curated names and bilingual descriptions where possible.

## Architecture

```text
Browser
├── React + Vite interface
├── IndexedDB conversations and settings
└── /api/models · /api/chat · /api/images · /api/tts · /api/attachments
                    │
                    ▼
Cloudflare Worker
├── model allowlist, input validation, and genuine SSE forwarding
├── Workers AI binding / public credential pool / user-authorized REST API
├── Function Calling, on-demand speech synthesis, and adaptive image delivery
├── Durable Object stream resume · encrypted OAuth KV · optional Workflow/R2 image results
└── Workers Static Assets
```

## Notes

Llama Guard is excluded because it is a safety classifier rather than a chat model. Experimental and LoRA-capable chat models remain available and are labelled in the selector.

## License

This project is licensed under the [MIT License](./LICENSE).
