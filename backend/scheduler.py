import logging
from apscheduler.schedulers.background import BackgroundScheduler
from backend.scraper import fetch_electricity
from backend.database import insert_reading, init_db
from backend.config import POLL_INTERVAL_MINUTES

logger = logging.getLogger(__name__)


def poll_once():
    try:
        data = fetch_electricity()
        insert_reading(data["ts"], data["remaining"], data["gift"])
        logger.info(f"采集成功: {data}")
    except Exception as e:
        logger.error(f"采集失败: {e}", exc_info=True)


def start_scheduler() -> BackgroundScheduler:
    init_db()
    poll_once()  # 启动时立即执行一次
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        poll_once,
        "interval",
        minutes=POLL_INTERVAL_MINUTES,
        id="elec_poll",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(f"调度器已启动，每 {POLL_INTERVAL_MINUTES} 分钟采集一次")
    return scheduler
