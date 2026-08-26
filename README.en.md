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

- 28 Cloudflare-hosted chat models with search, capability filters, favorites, context sizes, and price ordering
- Chinese and English interface, light appearance by default, and a persistent theme switch
- Genuine SSE streaming with stop, regenerate, copy, and edit-from-here actions
- Image input for vision models, plus PDF, Word, spreadsheet, HTML, XML, OpenDocument, and Numbers attachments
- Markdown, GitHub-flavored tables, syntax highlighting, code copying, and rendered reasoning
- Function Calling image generation with FLUX.2 Klein 9B, FLUX.2 Dev, Lucid Origin, and Phoenix 1.0
- Cloudflare Workflows and R2 for long-running image jobs that can recover after backgrounding or refresh
- Model-aware output token limits, plus per-conversation system prompts, temperature, and output controls
- Browser-local IndexedDB history, mobile refinements, message timestamps, and generation duration
- Optional Cloudflare OAuth so users can authorize their own accounts and use their own Workers AI quota
- Same-origin API checks, request validation, encrypted OAuth sessions, and per-minute rate limiting

## One-click deployment

Select **Deploy to Cloudflare** above, then sign in to Cloudflare and GitHub to create your own repository and Worker. Cloudflare reads the portable `wrangler.jsonc`, configures Workers AI, and provisions KV and R2 resources for the new deployment. The application is published to the deployer's own `workers.dev` address; it does not bind `ai.chatgpt.org.uk` or connect to this project's production resources.

By default, the deployed Worker consumes Workers AI quota from the **Cloudflare account that owns the Worker**. User-facing Cloudflare OAuth is not enabled automatically because every deployment needs its own OAuth client, callback domain, and session secret.

Cloudflare documentation: [Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/) · [Wrangler automatic provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

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

`wrangler.jsonc` is the portable public template. It enables `workers.dev` and lets Wrangler provision resources in the current account.

```bash
command -v wrangler
wrangler --version
npm view wrangler version
wrangler whoami
npm install
npm run check
wrangler deploy
```

To use a custom domain, copy [`wrangler.production.example.jsonc`](./wrangler.production.example.jsonc), fill in your own domain and resource identifiers, and save the real configuration as `.wrangler.production.jsonc`, which Git ignores. Confirm that the domain and resources belong to the active Cloudflare account before deploying.

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
└── /api/models · /api/chat · /api/images · /api/attachments
                    │
                    ▼
Cloudflare Worker
├── model allowlist, input validation, and genuine SSE forwarding
├── Workers AI binding / user-authorized Workers AI REST API
├── Function Calling and image-generation Workflow
├── encrypted OAuth KV · R2 image results · Rate Limiting
└── Workers Static Assets
```

## Notes

Llama Guard is excluded because it is a safety classifier rather than a chat model. Experimental and LoRA-capable chat models remain available and are labelled in the selector.

## License

This project is licensed under the [MIT License](./LICENSE).
