"""端到端交互验收：AI / 塔罗 / DIY / 商品库 / 画廊 / 个人中心 全流程。

前置：前端 http://localhost:3000，后端 http://localhost:4000 均已启动。
输出：终端 PASS/FAIL 报告 + artifacts/e2e/ 关键节点截图。
"""
import os
import sys
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:3000"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts", "e2e")
os.makedirs(OUT, exist_ok=True)

results = []


def report(step, ok, detail=""):
    results.append((step, ok, detail))
    print(("PASS" if ok else "FAIL"), "|", step, "|", detail, flush=True)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name), full_page=False)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.on("dialog", lambda dialog: dialog.accept())
    page = ctx.new_page()
    page.set_default_timeout(30000)

    # ---------- 1. 首页 ----------
    try:
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector('[data-atelier-surface="home"]', timeout=10000)
        paths = page.locator('[data-creation-path]').count()
        report("home/creation-cards", paths == 3, f"cards={paths}")
        shot(page, "01-home.png")
    except Exception as exc:
        report("home/creation-cards", False, repr(exc))

    # ---------- 2. AI 设计流程 ----------
    ai_design_id = None
    try:
        page.goto(BASE + "/ai-design", wait_until="networkidle")
        page.wait_for_selector('[data-atelier-surface="questionnaire"]', timeout=10000)
        for _ in range(5):  # state/color/style/budget + wrist + culture 由内容判断
            step_title = page.locator("#question-title").text_content() or ""
            if "手围" in step_title:
                page.fill("#wrist", "155")
            else:
                page.locator('[role="radio"]').first.click()
            next_btn = page.locator("button", has_text="继续").first
            if next_btn.count():
                next_btn.click()
                page.wait_for_timeout(400)
        # 最后一步（culture）→ 生成设计
        page.locator('[role="radio"]').first.click()
        page.locator("button", has_text="生成设计").click()
        page.wait_for_selector('[data-results-layout]', timeout=60000)
        page.wait_for_timeout(800)
        options = page.locator("[data-option-index]").count()
        report("ai/generate", options >= 1, f"schemes={options}")
        page.locator("button", has_text="选择此方案").first.click()
        page.wait_for_timeout(400)
        with page.expect_navigation(timeout=30000):
            page.locator("a", has_text="进入 DIY 调整").click()
        page.wait_for_selector('[data-diy-editor-page="true"]', timeout=30000)
        ai_design_id = page.url.rsplit("/", 1)[-1]
        report("ai/enter-diy", page.url.startswith(BASE + "/diy/"), f"id={ai_design_id}")
        shot(page, "02-ai-diy.png")
    except Exception as exc:
        report("ai/flow", False, repr(exc))

    # ---------- 3. 塔罗流程 ----------
    tarot_design_id = None
    try:
        page.goto(BASE + "/tarot/setup", wait_until="networkidle")
        page.wait_for_selector('[data-tarot-setup-panel="theme"]', timeout=10000)
        page.fill("#tarot-question", "验收脚本：如何整理接下来的方向？")
        page.locator('[data-tarot-spread-options] label:has(input)').nth(1).click()  # 三张牌阵
        page.locator('[data-tarot-setup-submit="true"]').click()
        page.wait_for_url("**/tarot/draw/**", timeout=30000)
        page.wait_for_selector('[data-tarot-draw-layout]', timeout=10000)
        page.wait_for_timeout(800)
        cards = page.locator('[data-tarot-row] button[aria-label*="选择第"]')
        report("tarot/draw-page", cards.count() > 0, f"fan cards={cards.count()}")
        for i in range(3):
            page.locator('[data-tarot-row] button[aria-label*="选择第"]').first.click()
            page.wait_for_timeout(1200)
        reveal = page.locator("button", has_text="查看解读")
        reveal.click()
        page.wait_for_url("**/tarot/result/**", timeout=30000)
        page.wait_for_selector('[data-results-layout]', timeout=30000)
        report("tarot/result", True, page.url)
        page.locator("button", has_text="保存本次设计").click()
        page.wait_for_timeout(2500)
        saved = page.locator("button", has_text="已保存本次设计").count()
        report("tarot/save", saved == 1, "saved badge shown")
        page.locator("button", has_text="选择方案并进入 DIY").click()
        page.wait_for_url("**/diy/**", timeout=30000)
        page.wait_for_selector('[data-diy-editor-page="true"]', timeout=30000)
        tarot_design_id = page.url.rsplit("/", 1)[-1]
        report("tarot/enter-diy", True, f"id={tarot_design_id}")
        shot(page, "03-tarot-diy.png")
    except Exception as exc:
        report("tarot/flow", False, repr(exc))

    # ---------- 4. DIY 编辑 + 保存 + 下单 ----------
    order_id = None
    try:
        if tarot_design_id or ai_design_id:
            page.goto(BASE + "/diy/" + (tarot_design_id or ai_design_id), wait_until="networkidle")
        else:
            page.goto(BASE + "/diy", wait_until="networkidle")
        page.wait_for_selector('[data-diy-editor-page="true"]', timeout=30000)
        page.wait_for_timeout(1200)
        add_btn = page.locator('[data-desktop-catalog-grid] button[aria-label^="加入"]').first
        add_btn.click()
        page.wait_for_timeout(1500)
        count_after_add = page.locator('[data-component-id]').count()
        report("diy/add-bead", count_after_add > 0, f"beads={count_after_add}")
        page.locator("button", has_text="保存设计").first.click()
        page.wait_for_timeout(2500)
        saved = page.locator("button", has_text="已保存").count()
        report("diy/save", saved >= 1, "saved state visible")
        page.locator("button", has_text="完成设计").first.click()
        page.wait_for_selector('[data-desktop-diy-workspace] [data-order-id]', state="visible", timeout=30000)
        order_id = page.locator('[data-desktop-diy-workspace] [data-order-id]').first.get_attribute("data-order-id")
        report("diy/create-order", bool(order_id), f"orderId={order_id}")
        shot(page, "04-diy-order.png")
    except Exception as exc:
        report("diy/flow", False, repr(exc))

    # ---------- 5. 水晶商品库 ----------
    try:
        page.goto(BASE + "/crystal-library", wait_until="networkidle")
        page.wait_for_selector('[data-library-page="ready"]', timeout=30000)
        cards_before = page.locator("[data-library-card]").count()
        fav = page.locator('[data-library-card] button[aria-label^="收藏"]').first
        fav.scroll_into_view_if_needed()
        fav.click()
        page.wait_for_timeout(600)
        stored = page.evaluate("() => window.localStorage.getItem('mystcrag:library-favorites')")
        report("library/favorite", bool(stored and stored != "[]"), f"storage={stored}")
        # 品类切换
        page.locator('[data-library-filters="desktop"] [aria-label="商品品类"] button').nth(2).click()
        page.wait_for_timeout(800)
        grid_type = page.locator('[data-library-grid]').first.get_attribute("data-library-grid")
        report("library/type-filter", grid_type == "ACCESSORY", f"grid={grid_type}")
        shot(page, "05-library.png")
    except Exception as exc:
        report("library/flow", False, repr(exc))

    # ---------- 6. 作品画廊 ----------
    try:
        page.goto(BASE + "/gallery", wait_until="networkidle")
        page.wait_for_selector('[data-gallery-page="ready"]', timeout=30000)
        all_count = page.locator("[data-gallery-card]").count()
        page.locator('[data-gallery-filter="TAROT_INSPIRED"], button:has-text("塔罗灵感")').first.click()
        page.wait_for_timeout(800)
        tarot_count = page.locator("[data-gallery-card]").count()
        hrefs = page.eval_on_selector_all('[data-gallery-card] h3 a', "els => els.slice(0,2).map(e => e.getAttribute('href'))")
        report("gallery/filter+detail", all_count >= 1 and len(hrefs) >= 1,
               f"all={all_count} tarot={tarot_count} hrefs={hrefs}")
        shot(page, "06-gallery.png")
    except Exception as exc:
        report("gallery/flow", False, repr(exc))

    # ---------- 7. 个人中心 ----------
    try:
        page.goto(BASE + "/profile", wait_until="networkidle")
        page.wait_for_selector('[data-profile-page="ready"]', timeout=30000)
        page.locator('[data-profile-action="orders-tab"]').click()
        page.wait_for_timeout(600)
        orders = page.locator("[data-profile-order]").count()
        report("profile/orders", orders >= 1, f"orders={orders}")
        # 偏好编辑保存（设置页签，桌面侧栏）
        page.locator('[data-profile-tab="settings"]').click()
        page.wait_for_timeout(600)
        page.locator('[data-profile-action="pref-edit"]').first.click()
        page.wait_for_timeout(300)
        page.locator('[data-profile-pref-input="wrist"]').fill("160")
        page.locator('[data-profile-action="pref-save"]').click()
        page.wait_for_timeout(800)
        pref_saved = page.evaluate("() => window.localStorage.getItem('mystcrag:profile-preferences')")
        report("profile/preferences", "160" in (pref_saved or ""), f"storage={pref_saved}")
        # 身份资料（设置页签内）
        page.locator('[data-profile-action="identity-edit"]').first.click()
        page.wait_for_timeout(300)
        page.locator('[data-profile-identity-input="name"]').fill("验收用户")
        page.locator('[data-profile-action="identity-save"]').click()
        page.wait_for_timeout(600)
        identity = page.evaluate("() => window.localStorage.getItem('mystcrag:profile-identity')")
        report("profile/identity", "验收用户" in (identity or ""), f"storage={identity}")
        # 地址簿（地址页签）
        page.locator('[data-profile-tab="addresses"]').click()
        page.wait_for_timeout(600)
        page.locator('[data-profile-action="address-add"]').click()
        page.wait_for_timeout(300)
        inputs = page.locator('[data-profile-address-input]')
        for i in range(inputs.count()):
            inputs.nth(i).fill(f"测试地址{i + 1}号")
        page.locator('[data-profile-action="address-save"]').click()
        page.wait_for_timeout(600)
        addresses = page.locator("[data-profile-address]").count()
        report("profile/address", addresses >= 1, f"addresses={addresses}")
        shot(page, "07-profile.png")
    except Exception as exc:
        report("profile/flow", False, repr(exc))

    # ---------- 8. 移动端底部导航 ----------
    try:
        mob = ctx.new_page()
        mob.set_viewport_size({"width": 390, "height": 844})
        mob.goto(BASE + "/", wait_until="networkidle")
        mob.wait_for_selector('[data-mobile-bottom-nav="true"]', timeout=10000)
        items = mob.locator('[data-mobile-bottom-nav="true"] li').count()
        report("mobile/bottom-nav", items == 5, f"items={items}")
        mob.locator('[data-mobile-bottom-nav="true"] a:has-text("作品画廊")').click()
        mob.wait_for_url("**/gallery", timeout=15000)
        report("mobile/nav-goto-gallery", True)
        mob.screenshot(path=os.path.join(OUT, "08-mobile-gallery.png"))
        mob.close()
    except Exception as exc:
        report("mobile/flow", False, repr(exc))

    browser.close()

failed = [r for r in results if not r[1]]
print("\n===== SUMMARY =====")
print(f"total={len(results)} pass={len(results) - len(failed)} fail={len(failed)}")
for step, _, detail in failed:
    print("FAILED:", step, "|", detail)
print("screenshots:", OUT)
sys.exit(1 if failed else 0)
