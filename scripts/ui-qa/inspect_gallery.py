import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

JS = """() => {
  const pills = [...document.querySelectorAll('[data-gallery-filter]')].map((el) => el.textContent.trim());
  const cards = [...document.querySelectorAll('[data-gallery-card]')].slice(0, 3).map((card) => ({
    id: card.getAttribute('data-gallery-card'),
    title: card.querySelector('h3')?.textContent?.trim(),
    paragraphs: [...card.querySelectorAll('p')].map((p) => p.textContent?.trim()).filter(Boolean),
    badge: [...card.querySelectorAll('span')].map((s) => s.textContent.trim()).filter((t) => t === '精选' || t === '草稿' || t === '已完成')
  }));
  const statNodes = [...document.querySelectorAll('main p')].map((p) => p.textContent.trim()).filter((t) => t.includes('个设计'));
  return {
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
    navLinks: [...document.querySelectorAll('header a')].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 10),
    pills,
    statNodes,
    searchPlaceholder: document.querySelector('#gallery-search-desktop')?.getAttribute('placeholder'),
    createLabel: document.querySelector('[data-gallery-action="create"]')?.textContent?.trim(),
    cards,
    overlayActions: [...document.querySelectorAll('[data-gallery-overlay] a, [data-gallery-overlay] button')].map((el) => el.textContent.trim())
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BASE + "/gallery", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1200)
    print(json.dumps(page.evaluate(JS), ensure_ascii=False, indent=1))

    page.click('[data-gallery-filter="AI_DESIGN"]')
    page.wait_for_timeout(400)
    ai_count = page.locator('[data-gallery-card]').count()
    page.locator("#gallery-search-desktop").fill("Quiet")
    page.wait_for_timeout(600)
    search_count = page.locator('[data-gallery-card]').count()
    print("after AI_DESIGN filter:", ai_count, "cards; after search 'Quiet':", search_count, "cards")
    page.click('[data-gallery-filter="ALL"]')
    page.locator("#gallery-search-desktop").fill("")
    page.wait_for_timeout(600)
    print("reset:", page.locator('[data-gallery-card]').count(), "cards")

    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(BASE + "/gallery", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1200)
    page.locator('[data-gallery-action="menu"]').first.click()
    page.wait_for_timeout(300)
    print("mobile menu open:", page.locator('[data-gallery-menu]').count())
    browser.close()
