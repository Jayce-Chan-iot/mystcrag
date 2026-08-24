import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = sys.argv[1] if len(sys.argv) > 1 else "qa-captures-current"
ROUTES = [
    ("home", "/"),
    ("ai-questionnaire", "/ai-design"),
    ("tarot-setup", "/tarot/setup"),
    ("diy", "/diy"),
    ("library", "/crystal-library"),
    ("gallery", "/gallery"),
    ("profile", "/profile"),
]
VIEWPORTS = [
    ("desktop-1440x900", 1440, 900),
    ("desktop-1280x720", 1280, 720),
    ("desktop-1470x760", 1470, 760),
    ("mobile-390x844", 390, 844),
    ("mobile-375x667", 375, 667),
    ("mobile-430x932", 430, 932),
]

import os
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for vp_name, w, h in VIEWPORTS:
        page = browser.new_page(viewport={"width": w, "height": h})
        for route_name, path in ROUTES:
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=30000)
            except Exception:
                page.wait_for_timeout(3000)
            page.wait_for_timeout(1200)
            overflow = page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            fname = f"{OUT}/current-{route_name}-{vp_name}.png"
            page.screenshot(path=fname)
            print(f"{route_name} {vp_name} overflowX={overflow}px")
        page.close()
    browser.close()
print("done")
