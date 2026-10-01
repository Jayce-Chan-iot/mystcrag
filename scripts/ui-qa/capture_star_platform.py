#!/usr/bin/env python3
"""TASK-QA-STAR-001 repeatable Star Platform visual capture.

Plan Task 6 step 4 requires one repeatable script that captures every customer
route plus the canonical loading / error / empty / offline / 404 states at
390x844, 768x1024, 1024x768, 1440x560 and 1440x900, writing evidence only to the
canonical QA location from docs/governance/QA_EVIDENCE_RETENTION.md
(`output/playwright/task-qa-star-001/`, which is git-ignored).

The run is idempotent: filenames are derived from (route, viewport), so a repeat
run overwrites the same files instead of accumulating duplicate screenshots.

Configuration (environment, all optional):
    STAR_QA_BASE_URL  frontend origin, default http://localhost:3000
    STAR_QA_OUT_DIR   evidence directory, default output/playwright/task-qa-star-001

The dev-server fixtures (`design-ai-published`, `design-diy-private`) come from
the isolated QA database and are owned by the documented desktop demo identity.
Session-backed routes (`/oracle/result/...`, `/tarot/draw/...`,
`/tarot/result/...`) are driven through their real setup flow; when the flow
cannot complete the route is recorded as `blocked` with the reason instead of a
fabricated image.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, Route, sync_playwright

BASE = os.environ.get("STAR_QA_BASE_URL", "http://localhost:3000").rstrip("/")
OUT = Path(os.environ.get("STAR_QA_OUT_DIR", "output/playwright/task-qa-star-001"))
SHOTS = OUT / "screenshots"

VIEWPORTS: list[tuple[str, int, int]] = [
    ("390x844", 390, 844),
    ("768x1024", 768, 1024),
    ("1024x768", 1024, 768),
    ("1440x560", 1440, 560),
    ("1440x900", 1440, 900),
]

# Routes that render without a session, using real QA-database fixtures.
STATIC_ROUTES: list[tuple[str, str]] = [
    ("home", "/"),
    ("ai-design", "/ai-design"),
    ("oracle-setup", "/oracle"),
    ("tarot-setup", "/tarot/setup"),
    ("diy-workbench", "/diy/design-diy-private"),
    ("crystal-library", "/crystal-library"),
    ("gallery", "/gallery"),
    ("design-detail", "/design/design-ai-published"),
    ("profile", "/profile"),
    ("not-found", "/__star-qa-missing-route__"),
]

# Shared system-state captures. `empty`, `error` and `offline` are produced by
# intercepting the library catalog request on a real customer route, so the page
# renders its own recoverable state through the shared star presentation instead
# of a fabricated screenshot.
STATE_ROUTES: list[tuple[str, str, str]] = [
    ("state-empty", "/crystal-library", "empty"),
    ("state-error", "/crystal-library", "error"),
    ("state-offline", "/crystal-library", "offline"),
]

# Session-backed routes driven through their real setup flow (need the Backend).
SESSION_ROUTES = ["oracle-result", "tarot-draw", "tarot-result"]

CATALOG_GLOB = "**/api/catalog/materials*"

# The Next.js dev server always mounts a `nextjs-portal` dev *indicator*, and the
# error overlay reuses that host element. Matching the host therefore reports a
# false positive on every healthy page, so the probe only reports an overlay when
# an actual error dialog is mounted (directly, or inside a portal shadow root).
OVERLAY_PROBE = """() => {
  const DIALOG = '[data-nextjs-dialog], [data-nextjs-error-overlay], [data-nextjs-dialog-overlay]';
  for (const node of document.querySelectorAll(DIALOG)) {
    if (node.tagName.toLowerCase() !== 'nextjs-portal') return node.tagName.toLowerCase();
  }
  for (const portal of document.querySelectorAll('nextjs-portal')) {
    const root = portal.shadowRoot;
    if (!root) continue;
    if (root.querySelector('[data-nextjs-dialog]')) return 'nextjs-error-overlay';
    const dialog = root.querySelector('[role="dialog"]');
    if (dialog && /error|unhandled|错误|异常/i.test(dialog.textContent || '')) {
      return 'nextjs-error-overlay';
    }
  }
  return null;
}"""


def collect(page: Page) -> dict[str, object]:
    """Sample overflow, the star surface, the state marker and any error overlay."""
    return page.evaluate(
        """() => {
          const root = document.documentElement;
          // The layout paints data-star-surface="shell"; report the most specific
          // page surface instead so the summary names the route family.
          const surfaces = [...document.querySelectorAll('[data-star-surface]')]
            .map((el) => el.getAttribute('data-star-surface'))
            .filter((value) => value && value !== 'shell');
          const state = document.querySelector(
            '[data-star-system-state], [data-error-code], [data-library-empty="true"], [data-library-page]'
          );
          return {
            overflowX: root.scrollWidth - root.clientWidth,
            surface: surfaces.length ? surfaces[surfaces.length - 1] : null,
            state: state
              ? (state.getAttribute('data-star-system-state') ||
                 state.getAttribute('data-error-code') ||
                 state.getAttribute('data-library-page') ||
                 state.getAttribute('data-library-empty'))
              : null
          };
        }"""
    )


def detect_overlay(page: Page) -> str | None:
    return page.evaluate(OVERLAY_PROBE)


def record(
    results: list[dict[str, object]],
    page: Page,
    route: str,
    viewport: str,
    status: str,
    shot: str | None,
    console_errors: list[str],
    note: str = "",
) -> None:
    sample = collect(page) if page else {}
    overlay = detect_overlay(page) if page else None
    results.append(
        {
            "route": route,
            "viewport": viewport,
            "status": status,
            "surface": sample.get("surface"),
            "state": sample.get("state"),
            "overflowX": sample.get("overflowX"),
            "overlay": overlay,
            "screenshot": shot,
            "consoleErrors": console_errors,
            "note": note,
        }
    )
    print(
        f"[{status}] {route} {viewport} surface={sample.get('surface')} "
        f"state={sample.get('state')} overflowX={sample.get('overflowX')} "
        f"overlay={overlay} {note}".rstrip()
    )


def attach_console(page: Page) -> list[str]:
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on(
        "console",
        lambda msg: errors.append(msg.text) if msg.type == "error" else None,
    )
    return errors


def capture_static(page: Page, results: list[dict[str, object]], route: str, path: str, viewport: str) -> None:
    errors = attach_console(page)
    try:
        page.goto(BASE + path, wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(600)
    except PlaywrightError as exc:
        record(results, page, route, viewport, "failed", None, errors, str(exc).splitlines()[0])
        return
    shot = f"screenshots/{route}-{viewport}.png"
    page.screenshot(path=str(OUT / shot), full_page=True)
    overlay = detect_overlay(page)
    record(results, page, route, viewport, "captured" if overlay is None else "overlay", shot, errors)


def capture_loading(page: Page, results: list[dict[str, object]], viewport: str) -> None:
    """Observe the root loading fallback through a throttled client navigation.

    The RSC requests are delayed *before* the first document load, so the
    `/gallery` link cannot satisfy the click from an already-prefetched payload
    and the root `app/loading.tsx` boundary stays visible. The navigation is
    dispatched from script because the marketing link is not visible at every
    viewport (mobile collapses it), and a normal click would time out.
    """
    errors = attach_console(page)

    def slow_rsc(route: Route) -> None:
        if route.request.headers.get("rsc") == "1":
            time.sleep(4)
        route.continue_()

    page.route("**/*", slow_rsc)
    try:
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_selector('a[href="/gallery"]', state="attached", timeout=10000)
        page.wait_for_timeout(800)  # let React hydrate so Link owns the click
        page.evaluate(
            """() => {
              const link = document.querySelector('a[href="/gallery"]');
              if (!link) throw new Error('no /gallery link on the home page');
              link.click();
            }"""
        )
        page.wait_for_selector('[data-star-system-state="loading"]', timeout=8000)
    except PlaywrightError as exc:
        record(results, page, "state-loading", viewport, "not-captured", None, errors, str(exc).splitlines()[0])
        page.unroute("**/*", slow_rsc)
        return
    shot = f"screenshots/state-loading-{viewport}.png"
    page.screenshot(path=str(OUT / shot))
    record(results, page, "state-loading", viewport, "captured", shot, errors)
    page.unroute("**/*", slow_rsc)


def capture_state(
    page: Page,
    results: list[dict[str, object]],
    route: str,
    path: str,
    mode: str,
    viewport: str,
) -> None:
    """Render a shared recoverable state by controlling the catalog response."""
    errors = attach_console(page)

    def handle(route: Route) -> None:
        if mode == "offline":
            route.abort("connectionrefused")
        elif mode == "empty":
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({"materials": []}),
            )
        else:
            route.fulfill(
                status=500,
                content_type="application/json",
                body=json.dumps(
                    {
                        "error": {
                            "code": "INTERNAL_ERROR",
                            "message": "QA simulated catalog failure.",
                            "requestId": "qa-star-001",
                        }
                    }
                ),
            )

    page.route(CATALOG_GLOB, handle)
    marker = '[data-library-empty="true"]' if mode == "empty" else '[data-library-page="error"]'
    try:
        page.goto(BASE + path, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_selector(marker, timeout=15000)
        page.wait_for_timeout(400)
    except PlaywrightError as exc:
        record(results, page, route, viewport, "not-captured", None, errors, str(exc).splitlines()[0])
        page.unroute(CATALOG_GLOB, handle)
        return
    shot = f"screenshots/{route}-{viewport}.png"
    page.screenshot(path=str(OUT / shot), full_page=True)
    record(results, page, route, viewport, "captured", shot, errors)
    page.unroute(CATALOG_GLOB, handle)


def drive_oracle(page: Page) -> str:
    page.goto(BASE + "/oracle", wait_until="networkidle", timeout=45000)
    page.wait_for_selector('[data-oracle-setup-fields="true"]', timeout=15000)
    page.fill("#oracle-wrist", "16.5")
    page.locator("button.oraclePrimaryAction").click()
    page.wait_for_url("**/oracle/result/**", timeout=45000)
    return page.url


def drive_tarot(page: Page) -> tuple[str, str]:
    page.goto(BASE + "/tarot/setup", wait_until="networkidle", timeout=45000)
    page.wait_for_selector("#tarot-wrist", timeout=15000)
    page.fill("#tarot-wrist", "16.5")
    # Last radio is the three-card spread: it exercises the full fan and slots.
    page.locator('[data-tarot-spread-options="true"] input[type="radio"]').last.check()
    page.locator('[data-tarot-setup-submit="true"]').click()
    page.wait_for_url("**/tarot/draw/**", timeout=45000)
    draw_url = page.url
    # The fan only mounts after the draw session resolves.
    page.wait_for_selector("button[data-tarot-position]", timeout=20000)
    for _ in range(3):
        cards = page.locator("button[data-tarot-position]")
        if cards.count() == 0:
            break
        accepted = page.locator('[data-selected-footprint="true"]').count()
        cards.first.click()
        page.wait_for_function(
            "n => document.querySelectorAll('[data-selected-footprint=\"true\"]').length > n",
            arg=accepted,
            timeout=15000,
        )
    page.wait_for_selector("button.tarotPrimaryAction:not([disabled])", timeout=20000)
    page.get_by_role("button", name="查看解读").click()
    page.wait_for_url("**/tarot/result/**", timeout=45000)
    return draw_url, page.url


def capture_session(page: Page, results: list[dict[str, object]], route: str, url: str, viewport: str) -> None:
    errors = attach_console(page)
    try:
        page.goto(url, wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(600)
    except PlaywrightError as exc:
        record(results, page, route, viewport, "blocked", None, errors, str(exc).splitlines()[0])
        return
    shot = f"screenshots/{route}-{viewport}.png"
    page.screenshot(path=str(OUT / shot), full_page=True)
    overlay = detect_overlay(page)
    record(results, page, route, viewport, "captured" if overlay is None else "overlay", shot, errors)


def run_capture_main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, object]] = []
    session_urls: dict[str, str] = {}
    session_notes: dict[str, str] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # Drive the session-backed flows once on a desktop viewport: the tarot fan
        # stacks its 78 cards on a narrow screen, so a mobile click is not a stable
        # driver. The resulting session URL is then captured at every viewport.
        driver = browser.new_page(viewport={"width": 1440, "height": 900})
        try:
            try:
                session_urls["oracle-result"] = drive_oracle(driver)
            except PlaywrightError as exc:
                session_notes["oracle-result"] = str(exc).splitlines()[0]
            try:
                draw_url, result_url = drive_tarot(driver)
                session_urls["tarot-draw"] = draw_url
                session_urls["tarot-result"] = result_url
            except PlaywrightError as exc:
                session_notes["tarot-draw"] = str(exc).splitlines()[0]
                session_notes["tarot-result"] = str(exc).splitlines()[0]
        finally:
            driver.close()

        for viewport, width, height in VIEWPORTS:
            for route, path in STATIC_ROUTES:
                page = browser.new_page(viewport={"width": width, "height": height})
                try:
                    capture_static(page, results, route, path, viewport)
                finally:
                    page.close()

            for route, path, mode in STATE_ROUTES:
                page = browser.new_page(viewport={"width": width, "height": height})
                try:
                    capture_state(page, results, route, path, mode, viewport)
                finally:
                    page.close()

            page = browser.new_page(viewport={"width": width, "height": height})
            try:
                capture_loading(page, results, viewport)
            finally:
                page.close()

            page = browser.new_page(viewport={"width": width, "height": height})
            try:
                for name in SESSION_ROUTES:
                    url = session_urls.get(name)
                    if not url:
                        record(
                            results, page, name, viewport, "blocked", None, [],
                            session_notes.get(name, "backend session unavailable"),
                        )
                        continue
                    capture_session(page, results, name, url, viewport)
            finally:
                page.close()

        browser.close()

    summary = {
        "baseUrl": BASE,
        "viewports": [name for name, _, _ in VIEWPORTS],
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "results": results,
    }
    (OUT / "capture-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    lines = ["route\tviewport\tstatus\tsurface\tstate\toverflowX\toverlay\tnote"]
    for item in results:
        lines.append(
            "\t".join(
                str(item.get(key, "")) for key in
                ("route", "viewport", "status", "surface", "state", "overflowX", "overlay", "note")
            )
        )
    (OUT / "capture-summary.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")

    failed = [item for item in results if item["status"] in {"failed", "overlay", "not-captured", "blocked"}]
    overlays = [item for item in results if item["overlay"]]
    print(f"\ncaptured={sum(1 for i in results if i['status'] == 'captured')} "
          f"total={len(results)} not_captured={len(failed)} overlay_rows={len(overlays)}")
    return 1 if failed or overlays else 0


# --------------------------------------------------------------------------
# Real-browser validation matrix (plan Task 6 step 5).
# Run with `--validate`. Writes validation-summary.json next to the capture
# evidence and never mutates application code.
# --------------------------------------------------------------------------

VALIDATION_ROUTES: list[tuple[str, str]] = [
    ("home", "/"),
    ("ai-design", "/ai-design"),
    ("oracle-setup", "/oracle"),
    ("tarot-setup", "/tarot/setup"),
    ("diy-workbench", "/diy/design-diy-private"),
    ("crystal-library", "/crystal-library"),
    ("gallery", "/gallery"),
    ("design-detail", "/design/design-ai-published"),
    ("profile", "/profile"),
]

# Representative text/background pairs per route for the WCAG AA contrast check.
CONTRAST_TARGETS = [
    "h1",
    "p",
    "[data-star-content-lede]",
    "[data-star-instrument-button]",
    "button",
]

REFLOW_PROBE = """() => {
  const root = document.documentElement;
  return {
    overflowX: root.scrollWidth - root.clientWidth,
    viewportWidth: root.clientWidth
  };
}"""

TOUCH_PROBE = """() => {
  const out = [];
  for (const el of document.querySelectorAll('button, [data-star-instrument-button], a[role="button"]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    out.push({
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32),
      height: Math.round(rect.height * 10) / 10,
      width: Math.round(rect.width * 10) / 10
    });
  }
  return out;
}"""

CTA_PROBE = """() => {
  const el = document.querySelector('[data-star-instrument-button], .oraclePrimaryAction, button[type="submit"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    label: (el.textContent || '').trim().slice(0, 32),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    left: Math.round(r.left), right: Math.round(r.right),
    width: Math.round(r.width), height: Math.round(r.height),
    viewportWidth: window.innerWidth, viewportHeight: window.innerHeight
  };
}"""

CENTER_PROBE = """() => {
  const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  if (!el) return { tag: null, inOverlay: false };
  const inOverlay = !!el.closest('nextjs-portal, [data-nextjs-dialog], [data-nextjs-error-overlay]');
  return { tag: el.tagName.toLowerCase(), inOverlay };
}"""

MOTION_PROBE = """() => {
  let hasReducedRule = false;
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules || [])) {
      if (rule.media && String(rule.media.mediaText).includes('prefers-reduced-motion')) {
        hasReducedRule = true;
      }
    }
  }
  let infinite = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.animationIterationCount === 'infinite' && cs.animationDuration !== '0s') infinite += 1;
  }
  return { hasReducedRule, infiniteAnimations: infinite };
}"""

# Contrast is measured from rendered pixels rather than computed styles: the star
# surfaces use `color(srgb ...)` backgrounds, gradient text and photographic
# heroes, none of which a single `getComputedStyle` pair can describe.
CONTRAST_BOX_PROBE = """(sel) => {
  // Pick the first *rendered* match: shells keep a hidden 0x0 copy of the page
  // (drawers, templates), and measuring one of those reports a bogus zero box.
  const el = Array.from(document.querySelectorAll(sel)).find((node) => {
    const r = node.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8 && getComputedStyle(node).visibility !== 'hidden';
  });
  if (!el) return null;
  // `html { scroll-behavior: smooth }` would animate this scroll, so the rect read
  // on the next line would still describe the pre-scroll position and the clip
  // would land on the wrong region. Force an instant scroll before measuring.
  document.documentElement.style.scrollBehavior = 'auto';
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    x: r.x, y: r.y, width: r.width, height: r.height,
    fontSize: parseFloat(cs.fontSize),
    bold: parseInt(cs.fontWeight, 10) >= 700,
    color: cs.color,
    text: (el.textContent || '').trim().slice(0, 40)
  };
}"""

IMAGE_TINT_PROBE = """() => {
  const TINT = /(grayscale|sepia|hue-rotate|invert|saturate|brightness|contrast)/i;
  const out = [];
  for (const img of document.querySelectorAll('img')) {
    const cs = getComputedStyle(img);
    out.push({
      src: img.getAttribute('src') || '',
      filter: cs.filter,
      blend: cs.mixBlendMode,
      opacity: cs.opacity,
      // `drop-shadow`/`blur` keep the material colour intact; only colour-mapping
      // functions and non-normal blend modes can tint a crystal or the tray.
      tinted: TINT.test(cs.filter) || (cs.mixBlendMode && cs.mixBlendMode !== 'normal')
    });
  }
  return out;
}"""

# Reports the element that currently owns keyboard focus and whether it exposes a
# visible focus indicator. `:focus-visible` only engages for keyboard activation,
# so the caller must reach the element with real Tab presses, not `.focus()`.
KEYBOARD_PROBE = """() => {
  const el = document.activeElement;
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  const interactive = el.matches('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])');
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1;
  return {
    tag,
    label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
    interactive,
    ring: outline || cs.boxShadow !== 'none'
  };
}"""


def _luminance(channel: float) -> float:
    c = channel / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def contrast_ratio(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    def rel(color: tuple[int, int, int]) -> float:
        return (
            0.2126 * _luminance(color[0])
            + 0.7152 * _luminance(color[1])
            + 0.0722 * _luminance(color[2])
        )

    l1, l2 = rel(fg), rel(bg)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def measure_contrast(page: Page, selector: str, inset: int = 3) -> dict | None:
    """Measure rendered text/background contrast for the first match of `selector`.

    The most frequent colour inside the element box is the background; the
    highest-contrast colour that appears at least three times is the text. The box
    is inset so a 1px border or a rounded corner cannot be mistaken for the text.
    """
    box = page.evaluate(CONTRAST_BOX_PROBE, selector)
    if not box or box["width"] < 8 or box["height"] < 8:
        return None
    # Re-read once the scroll has settled so entrance animations cannot shift the box
    # between measuring it and shooting it.
    page.wait_for_timeout(120)
    settled = page.evaluate(CONTRAST_BOX_PROBE, selector)
    if settled:
        box = settled
    viewport = page.viewport_size or {"width": 0, "height": 0}
    x = max(0, int(box["x"]) + inset)
    y = max(0, int(box["y"]) + inset)
    width = min(int(box["width"]) - 2 * inset, viewport["width"] - x)
    height = min(int(box["height"]) - 2 * inset, viewport["height"] - y)
    if width < 4 or height < 4:
        return None
    # `page.screenshot(clip=...)` resolves the clip against the document, while the
    # probe rect is viewport-relative, so a scrolled page would crop the wrong band.
    # Shoot the viewport and crop with PIL instead: one unambiguous coordinate space.
    frame = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    image = frame.crop((x, y, x + width, y + height))
    histogram = Counter(image.getdata())
    background = histogram.most_common(1)[0][0]
    text = background
    best = 1.0
    for color, count in histogram.items():
        if count < 3:
            continue
        ratio = contrast_ratio(color, background)
        if ratio > best:
            best, text = ratio, color
    return {
        "selector": selector,
        "ratio": round(best, 2),
        "fg": "#%02x%02x%02x" % text,
        "bg": "#%02x%02x%02x" % background,
        "fontSize": box["fontSize"],
        "bold": box["bold"],
        "text": box["text"],
    }


def run_validation_main() -> int:
    checks: list[dict[str, object]] = []

    def add(name: str, ok: bool, detail: object) -> None:
        checks.append({"check": name, "status": "PASS" if ok else "FAIL", "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 1. WCAG 1.4.10 reflow at 320px — no horizontal scrolling.
        for route, path in VALIDATION_ROUTES:
            page = browser.new_page(viewport={"width": 320, "height": 800})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(400)
                probe = page.evaluate(REFLOW_PROBE)
                add(f"reflow-320:{route}", probe["overflowX"] <= 1, probe)
            except PlaywrightError as exc:
                add(f"reflow-320:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 2. WCAG 1.4.4 text resize to 200% — no horizontal scrolling.
        for route, path in VALIDATION_ROUTES:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.add_style_tag(content="html { font-size: 200% !important; }")
                page.wait_for_timeout(500)
                probe = page.evaluate(REFLOW_PROBE)
                add(f"zoom-200:{route}", probe["overflowX"] <= 1, probe)
            except PlaywrightError as exc:
                add(f"zoom-200:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 3. prefers-reduced-motion is honoured and nothing animates forever.
        for route, path in [("home", "/"), ("crystal-library", "/crystal-library")]:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            try:
                page.emulate_media(reduced_motion="reduce")
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(400)
                probe = page.evaluate(MOTION_PROBE)
                add(
                    f"reduced-motion:{route}",
                    probe["hasReducedRule"] and probe["infiniteAnimations"] == 0,
                    probe,
                )
            except PlaywrightError as exc:
                add(f"reduced-motion:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 4. WCAG AA contrast for representative text on the star surfaces.
        for route, path in VALIDATION_ROUTES:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(400)
                worst = None
                for sel in CONTRAST_TARGETS:
                    probe = measure_contrast(page, sel)
                    if not probe:
                        continue
                    large = probe["fontSize"] >= 24 or (probe["bold"] and probe["fontSize"] >= 18.66)
                    floor = 3.0 if large else 4.5
                    entry = {**probe, "floor": floor}
                    if worst is None or entry["ratio"] - entry["floor"] < worst["ratio"] - worst["floor"]:
                        worst = entry
                if worst is None:
                    add(f"contrast-aa:{route}", False, "no measurable text target")
                else:
                    add(f"contrast-aa:{route}", worst["ratio"] >= worst["floor"], worst)
            except PlaywrightError as exc:
                add(f"contrast-aa:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 5. 44px minimum touch targets on mobile.
        for route, path in [("home", "/"), ("crystal-library", "/crystal-library"), ("oracle-setup", "/oracle")]:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(400)
                targets = page.evaluate(TOUCH_PROBE)
                offenders = [t for t in targets if t["height"] < 44]
                add(
                    f"touch-44:{route}",
                    len(offenders) == 0,
                    {"total": len(targets), "offenders": offenders[:8]},
                )
            except PlaywrightError as exc:
                add(f"touch-44:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 6. Primary CTA stays fully inside the viewport (not clipped).
        for route, path in VALIDATION_ROUTES:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(400)
                probe = page.evaluate(CTA_PROBE)
                if probe is None:
                    add(f"cta-visible:{route}", True, "no CTA on this route")
                else:
                    inside = (
                        probe["height"] > 0
                        and probe["left"] >= 0
                        and probe["right"] <= probe["viewportWidth"] + 1
                    )
                    add(f"cta-visible:{route}", inside, probe)
            except PlaywrightError as exc:
                add(f"cta-visible:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 7. No overlay intercepts the centre of the page.
        for route, path in VALIDATION_ROUTES:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(400)
                probe = page.evaluate(CENTER_PROBE)
                add(f"overlay-center:{route}", not probe["inOverlay"], probe)
            except PlaywrightError as exc:
                add(f"overlay-center:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 8. Crystal imagery is never tinted by the star layer.
        for route, path in [("crystal-library", "/crystal-library"), ("diy-workbench", "/diy/design-diy-private")]:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(600)
                images = page.evaluate(IMAGE_TINT_PROBE)
                tinted = [i for i in images if i["tinted"]]
                add(f"crystal-not-tinted:{route}", len(tinted) == 0, {"images": len(images), "tinted": tinted[:5]})
            except PlaywrightError as exc:
                add(f"crystal-not-tinted:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 9. Home capability switch renders the expected card count.
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        try:
            page.goto(BASE + "/", wait_until="networkidle", timeout=45000)
            page.wait_for_timeout(400)
            count = page.evaluate(
                "() => ({ declared: Number(document.querySelector('[data-creation-count]')?.getAttribute('data-creation-count')), rendered: document.querySelectorAll('[data-creation-path]').length })"
            )
            add(
                "capability-home-cards",
                count["declared"] == count["rendered"] and count["rendered"] >= 2,
                count,
            )
        except PlaywrightError as exc:
            add("capability-home-cards", False, str(exc).splitlines()[0])
        finally:
            page.close()

        # 10. Oracle stays a one-click cast: exactly one create request.
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        try:
            creates: list[str] = []
            page.on(
                "request",
                lambda r: creates.append(r.method + " " + r.url)
                if r.method == "POST" and "/api/oracle/sessions" in r.url
                else None,
            )
            page.goto(BASE + "/oracle", wait_until="networkidle", timeout=45000)
            page.wait_for_selector('[data-oracle-setup-fields="true"]', timeout=15000)
            page.fill("#oracle-wrist", "16.5")
            page.locator("button.oraclePrimaryAction").click()
            page.wait_for_url("**/oracle/result/**", timeout=45000)
            add("oracle-single-cast", len(creates) == 1, {"posts": creates})
        except PlaywrightError as exc:
            add("oracle-single-cast", False, str(exc).splitlines()[0])
        finally:
            page.close()

        # 11. No runtime error overlay is mounted on a healthy customer route.
        # The Next.js dev server raises its "Console Error" dialog from the shadow
        # root of the `nextjs-portal` indicator, so `overlay-center` alone cannot
        # see it; a stray React warning would otherwise pass the gate silently.
        for route, path in VALIDATION_ROUTES:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(600)
                overlay = detect_overlay(page)
                add(f"no-error-overlay:{route}", overlay is None, overlay or "none")
            except PlaywrightError as exc:
                add(f"no-error-overlay:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 12. Keyboard-only traversal reaches real controls and every stop shows a
        # visible focus indicator (`:focus-visible` only fires for keyboard input).
        for route, path in VALIDATION_ROUTES:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=45000)
                page.wait_for_timeout(400)
                stops: list[dict] = []
                for _ in range(20):
                    page.keyboard.press("Tab")
                    info = page.evaluate(KEYBOARD_PROBE)
                    if info and info["interactive"]:
                        stops.append(info)
                distinct = {(s["tag"], s["label"]) for s in stops}
                no_ring = [s for s in stops if not s["ring"]]
                add(
                    f"keyboard-focus:{route}",
                    len(distinct) >= 2 and len(no_ring) == 0,
                    {"stops": len(stops), "distinct": len(distinct), "noRing": no_ring[:5]},
                )
            except PlaywrightError as exc:
                add(f"keyboard-focus:{route}", False, str(exc).splitlines()[0])
            finally:
                page.close()

        # 13. A primary journey completes with the keyboard only: Tab to the Oracle
        # cast action and activate it with Enter (no pointer activation).
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        try:
            page.goto(BASE + "/oracle", wait_until="networkidle", timeout=45000)
            page.wait_for_selector('[data-oracle-setup-fields="true"]', timeout=15000)
            page.fill("#oracle-wrist", "16.5")
            reached = False
            for _ in range(40):
                page.keyboard.press("Tab")
                if page.evaluate("() => document.activeElement?.classList?.contains('oraclePrimaryAction')"):
                    reached = True
                    break
            if reached:
                page.keyboard.press("Enter")
                page.wait_for_url("**/oracle/result/**", timeout=45000)
            add("keyboard-complete:oracle", reached, "Tab reached the cast action; Enter cast the session")
        except PlaywrightError as exc:
            add("keyboard-complete:oracle", False, str(exc).splitlines()[0])
        finally:
            page.close()

        browser.close()

    failed = [c for c in checks if c["status"] == "FAIL"]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "validation-summary.json").write_text(
        json.dumps(
            {
                "baseUrl": BASE,
                "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "total": len(checks),
                "failed": len(failed),
                "checks": checks,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nvalidation total={len(checks)} failed={len(failed)}")
    return 1 if failed else 0


def main() -> int:
    if "--validate" in sys.argv[1:]:
        return run_validation_main()
    return run_capture_main()


if __name__ == "__main__":
    sys.exit(main())
