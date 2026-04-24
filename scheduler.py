from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
from typing import Callable, Optional
from utils.logger import Logger


class SyncScheduler:
    def __init__(self):
        self.scheduler = BackgroundScheduler()
        self.logger = Logger()
        self._job_id: Optional[str] = None
        self._next_run_time: Optional[datetime] = None

    def schedule_daily(self, time_str: str, callback: Callable[[], None]) -> bool:
        """设置每日定时任务"""
        try:
            # 如果已有任务，先移除
            self.remove_schedule()

            hour, minute = map(int, time_str.split(":"))

            # 添加定时任务
            self._job_id = f"daily_sync_{hour}_{minute}"
            job = self.scheduler.add_job(
                callback,
                trigger=CronTrigger(hour=hour, minute=minute),
                id=self._job_id,
                name="每日同步任务"
            )

            self._next_run_time = job.next_run_time
            self.logger.info(f"已设置每日同步时间: {time_str}")
            self.logger.info(f"下次执行时间: {self._next_run_time.strftime('%Y-%m-%d %H:%M:%S')}")

            return True

        except Exception as e:
            self.logger.error(f"设置定时任务失败: {e}")
            return False

    def run_now(self, callback: Callable[[], None]) -> bool:
        """立即执行一次"""
        try:
            callback()
            return True

        except Exception as e:
            self.logger.error(f"立即执行失败: {e}")
            return False

    def remove_schedule(self) -> bool:
        """移除定时任务"""
        try:
            if self._job_id and self.scheduler.get_job(self._job_id):
                self.scheduler.remove_job(self._job_id)
                self.logger.info("已移除定时任务")
                self._job_id = None
                self._next_run_time = None
            return True

        except Exception as e:
            self.logger.error(f"移除定时任务失败: {e}")
            return False

    def start(self):
        """启动调度器"""
        if not self.scheduler.running:
            self.scheduler.start()
            self.logger.info("调度器已启动")

    def shutdown(self):
        """关闭调度器"""
        if self.scheduler.running:
            self.scheduler.shutdown()
            self.logger.info("调度器已关闭")

    @property
    def next_run_time(self) -> Optional[str]:
        """获取下次执行时间"""
        if self._next_run_time:
            return self._next_run_time.strftime("%Y-%m-%d %H:%M:%S")
        return None

    @property
    def is_running(self) -> bool:
        """检查调度器是否运行"""
        return self.scheduler.running

    @property
    def has_schedule(self) -> bool:
        """检查是否有定时任务"""
        return self._job_id is not None and self.scheduler.get_job(self._job_id) is not None
