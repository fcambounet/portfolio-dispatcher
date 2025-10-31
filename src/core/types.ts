export type AgentEvent<T = unknown> = { type: string; payload: T; ts?: string };

export interface Agent<I = unknown, O = unknown> {
  name: string;
  handles: string[];
  handle(input: I): Promise<O>;
}