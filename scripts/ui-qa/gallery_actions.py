from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BASE + "/gallery", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1200)
    before = page.locator('[data-gallery-card]').count()
    print("cards before:", before)

    # 1. clone first non-featured card's overlay clone button (featured overlay lacks delete)
    page.locator('[data-gallery-card]').nth(1).hover()
    page.wait_for_timeout(300)
    page.locator('[data-gallery-overlay] [data-gallery-action="clone"]').first.click()
    page.wait_for_timeout(2500)
    toast = page.locator('[data-gallery-toast]').text_content().strip() if page.locator('[data-gallery-toast]').count() else "(no toast)"
    after_clone = page.locator('[data-gallery-card]').count()
    print("clone toast:", toast, "| cards after clone:", after_clone)

    cloned = page.locator('[data-gallery-card]', has_text="副本").first
    print("cloned card id:", cloned.get_attribute("data-gallery-card"))

    # 2. desktop: hover second card, two-step delete is NOT for real data; skip.
    #    Instead exercise export on second card
    second = page.locator('[data-gallery-card]').nth(1)
    second.hover()
    page.wait_for_timeout(300)
    with page.expect_download(timeout=15000) as download_info:
        second.locator('[data-gallery-action="export"]').click()
    print("export download:", download_info.value.suggested_filename)

    # 3. delete the clone via mobile menu flow
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(BASE + "/gallery", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1200)
    mobile_clone = page.locator('[data-gallery-card]', has_text="副本").first
    mobile_clone.scroll_into_view_if_needed()
    mobile_clone.locator('[data-gallery-action="menu"]').click()
    page.wait_for_timeout(300)
    mobile_clone.locator('[data-gallery-menu] [data-gallery-action="delete"]').click()
    page.wait_for_timeout(300)
    confirm = page.locator('[data-gallery-menu] [data-gallery-action="delete-confirm"]')
    print("confirm visible:", confirm.count())
    confirm.click()
    page.wait_for_timeout(2500)
    toast2 = page.locator('[data-gallery-toast]').text_content().strip() if page.locator('[data-gallery-toast]').count() else "(no toast)"
    after_delete = page.locator('[data-gallery-card]').count()
    print("delete toast:", toast2, "| cards after delete:", after_delete)

    # 4. detail links
    hrefs = page.eval_on_selector_all('[data-gallery-card] h3 a', "els => els.slice(0,3).map(e => e.getAttribute('href'))")
    print("detail hrefs:", hrefs)
    browser.close()
    print("done")
