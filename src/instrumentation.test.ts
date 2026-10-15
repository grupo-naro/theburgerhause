import { afterEach, describe, expect, it, vi } from "vitest";

const startListener = vi.fn();
vi.mock("./lib/events/listener", () => ({ startListener: () => startListener() }));

import { register } from "./instrumentation";

afterEach(() => {
  startListener.mockReset();
  vi.unstubAllEnvs();
});

describe("register()", () => {
  it("starts the listener on the node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await register();
    expect(startListener).toHaveBeenCalledTimes(1);
  });

  it("never opens a connection during next build", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(startListener).not.toHaveBeenCalled();
  });

  it("does nothing on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(startListener).not.toHaveBeenCalled();
  });
});
