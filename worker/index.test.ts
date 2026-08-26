import { describe, expect, it, vi } from "vitest";
import worker from "./index";

const pixel = "data:image/png;base64,iVBORw0KGgo=";
const chatModel = "@cf/zai-org/glm-4.7-flash";
const imageModel = "@cf/black-forest-labs/flux-2-klein-9b";

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
        messages: expect.arrayContaining([
          {
            role: "user",
            content: [
              { type: "text", text: "Describe it" },
              { type: "image_url", image_url: { url: pixel } },
            ],
          },
        ]),
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

describe("image generation function calling", () => {
  it("lets a tool-capable chat model invoke the selected image model", async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        if (model === imageModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        if (input.tools) {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "call_image_1",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({
                      prompt: "A quiet glass greenhouse at dawn",
                      aspect_ratio: "landscape",
                    }),
                  },
                }],
              },
              finish_reason: "tool_calls",
            }],
          };
        }
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"已经为你生成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [{ role: "user", content: "给我设计一张安静的温室插画" }],
        temperature: 0.7,
        maxTokens: 4096,
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(calls.map((call) => call.model)).toEqual([chatModel, imageModel, chatModel]);
    expect(calls[0].input.tools).toBeTruthy();
    expect(JSON.stringify(calls[0].input.tools)).toContain("semantic intent");
    expect(calls[1].input).toHaveProperty("multipart");
    expect(body).toContain('"status":"generating"');
    expect(body).toContain('"modelId":"@cf/black-forest-labs/flux-2-klein-9b"');
    expect(body).toContain('"dataUrl":"data:image/png;base64,iVBOR');
    expect(body).toMatch(/"elapsedMs":\d+/);
    expect(body).toContain("已经为你生成。");
  });

  it("rejects image model ids outside the curated Cloudflare-hosted list", async () => {
    const env = {
      AI: { run: vi.fn(), toMarkdown: vi.fn() },
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: chatModel,
        imageModel: "@cf/unknown/image-model",
        messages: [{ role: "user", content: "生成一张图" }],
      }),
    });

    const response = await worker.fetch(request, env as never);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_image_model" } });
  });

  it("forces a corrective tool call when the model falsely claims an image was generated", async () => {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const ai = {
      run: vi.fn(async (model: string, input: Record<string, unknown>) => {
        calls.push({ model, input });
        if (model === imageModel) return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };
        if (input.tool_choice === "auto") {
          return { choices: [{ message: { role: "assistant", content: "已为您生成了一张新的街拍照片。" } }] };
        }
        if (input.tool_choice === "required") {
          return {
            choices: [{
              message: {
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: "corrective-image-call",
                  type: "function",
                  function: {
                    name: "generate_image",
                    arguments: JSON.stringify({
                      prompt: "A new candid street portrait in warm autumn light",
                      aspect_ratio: "portrait",
                    }),
                  },
                }],
              },
            }],
          };
        }
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"response":"这次已真正生成。"}\n\ndata: [DONE]\n\n'));
            controller.close();
          },
        });
      }),
      toMarkdown: vi.fn(),
    };
    const env = {
      AI: ai,
      ASSETS: { fetch: vi.fn() },
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    const request = new Request("https://ai.chatgpt.org.uk/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "zh-CN",
        "x-neurondeck-client": "test-client-1234",
      },
      body: JSON.stringify({
        model: chatModel,
        imageModel,
        messages: [
          { role: "user", content: "画一张秋日街拍" },
          { role: "assistant", content: "上一张已经完成。" },
          { role: "user", content: "再来一张" },
        ],
      }),
    });

    const response = await worker.fetch(request, env as never);
    const body = await response.text();

    expect(calls.map((call) => call.model)).toEqual([chatModel, chatModel, imageModel, chatModel]);
    expect(calls[1].input.tool_choice).toBe("required");
    expect(JSON.stringify(calls[1].input.messages)).toContain("referenced prior image context");
    expect(body).toContain('"status":"generating"');
    expect(body).toContain('"generated_image"');
    expect(body).toMatch(/"elapsedMs":\d+/);
    expect(body).not.toContain("已为您生成了一张新的街拍照片");
  });
});
