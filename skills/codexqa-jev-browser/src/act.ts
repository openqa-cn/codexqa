import { StalePage, UnsupportedAction } from "./errors.js";
import { targetReady } from "./observe/snapshot.js";
import type { ObservedElement, PageState, Step } from "./types.js";
import type { BrowserSession } from "./browser.js";
import { assertHttpUrl, expandDeep, expandVars, jsonpath, truncate } from "./util.js";

async function waitFrames(session: BrowserSession, capMs: number): Promise<void> {
  if (!session.page) return;
  try {
    await session.page.evaluate(
      (ms) =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const done = () => resolve();
          const tick = () => {
            frames += 1;
            if (frames >= 2) done();
            else requestAnimationFrame(tick);
          };
          setTimeout(done, ms);
          requestAnimationFrame(tick);
        }),
      capMs,
    );
  } catch {
    await new Promise((resolve) => setTimeout(resolve, capMs));
  }
}

export async function settle(session: BrowserSession): Promise<void> {
  if (!session.page) return;
  await waitFrames(session, 50);
}

export async function execute(
  session: BrowserSession,
  _page: PageState,
  element: ObservedElement | undefined,
  kind: string,
  options: { text?: string; optionValue?: string; delta?: number; waitMs?: number } = {},
): Promise<void> {
  if (!session.page) throw new Error("Browser is not started");
  if (kind === "wait") {
    await new Promise((resolve) => setTimeout(resolve, Math.max(options.waitMs ?? 100, 0)));
    return;
  }
  if (kind === "scroll") {
    await session.page.mouse.wheel(0, options.delta ?? 600);
    await settle(session);
    return;
  }
  if (!element) throw new StalePage("No target for this action");
  if (!["click", "type", "select"].includes(kind)) throw new UnsupportedAction(`Unsupported operation: ${kind}`);
  const geometry = await targetReady(session.page, {
    node: element.node,
    kind,
    value: options.optionValue,
    frame: element.frame,
  });
  if (!geometry) throw new StalePage("Target changed, is covered, or is no longer actionable");
  const handle = await session.findLocator(element.node);
  if (kind === "click") {
    const finishPopup = session.watchPopup();
    await handle.click({ timeout: 2500 });
    await finishPopup();
  } else if (kind === "type") {
    if (!options.text?.trim()) throw new Error("TYPE requires a non-empty text value");
    await handle.click({ timeout: 2500 });
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await session.page.keyboard.press(`${modifier}+A`);
    await session.page.keyboard.insertText(options.text);
  } else {
    if (options.optionValue == null) throw new Error("SELECT requires an option value");
    await handle.selectOption({ value: options.optionValue });
  }
  await settle(session);
}

export async function runHttp(step: Step, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const url = expandVars(step.url ?? "", extra);
  if (!url) throw new Error("http step requires url");
  assertHttpUrl(url);
  const headers = Object.fromEntries(
    Object.entries(step.headers ?? {}).map(([key, value]) => [key, expandVars(value, extra)]),
  );
  const json = step.json !== undefined ? expandDeep(step.json, extra) : undefined;
  const body = step.body !== undefined ? expandVars(step.body, extra) : undefined;
  const response = await fetch(url, {
    method: (step.method ?? "GET").toUpperCase(),
    headers: {
      ...headers,
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const bodyText = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }
  const saved: Record<string, unknown> = {};
  if (parsed && step.save) {
    for (const [name, path] of Object.entries(step.save)) {
      saved[name] = jsonpath(parsed, path);
      extra[name] = saved[name];
    }
  }
  const ok = step.expectStatus == null || response.status === step.expectStatus;
  return {
    method: (step.method ?? "GET").toUpperCase(),
    url,
    status: response.status,
    body: truncate(bodyText),
    json: parsed,
    saved,
    ok,
    error: ok ? undefined : `expected status ${step.expectStatus}, got ${response.status}`,
  };
}
