from playwright.sync_api import sync_playwright

JS = """() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect();
    if (r.width > vw - 32 + 1) {
      // measure intrinsic min-content width by cloning
      const clone = el.cloneNode(true);
      clone.style.cssText = 'position:absolute;left:-9999px;top:0;width:min-content;max-width:none;display:block;';
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;width:min-content;';
      host.appendChild(clone);
      document.body.appendChild(host);
      const minW = clone.getBoundingClientRect().width;
      host.remove();
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 70),
        w: Math.round(r.width), minW: Math.round(minW),
        txt: (el.textContent || '').trim().slice(0, 24)
      });
    }
  }
  return bad.filter(x => x.minW > 330).sort((a, b) => b.minW - a.minW).slice(0, 18);
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 375, "height": 667})
    page.goto("http://localhost:3000/crystal-library", wait_until="networkidle")
    page.wait_for_selector('[data-library-page="ready"]', timeout=30000)
    page.wait_for_timeout(1000)
    print("clientWidth:", page.evaluate("() => document.documentElement.clientWidth"))
    print("scrollWidth:", page.evaluate("() => document.documentElement.scrollWidth"))
    for row in page.evaluate(JS):
        print(row)
    browser.close()
