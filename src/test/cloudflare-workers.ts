export class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  protected env: Env;

  constructor(_context: unknown, env: Env) {
    this.env = env;
  }

  run(_event: { payload: Params }, _step: unknown): Promise<unknown> {
    throw new Error("WorkflowEntrypoint.run must be implemented by the workflow class.");
  }
}

export type WorkflowEvent<T> = { payload: Readonly<T> };
export type WorkflowStep = {
  do<T>(name: string, config: unknown, callback: () => Promise<T>): Promise<T>;
};

export interface TestTraceSpan {
  name: string;
  attributes: Record<string, boolean | number | string>;
  ended: boolean;
}

export const testTraceSpans: TestTraceSpan[] = [];

export const resetTestTraceSpans = (): void => {
  testTraceSpans.length = 0;
};

class TestSpan implements TestTraceSpan {
  readonly attributes: Record<string, boolean | number | string> = {};
  ended = false;

  constructor(readonly name: string) {
    testTraceSpans.push(this);
  }

  get isTraced(): boolean {
    return !this.ended;
  }

  setAttribute(key: string, value: boolean | number | string): this {
    if (!this.ended) this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Record<string, boolean | number | string | undefined>): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) this.setAttribute(key, value);
    }
    return this;
  }

  end(): void {
    this.ended = true;
  }
}

const finishAutomatically = <T>(span: TestSpan, value: T): T => {
  if (value && typeof (value as { then?: unknown }).then === "function") {
    return Promise.resolve(value).finally(() => span.end()) as T;
  }
  span.end();
  return value;
};

export const tracing = {
  enterSpan<T, A extends unknown[]>(
    name: string,
    callback: (span: TestSpan, ...args: A) => T,
    ...args: A
  ): T {
    const span = new TestSpan(name);
    try {
      return finishAutomatically(span, callback(span, ...args));
    } catch (error) {
      span.end();
      throw error;
    }
  },
  startActiveSpan<T, A extends unknown[]>(
    name: string,
    callback: (span: TestSpan, ...args: A) => T,
    ...args: A
  ): T {
    return callback(new TestSpan(name), ...args);
  },
};
