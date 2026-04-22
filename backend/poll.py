"""
GitHub Actions 调用入口：抓取电费数据并追加到 data/history.json
"""
import json
import os
import sys

# 确保从项目根目录导入
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.scraper import fetch_electricity
from backend.config import HISTORY_JSON, MAX_RECORDS


def main():
    print("开始抓取电费数据...")
    data = fetch_electricity()
    print(f"抓取成功: {data}")

    # 读取现有记录
    if os.path.exists(HISTORY_JSON):
        with open(HISTORY_JSON, "r", encoding="utf-8") as f:
            history = json.load(f)
    else:
        history = []
        os.makedirs(os.path.dirname(HISTORY_JSON), exist_ok=True)

    # 追加新记录（避免相同时间戳重复写入）
    if not history or history[-1]["ts"] != data["ts"]:
        history.append(data)
        print(f"追加新记录，当前共 {len(history)} 条")
    else:
        print(f"时间戳相同，跳过写入（{data['ts']}）")

    # 保留最近 MAX_RECORDS 条
    if len(history) > MAX_RECORDS:
        history = history[-MAX_RECORDS:]

    with open(HISTORY_JSON, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, separators=(",", ":"))

    print(f"数据已写入 {HISTORY_JSON}")


if __name__ == "__main__":
    main()
