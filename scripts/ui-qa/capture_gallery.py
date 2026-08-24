import os
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = sys.argv[1] if len(sys.argv) > 1 else "qa-captures-gallery"
VIEWPORTS = [
    ("desktop-1440x900", 1440, 900),
    ("desktop-1280x720", 1280, 720),
    ("desktop-1470x760", 1470, 760),
    ("mobile-390x844", 390, 844),
    ("mobile-375x667", 375, 667),
    ("mobile-430x932", 430, 932),
]

os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for vp_name, w, h in VIEWPORTS:
        page = browser.new_page(viewport={"width": w, "height": h})
        try:
            page.goto(BASE + "/gallery", wait_until="networkidle", timeout=30000)
        except Exception:
            page.wait_for_timeout(3000)
        page.wait_for_timeout(1500)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        state = page.evaluate(
            "() => document.querySelector('[data-gallery-page]')?.getAttribute('data-gallery-page') ?? 'missing'"
        )
        cards = page.evaluate("() => document.querySelectorAll('[data-gallery-card]').length")
        fname = f"{OUT}/gallery-{vp_name}.png"
        page.screenshot(path=fname, full_page=True)
        print(f"{vp_name} state={state} cards={cards} overflowX={overflow}px")
        page.close()
    browser.close()
print("done")
