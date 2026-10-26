import { beforeEach, describe, expect, it, vi } from "vitest";

const accepting = vi.fn();
const publicDelay = vi.fn();
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/settings", () => ({ getAcceptingOrders: (...a: unknown[]) => accepting(...a) }));
vi.mock("@/lib/delay/public", () => ({ getPublicDelay: (...a: unknown[]) => publicDelay(...a) }));
vi.mock("./estimate-notice", () => ({ EstimateNotice: () => null }));

import { EstimateBanner } from "./estimate-banner";

const delay = { takeaway: { low: 20, high: 30 }, delivery: { low: 35, high: 45 }, delayed: false };

beforeEach(() => {
  accepting.mockReset();
  publicDelay.mockReset();
});

describe("EstimateBanner", () => {
  it("renders the estimate while the store accepts orders", async () => {
    accepting.mockResolvedValue(true);
    publicDelay.mockResolvedValue(delay);
    const el = await EstimateBanner();
    expect(el).not.toBeNull();
    expect(el?.props).toMatchObject({ variant: "menu", initial: delay });
  });

  it("renders nothing when the store is closed", async () => {
    accepting.mockResolvedValue(false);
    publicDelay.mockResolvedValue(delay);
    expect(await EstimateBanner()).toBeNull();
  });

  it("renders nothing when a read fails", async () => {
    accepting.mockRejectedValue(new Error("db down"));
    expect(await EstimateBanner()).toBeNull();
  });
});
