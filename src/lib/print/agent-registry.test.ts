import { afterEach, describe, expect, it, vi } from "vitest";
import { agentStreamCount, hasAgentStream, registerAgentStream, resetAgentRegistry } from "./agent-registry";

afterEach(resetAgentRegistry);

describe("agent registry", () => {
  it("tracks one stream per station", () => {
    registerAgentStream(1, () => {});
    registerAgentStream(2, () => {});
    expect(agentStreamCount()).toBe(2);
    expect(hasAgentStream(1)).toBe(true);
    expect(hasAgentStream(3)).toBe(false);
  });

  it("a new registration for the same station REPLACES the old one: its closer runs with 'replaced'", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerAgentStream(1, first);
    registerAgentStream(1, second);
    expect(first).toHaveBeenCalledExactlyOnceWith("replaced");
    expect(second).not.toHaveBeenCalled();
    expect(agentStreamCount()).toBe(1);
  });

  it("the replaced stream releasing itself later does not unregister its replacement", () => {
    const a = registerAgentStream(1, () => {});
    registerAgentStream(1, () => {});
    a.release();
    expect(hasAgentStream(1)).toBe(true);
    expect(agentStreamCount()).toBe(1);
  });

  it("release removes the entry and is idempotent", () => {
    const a = registerAgentStream(1, () => {});
    a.release();
    a.release();
    expect(agentStreamCount()).toBe(0);
  });

  it("a closer that throws does not break the replacement", () => {
    registerAgentStream(1, () => {
      throw new Error("boom");
    });
    const next = vi.fn();
    expect(() => registerAgentStream(1, next)).not.toThrow();
    expect(hasAgentStream(1)).toBe(true);
  });

  it("the closer may release itself re-entrantly while being replaced", () => {
    const self: { release?: () => void } = {};
    self.release = registerAgentStream(1, () => self.release?.()).release;
    registerAgentStream(1, () => {});
    expect(agentStreamCount()).toBe(1);
  });
});
