import { describe, expect, it, vi } from "vitest";
import worker from "./index";

const pixel = "data:image/png;base64,iVBORw0KGgo=";

const createEnv = () => {
  const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ response: "ok" }));
  return {
    run,
    env: {
      AI: { run, toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    },
  };
};

const requestFor = (model: string) =>
  new Request("https://ai.chatgpt.org.uk/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://ai.chatgpt.org.uk",
      "x-neurondeck-client": "integration-test-client",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "Describe it",
          attachments: [
            { kind: "image", name: "pixel.png", mimeType: "image/png", dataUrl: pixel },
          ],
        },
      ],
    }),
  });

const textRequestFor = (model: string, maxTokens?: number) =>
  new Request("https://ai.chatgpt.org.uk/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://ai.chatgpt.org.uk",
      "x-neurondeck-client": "integration-test-client",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Write a useful answer" }],
      ...(maxTokens == null ? {} : { maxTokens }),
    }),
  });

describe("worker multimodal requests", () => {
  it("passes structured image content to current vision models", async () => {
    const { env, run } = createEnv();
    const response = await worker.fetch(requestFor("@cf/qwen/qwen3.8-27b"), env as never);

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      "@cf/qwen/qwen3.8-27b",
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe it" },
              { type: "image_url", image_url: { url: pixel } },
            ],
          },
        ],
      }),
    );
  });

  it("decodes Llama 3.2 vision images for its legacy input schema", async () => {
    const { env, run } = createEnv();
    const response = await worker.fetch(
      requestFor("@cf/meta/llama-3.2-11b-vision-instruct"),
      env as never,
    );

    expect(response.status).toBe(200);
    const input = run.mock.calls[0][1] as { prompt: string; image: number[] };
    expect(input.image).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(input.prompt).toContain("USER: Describe it");
    expect(input).not.toHaveProperty("messages");
  });
});

describe("worker output token policy", () => {
  it("uses the context-aware default for a 128K model", async () => {
    const { env, run } = createEnv();
    await worker.fetch(textRequestFor("@cf/zai-org/glm-4.7-flash"), env as never);
    expect(run.mock.calls[0][1]).toEqual(expect.objectContaining({ max_tokens: 8_192 }));
  });

  it("allows a larger bounded output for a 1M model", async () => {
    const { env, run } = createEnv();
    await worker.fetch(textRequestFor("@cf/deepseek-ai/deepseek-v4-pro-0813", 999_999), env as never);
    expect(run.mock.calls[0][1]).toEqual(expect.objectContaining({ max_tokens: 65_536 }));
  });
});
