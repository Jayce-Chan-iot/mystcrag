from playwright.sync_api import sync_playwright

JS = """() => {
  const vw = document.documentElement.clientWidth;
  const base = document.documentElement.scrollWidth;
  const out = [];
  const section = document.querySelector('section[aria-labelledby="library-main-title"]');
  if (!section) return ['no section'];
  const kids = [...section.children];
  for (const kid of kids) {
    const prev = kid.style.display;
    kid.style.display = 'none';
    const w = document.documentElement.scrollWidth;
    kid.style.display = prev;
    out.push({ cls: String(kid.className).slice(0, 60), hideFixes: w <= vw, scrollW: w });
  }
  // also try min-w-0 patch on section itself
  const prevMin = section.style.minWidth;
  section.style.minWidth = '0';
  const patched = document.documentElement.scrollWidth;
  section.style.minWidth = prevMin;
  return { base, kids: out, patched };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 375, "height": 667})
    page.goto("http://localhost:3000/crystal-library", wait_until="networkidle")
    page.wait_for_selector('[data-library-page="ready"]', timeout=30000)
    page.wait_for_timeout(1000)
    result = page.evaluate(JS)
    print(result)
    browser.close()
