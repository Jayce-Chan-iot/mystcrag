from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 375, "height": 667})
    page.goto("http://localhost:3000/crystal-library", wait_until="networkidle")
    page.wait_for_selector('[data-library-page="ready"]', timeout=30000)
    page.wait_for_timeout(1200)
    offenders = page.evaluate(
        """() => {
            const vw = document.documentElement.clientWidth;
            const out = [];
            for (const el of document.querySelectorAll('body *')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
                    out.push({
                        tag: el.tagName.toLowerCase(),
                        cls: String(el.className).slice(0, 90),
                        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
                        label: (el.getAttribute('aria-label') || el.getAttribute('data-library-grid') || el.textContent || '').trim().slice(0, 30)
                    });
                }
            }
            return out.slice(0, 25);
        }"""
    )
    for o in offenders:
        print(o)
    browser.close()
