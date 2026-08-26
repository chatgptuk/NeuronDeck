# NeuronDeck

NeuronDeck is a local-first chat workspace for every current Cloudflare-hosted Text Generation model that supports conversation. It combines a searchable model catalog, streaming chat, per-conversation controls, Markdown rendering, local IndexedDB persistence, and a responsive interface in one Cloudflare Worker.

Production: [ai.chatgpt.org.uk](https://ai.chatgpt.org.uk)

## What is included

- 28 Cloudflare-hosted chat models from the live Workers AI catalog
- Search, capability filters, favorites, context sizes, and per-token pricing
- Streaming generation with stop, regenerate, copy, and edit-from-here actions
- Per-conversation system prompt, temperature, and maximum output tokens
- Markdown, GitHub-flavored tables, syntax highlighting, and code copying
- Browser-local conversation history stored in IndexedDB
- Same-origin API enforcement, request validation, and a 10 requests/minute rate limit
- One Worker deployment with Workers Static Assets and a Workers AI binding

The Cloudflare Llama Guard safety classifier is intentionally excluded because it is a classifier rather than a chat model. Experimental and LoRA-capable chat models remain available and are labelled in the selector.

## Requirements

- Node.js
- npm
- A system-global Wrangler installation
- A Cloudflare account with Workers AI access

This repository deliberately does not install Wrangler locally. All Cloudflare commands must resolve to the system-global binary, normally `/opt/homebrew/bin/wrangler` on macOS.

## Install and validate

```bash
npm install
npm run check
```

For a production-like local run:

```bash
npm run build
wrangler dev --port 8787
```

For Vite HMR, keep the Worker running on port 8787 and run `npm run dev` in a second terminal. Vite proxies `/api` requests to the Worker.

## Refresh the model catalog

The committed catalog is a deployment snapshot so the application never needs to expose a Cloudflare API token at runtime. Refresh it before a release with:

```bash
node scripts/sync-models.mjs
```

The sync script refuses to use a Wrangler binary inside `node_modules`, queries the live `Text Generation` catalog, removes safety classifiers, and preserves curated display names and descriptions where possible.

## Deploy

Verify the global Wrangler version and account, then build and deploy directly:

```bash
command -v wrangler
wrangler --version
npm view wrangler version
wrangler whoami
npm run build
wrangler deploy
```

The Worker configuration binds the custom domain `ai.chatgpt.org.uk`, disables the `workers.dev` route, and sends only `/api/*` traffic through the Worker before static asset handling.

## Architecture

```text
Browser
├── React + Vite UI
├── IndexedDB conversations
└── /api/models + /api/chat
          │
          ▼
Cloudflare Worker
├── model allowlist + validation
├── Rate Limiting binding
├── Workers AI binding
└── Workers Static Assets
```
