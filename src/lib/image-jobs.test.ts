import { describe, expect, it, vi } from "vitest";
import { waitForImageJob } from "./image-jobs";

describe("durable image job polling", () => {
  it("keeps polling until the server returns the generated image", async () => {
    const image = {
      id: "job-1",
      dataUrl: "/api/image-jobs/job-1/image.png?token=abc",
      modelId: "flux-dev",
      modelName: "FLUX.2 Dev",
      prompt: "A quiet forest",
      width: 1024,
      height: 1024,
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "running" }))
      .mockResolvedValueOnce(Response.json({ status: "complete", image }));

    await expect(waitForImageJob({
      jobId: "job-1",
      clientId: "test-client",
      signal: new AbortController().signal,
      language: "en",
      fetcher,
      pollIntervalMs: 1,
      maxWaitMs: 1_000,
    })).resolves.toEqual(image);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("surfaces a durable job failure", async () => {
    const fetcher = vi.fn(async () => Response.json({ status: "error", error: { message: "Model failed" } }));
    await expect(waitForImageJob({
      jobId: "job-2",
      clientId: "test-client",
      signal: new AbortController().signal,
      language: "en",
      fetcher,
      pollIntervalMs: 1,
      maxWaitMs: 1_000,
    })).rejects.toThrow("Model failed");
  });
});
