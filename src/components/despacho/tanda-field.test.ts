import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/app/(staff)/despacho/actions", () => ({ setTandaAction: vi.fn() }));

const { TandaField } = await import("./tanda-field");
const render = (props: { tanda: number | null; canEdit: boolean }) => renderToStaticMarkup(createElement(TandaField, { orderId: 1, number: 7, ...props }));

describe("TandaField", () => {
  it("read-only shows the tanda as text, with no input", () => {
    const html = render({ tanda: 3, canEdit: false });
    expect(html).toContain("Tanda 3");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("tanda-input");
  });

  it("read-only without tanda shows Sin tanda and no input", () => {
    const html = render({ tanda: null, canEdit: false });
    expect(html).toContain("Sin tanda");
    expect(html).not.toContain("<input");
  });

  it("editable renders the numeric input with the current value", () => {
    const html = render({ tanda: 3, canEdit: true });
    expect(html).toContain('data-testid="tanda-input"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('value="3"');
  });
});
