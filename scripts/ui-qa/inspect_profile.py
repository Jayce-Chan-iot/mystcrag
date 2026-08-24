import json
import os
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = sys.argv[1] if len(sys.argv) > 1 else "qa-captures-profile"
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
            page.goto(BASE + "/profile", wait_until="networkidle", timeout=30000)
        except Exception:
            page.wait_for_timeout(3000)
        page.wait_for_timeout(1500)
        overflow = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        state = page.evaluate("() => document.querySelector('[data-profile-page]')?.getAttribute('data-profile-page') ?? 'missing'")
        page.screenshot(path=f"{OUT}/profile-{vp_name}.png", full_page=True)
        print(f"{vp_name} state={state} overflowX={overflow}px")
        page.close()

    # DOM + interactions on desktop
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BASE + "/profile", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1500)
    dom = page.evaluate(
        """() => ({
      sidebarTabs: [...document.querySelectorAll('[data-profile-tab]')].map((b) => b.textContent.trim()),
      stats: [...document.querySelectorAll('[data-profile-stat]')].map((el) => el.textContent.trim()),
      continueCount: document.querySelectorAll('[data-profile-continue]').length,
      orderRows: [...document.querySelectorAll('[data-profile-order]')].slice(0, 3).map((r) => r.textContent.trim().slice(0, 80)),
      prefRows: document.querySelector('[data-profile-section="preferences"]')?.textContent?.trim().slice(0, 120),
      services: [...document.querySelectorAll('[data-profile-service]')].length
    })"""
    )
    print(json.dumps(dom, ensure_ascii=False, indent=1))

    # edit preferences dialog
    page.locator('[data-profile-action="pref-edit"]').first.click()
    page.wait_for_timeout(300)
    page.locator('[data-profile-pref-diameter="10"]').click()
    page.locator('[data-profile-pref-color="purple"]').click()
    page.locator('[data-profile-action="pref-save"]').click()
    page.wait_for_timeout(400)
    print("pref toast:", page.locator('[data-profile-toast]').text_content().strip())

    # identity edit
    page.locator('[data-profile-action="identity-edit"]').first.click()
    page.wait_for_timeout(300)
    page.locator('[data-profile-identity-input="name"]').fill("测试设计师")
    page.locator('[data-profile-identity-input="email"]').fill("xuanji@mystcrag.com")
    page.locator('[data-profile-identity-input="phone"]').fill("13812349827")
    page.locator('[data-profile-action="identity-save"]').click()
    page.wait_for_timeout(400)
    print("identity toast:", page.locator('[data-profile-toast]').text_content().strip())
    masked = page.evaluate("() => [...document.querySelectorAll('[data-profile-sidebar] p')].map((p) => p.textContent.trim())")
    print("masked contacts:", masked)
    welcome = page.evaluate("() => [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()).find((t) => t.includes('欢迎回来'))")
    print("welcome:", welcome)

    # switch tabs
    for tab in ["designs", "orders", "favorites", "addresses", "settings"]:
        page.locator(f'[data-profile-tab="{tab}"]').click()
        page.wait_for_timeout(300)
        panel = page.evaluate("() => document.querySelector('[data-profile-tab-panel]')?.getAttribute('data-profile-tab-panel')")
        count = page.evaluate(
            "() => document.querySelectorAll('[data-profile-design], [data-profile-order], [data-profile-favorite], [data-profile-address], [data-profile-section]').length"
        )
        print(f"tab {tab}: panel={panel} nodes={count}")

    # address add flow
    page.locator('[data-profile-tab="addresses"]').click()
    page.wait_for_timeout(200)
    page.locator('[data-profile-action="address-add"]').click()
    page.wait_for_timeout(200)
    page.locator('[data-profile-address-input="name"]').fill("陈言言")
    page.locator('[data-profile-address-input="phone"]').fill("13812349827")
    page.locator('[data-profile-address-input="region"]').fill("上海市 浦东新区")
    page.locator('[data-profile-address-input="detail"]').fill("张江高科技园区博云路2号")
    page.locator('[data-profile-action="address-save"]').click()
    page.wait_for_timeout(400)
    print("address toast:", page.locator('[data-profile-toast]').text_content().strip(), "| cards:", page.locator('[data-profile-address]').count())

    # feedback flow
    page.locator('[data-profile-tab="settings"]').click()
    page.wait_for_timeout(200)
    page.locator('[data-profile-feedback-input]').fill("希望支持按矿物筛选")
    page.locator('[data-profile-action="feedback-submit"]').click()
    page.wait_for_timeout(300)
    print("feedback toast:", page.locator('[data-profile-toast]').text_content().strip())

    # privacy toggle
    page.locator('[data-profile-privacy="DISPLAY_NAME"]').click()
    page.wait_for_timeout(300)
    print("privacy toast:", page.locator('[data-profile-toast]').text_content().strip())
    browser.close()
    print("done")
