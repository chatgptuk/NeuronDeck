import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const outputPath = resolve("src/data/models.generated.json");
const previous = JSON.parse(readFileSync(outputPath, "utf8"));
const previousById = new Map(previous.models.map((model) => [model.id, model]));

const which = spawnSync("/usr/bin/which", ["wrangler"], { encoding: "utf8" });
const wranglerPath = which.stdout.trim();

if (!wranglerPath || wranglerPath.includes("node_modules")) {
  throw new Error("A system-global Wrangler is required; a project-local Wrangler will not be used.");
}

const result = spawnSync(
  wranglerPath,
  ["ai", "models", "list", "--json", "--task", "Text Generation"],
  {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_LOG_PATH: "/tmp/neurondeck-model-sync.log" },
    maxBuffer: 10 * 1024 * 1024,
  },
);

if (result.status !== 0) {
  throw new Error(result.stderr || "Cloudflare model catalog sync failed.");
}

const unsafeTags = new Set(["moderation", "safety", "content-filtering", "guardrails"]);
const providerNames = {
  "aisingapore": "AI Singapore",
  "deepseek-ai": "DeepSeek",
  "google": "Google",
  "ibm-granite": "IBM",
  "meta": "Meta",
  "meta-llama": "Meta",
  "mistral": "Mistral AI",
  "mistralai": "Mistral AI",
  "moonshotai": "Moonshot AI",
  "nvidia": "NVIDIA",
  "openai": "OpenAI",
  "qwen": "Qwen",
  "zai-org": "Z.ai",
};

const titleize = (id) =>
  id
    .split("/")
    .at(-1)
    .split("-")
    .map((part) => (/^\d/.test(part) || part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join(" ");

const models = JSON.parse(result.stdout)
  .filter((model) => model.name.startsWith("@cf/"))
  .filter((model) => !(model.tags || []).some((tag) => unsafeTags.has(tag)))
  .map((model) => {
    const properties = Object.fromEntries(
      (model.properties || []).map((property) => [property.property_id, property.value]),
    );
    const old = previousById.get(model.name);
    const prices = {};
    for (const item of properties.price || []) {
      if (item.unit.includes("cached input")) prices.cachedInput = item.price;
      else if (item.unit.includes("input")) prices.input = item.price;
      else if (item.unit.includes("output")) prices.output = item.price;
    }

    const capabilities = [];
    if (properties.reasoning === "true") capabilities.push("reasoning");
    if (properties.function_calling === "true") capabilities.push("tools");
    if (properties.vision === "true") capabilities.push("vision");
    if (/code|coder/i.test(model.name)) capabilities.push("coding");

    const providerSlug = model.name.split("/")[1];
    return {
      id: model.name,
      name: old?.name || titleize(model.name),
      provider: providerNames[providerSlug] || providerSlug,
      description: old?.description || model.description,
      contextWindow: Number(properties.context_window || 0),
      capabilities,
      paid: properties.require_workers_paid === "true",
      lora: properties.lora === "true",
      ...(properties.beta === "true" ? { experimental: true } : {}),
      prices,
    };
  });

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      syncedAt: new Date().toISOString(),
      source: "Cloudflare Workers AI model catalog — Text Generation, excluding safety classifiers",
      models,
    },
    null,
    2,
  )}\n`,
);

console.log(`Synced ${models.length} Cloudflare-hosted chat models with ${wranglerPath}.`);
