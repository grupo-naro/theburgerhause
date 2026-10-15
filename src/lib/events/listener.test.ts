import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const getEnv = vi.fn();
vi.mock("@/lib/env", () => ({ getEnv: () => getEnv() }));

import { listenerStatus, startListener, stopListener } from "./listener";

afterEach(async () => {
  await stopListener();
  getEnv.mockReset();
  vi.restoreAllMocks();
});

describe("startListener resilience", () => {
  it("an invalid environment does not throw out of startListener; status stays down", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getEnv.mockImplementation(() => {
      throw new Error("Invalid environment variables - DATABASE_URL: secret-ish");
    });
    expect(() => startListener()).not.toThrow();
    expect(listenerStatus()).toBe("down");
    expect(spy).toHaveBeenCalledWith("[events] listener not started: invalid configuration");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret-ish");
  });

  it("a connect that hangs times out and schedules reconnects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let accepted = 0;
    const sockets: net.Socket[] = [];
    // Accepts TCP but never speaks the Postgres protocol: a blackholed host.
    const server = net.createServer((sock) => {
      accepted++;
      sockets.push(sock);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const { port } = server.address() as net.AddressInfo;
      startListener({
        connectionString: `postgres://u:p@127.0.0.1:${port}/db`,
        connectTimeoutMs: 50,
        backoff: { minMs: 10, maxMs: 20 },
      });
      await vi.waitFor(() => expect(accepted).toBeGreaterThanOrEqual(2), { timeout: 5000, interval: 10 });
      expect(listenerStatus()).toBe("down");
    } finally {
      await stopListener();
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
