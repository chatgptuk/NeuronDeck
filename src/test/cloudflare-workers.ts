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
