import os
from dotenv import load_dotenv

load_dotenv()

BUPT_USERNAME = os.getenv("BUPT_USERNAME")
BUPT_PASSWORD = os.getenv("BUPT_PASSWORD")
DB_PATH = os.getenv("DB_PATH", "backend/data/elecmon.db")
POLL_INTERVAL_MINUTES = int(os.getenv("POLL_INTERVAL_MINUTES", 20))

ELEC_URL = "https://app.bupt.edu.cn/buptdf/wap/default/chong"
AUTH_URL = "https://auth.bupt.edu.cn/authserver/login"

CAMPUS = "西土城"
APARTMENT = "学十楼"
FLOOR = "8楼"
ROOM = "10-846"
