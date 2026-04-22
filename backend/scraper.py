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
        page.wait_for_load_state("networkidle", timeout=20000)

        # 等待自定义下拉组件加载（页面用 .search_select div + ul/li，无 <select>）
        page.wait_for_selector(".search_list", timeout=20000)

        def pick(index: int, label: str):
            """点击第 index 个下拉框，选择文本为 label 的 li"""
            lists = page.query_selector_all(".search_list")
            # 打开下拉
            lists[index].query_selector(".search_select").click()
            page.wait_for_timeout(600)
            # 等待对应 li 出现（级联 AJAX 场景）
            page.wait_for_function(
                f"""() => {{
                    const lis = document.querySelectorAll('.search_list')[{index}]
                        .querySelectorAll('li');
                    return Array.from(lis).some(li => li.textContent.trim() === '{label}');
                }}""",
                timeout=15000,
            )
            lists = page.query_selector_all(".search_list")
            lis = lists[index].query_selector_all("li")
            for li in lis:
                if li.inner_text().strip() == label:
                    li.click()
                    return
            raise RuntimeError(f"下拉[{index}]未找到选项: {label}")

        # 校区已默认"西土城"，直接从公寓开始选
        pick(1, APARTMENT)
        page.wait_for_timeout(1200)
        pick(2, FLOOR)
        page.wait_for_timeout(1200)
        pick(3, ROOM)
        page.wait_for_timeout(800)

        # 点击查询按钮触发 AJAX 请求
        page.click(".search_btn")

        # 等待结果区域出现且数据已填充（span 内含有数字才算就绪）
        page.wait_for_function(
            "() => {"
            "  const d = document.querySelector('.search_bottom');"
            "  if (!d || getComputedStyle(d).display === 'none') return false;"
            "  const spans = d.querySelectorAll('li span:last-child');"
            "  return spans.length > 1 && /\\d/.test(spans[1].textContent);"
            "}",
            timeout=20000,
        )

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
