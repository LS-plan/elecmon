import re
import logging
from playwright.sync_api import sync_playwright
from backend.config import (
    BUPT_USERNAME, BUPT_PASSWORD, ELEC_URL,
    CAMPUS, APARTMENT, FLOOR, ROOM
)

logger = logging.getLogger(__name__)


def _login_if_needed(page):
    if "authserver/login" not in page.url:
        return

    page.wait_for_load_state("networkidle", timeout=20000)
    # 密码登录表单在 #default div 内，默认被隐藏（另一个 tab 覆盖）
    # 直接通过 JS 强制显示，避免依赖 tab 点击动画
    page.evaluate("document.getElementById('default').style.display = 'block'")
    page.fill("[name=username]", BUPT_USERNAME)
    page.fill("[name=password]", BUPT_PASSWORD)
    page.click("[name=submit]")
    page.wait_for_url(lambda url: "authserver/login" not in url, timeout=20000)
    logger.info("登录成功")


def fetch_electricity() -> dict:
    """
    登录北邮门户，选择宿舍，返回电费数据。
    返回格式: {"ts": "2026-04-22 12:54:25", "remaining": 78.91, "gift": 0.0}
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        page.goto(ELEC_URL, timeout=30000)
        page.wait_for_load_state("networkidle", timeout=20000)
        _login_if_needed(page)

        # 登录后等待跳回电费页并渲染完成
        page.wait_for_load_state("networkidle", timeout=20000)
        # 等待 select 元素加载
        page.wait_for_selector("select", timeout=30000)
        page.wait_for_timeout(1000)

        selects = page.query_selector_all("select")
        if len(selects) < 4:
            raise RuntimeError(f"未找到足够的 select 元素，实际数量: {len(selects)}")

        # 依次选择：校区 → 公寓 → 楼层 → 宿舍
        selects[0].select_option(label=CAMPUS)
        page.wait_for_timeout(1200)

        selects = page.query_selector_all("select")
        selects[1].select_option(label=APARTMENT)
        page.wait_for_timeout(1200)

        selects = page.query_selector_all("select")
        selects[2].select_option(label=FLOOR)
        page.wait_for_timeout(1200)

        selects = page.query_selector_all("select")
        selects[3].select_option(label=ROOM)
        page.wait_for_timeout(1500)

        # 等待结果出现
        page.wait_for_selector(".search_bottom", timeout=20000)

        result_div = page.query_selector(".search_bottom")
        items = result_div.query_selector_all("li span:last-child")

        ts = items[0].inner_text().strip() if len(items) > 0 else ""
        remaining_text = items[1].inner_text().strip() if len(items) > 1 else "0"
        gift_text = items[3].inner_text().strip() if len(items) > 3 else "0"

        remaining = float(re.sub(r"[^\d.]", "", remaining_text) or 0)
        gift = float(re.sub(r"[^\d.]", "", gift_text) or 0)

        browser.close()
        logger.info(f"抓取成功: ts={ts}, remaining={remaining}, gift={gift}")
        return {"ts": ts, "remaining": remaining, "gift": gift}
