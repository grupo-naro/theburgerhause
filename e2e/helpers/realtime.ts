import type { Page } from "@playwright/test";

export type SseFrame = { event: string; data: unknown };

declare global {
  interface Window {
    __rt?: { frames: SseFrame[]; source: EventSource };
  }
}

/** Opens an EventSource on /api/events INSIDE the page (staff cookies) and records every frame it receives. */
export async function collectEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__rt?.source.close();
    const frames: { event: string; data: unknown }[] = [];
    const source = new EventSource("/api/events");
    for (const event of ["hello", "orders", "resync"]) {
      source.addEventListener(event, (e) => {
        let data: unknown = null;
        try {
          data = JSON.parse((e as MessageEvent<string>).data);
        } catch {
          // keep null
        }
        frames.push({ event, data });
      });
    }
    window.__rt = { frames, source };
  });
}

export const frames = (page: Page): Promise<SseFrame[]> => page.evaluate(() => window.__rt?.frames ?? []);

export const framesOf = async (page: Page, event: string): Promise<SseFrame[]> =>
  (await frames(page)).filter((f) => f.event === event);

export async function stopCollecting(page: Page): Promise<void> {
  await page.evaluate(() => window.__rt?.source.close());
}
