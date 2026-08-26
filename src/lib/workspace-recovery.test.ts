import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types";
import { recoverInterruptedMessage } from "./workspace-recovery";

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "assistant-1",
  role: "assistant",
  content: "partial answer",
  createdAt: "2026-08-26T12:00:00.000Z",
  status: "streaming",
  ...overrides,
});

describe("workspace recovery", () => {
  it("marks an ordinary persisted stream as interrupted while preserving partial text", () => {
    const recovered = recoverInterruptedMessage(message(), "Generation was interrupted.");

    expect(recovered.status).toBe("error");
    expect(recovered.content).toBe("partial answer\n\nGeneration was interrupted.");
  });

  it("keeps a durable image job generating so the client can resume polling it", () => {
    const pending = message({
      imageGeneration: {
        status: "generating",
        modelId: "@cf/black-forest-labs/flux-2-dev",
        modelName: "FLUX.2 Dev",
        jobId: "job-1",
      },
    });

    expect(recoverInterruptedMessage(pending, "Generation was interrupted.")).toEqual(pending);
  });
});
