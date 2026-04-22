import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BUPT_USERNAME = os.environ.get("BUPT_USERNAME", "")
BUPT_PASSWORD = os.environ.get("BUPT_PASSWORD", "")
HISTORY_JSON = os.environ.get("HISTORY_JSON", "data/history.json")
MAX_RECORDS = 26280  # 约 1 年数据（每 20 分钟一条）

ELEC_URL = "https://app.bupt.edu.cn/buptdf/wap/default/chong"

CAMPUS = "西土城"
APARTMENT = "学十楼"
FLOOR = "8楼"
ROOM = "10-846"
