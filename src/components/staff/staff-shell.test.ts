import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const panelData = vi.fn();
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/components/live/live-refresh", () => ({ LiveRefresh: () => null }));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));
vi.mock("@/lib/caja/nav", () => ({ navLinksFor: () => [] }));
const pending = vi.fn(async (..._a: unknown[]) => [] as { id: number; number: number; createdAt: string }[]);
vi.mock("@/lib/orders/caja-queries", () => ({ listPendingApproval: (...a: unknown[]) => pending(...a) }));
vi.mock("@/lib/caja/printer-status", () => ({ derivePrinterStatus: () => null }));
vi.mock("@/lib/stations/header", () => ({ getStationHeader: async () => null }));
vi.mock("./delay-panel", () => ({ DelayPanel: () => null }));
vi.mock("./delay-panel-data", () => ({ getDelayPanelData: (...a: unknown[]) => panelData(...a) }));
vi.mock("./printer-heartbeat-refresh", () => ({ PrinterHeartbeatRefresh: () => null }));
vi.mock("./printer-indicator", () => ({ PrinterIndicator: () => null }));
vi.mock("./shell-order-alert", () => ({ ShellOrderAlert: () => null }));
vi.mock("./staff-nav", () => ({ StaffNav: () => null }));

import { StaffShell } from "./staff-shell";
import type { AuthSession } from "@/lib/auth/roles";

const session = { user: { role: "cajera", name: "Caja" }, stationId: null, stationKind: null } as unknown as AuthSession;

/** Depth-first search of a React element tree for a given component. */
function contains(node: unknown, name: string): boolean {
  if (!node || typeof node !== "object") return false;
  const el = node as ReactElement<{ children?: unknown }>;
  if (typeof el.type === "function" && el.type.name === name) return true;
  const kids = el.props?.children;
  return (Array.isArray(kids) ? kids : [kids]).some((k) => contains(k, name));
}

beforeEach(() => {
  panelData.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("StaffShell delay chip", () => {
  it("renders the chip when its data loads", async () => {
    panelData.mockResolvedValue({ active: null });
    expect(contains(await StaffShell({ session, children: null }), "DelayPanel")).toBe(true);
  });

  it("still renders the shell, without the chip, when its data fails", async () => {
    panelData.mockRejectedValue(new Error("db down"));
    const tree = await StaffShell({ session, children: null });
    expect(contains(tree, "DelayPanel")).toBe(false);
    expect(contains(tree, "LogoutButton")).toBe(true);
    expect(console.error).toHaveBeenCalledWith("staff-shell: delay chip unavailable");
  });
});

/** Props of the first element of the given component in the tree, or null. */
function find(node: unknown, name: string): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const el = node as ReactElement<{ children?: unknown }>;
  if (typeof el.type === "function" && el.type.name === name) return el.props as Record<string, unknown>;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = find(k, name);
    if (hit) return hit;
  }
  return null;
}

describe("StaffShell pending app orders banner", () => {
  const cajera = { user: { role: "cajera", name: "Caja" }, stationId: 1, stationKind: "mostrador" } as unknown as AuthSession;
  const two = [
    { id: 1, number: 10, createdAt: "2026-11-13T20:00:00Z" },
    { id: 2, number: 11, createdAt: "2026-11-13T20:01:00Z" },
  ];
  beforeEach(() => {
    panelData.mockResolvedValue({ active: null });
    pending.mockReset();
  });

  it("banner on Venta when app orders wait", async () => {
    pending.mockResolvedValue(two);
    expect(find(await StaffShell({ session: cajera, children: null }), "PendingAppOrdersBanner")).toMatchObject({ count: 2 });
  });
  it("no banner on the page that owns the alert", async () => {
    pending.mockResolvedValue(two);
    expect(find(await StaffShell({ session: cajera, ownsOrderAlert: true, children: null }), "PendingAppOrdersBanner")).toBeNull();
  });
  it("no banner with nothing pending", async () => {
    pending.mockResolvedValue([]);
    expect(find(await StaffShell({ session: cajera, children: null }), "PendingAppOrdersBanner")).toBeNull();
  });
  it("no banner for the delivery manager", async () => {
    pending.mockResolvedValue(two);
    const encargada = { user: { role: "encargada_delivery", name: "E" }, stationId: 2, stationKind: "delivery" } as unknown as AuthSession;
    expect(find(await StaffShell({ session: encargada, children: null }), "PendingAppOrdersBanner")).toBeNull();
  });
});
