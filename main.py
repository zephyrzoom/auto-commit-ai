import sys
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QTimer
from config_manager import ConfigManager
from git_service import GitService
from scheduler import SyncScheduler
from gui.main_window import MainWindow
from utils.logger import Logger


class GitSyncApp:
    def __init__(self):
        self.app = QApplication(sys.argv)
        self.config = ConfigManager()
        self.logger = Logger()
        self.git_service = GitService(self.config)
        self.scheduler = SyncScheduler()

        self.window = MainWindow(self.config)
        self.window.set_sync_callback(self.perform_sync)
        self.window.set_next_sync_time(self.scheduler.next_run_time)

        # 启动调度器
        self.scheduler.start()

        # 如果有配置，设置定时任务
        if self.config.is_configured:
            self.setup_schedule()

        self.window.show()

    def setup_schedule(self):
        """设置定时任务"""
        if self.scheduler.schedule_daily(
            self.config.sync_time,
            self.perform_sync
        ):
            self.window.set_next_sync_time(self.scheduler.next_run_time)

    def perform_sync(self):
        """执行同步"""
        self.window.set_syncing(True)

        try:
            success = self.git_service.sync()

            if success:
                message = f"同步完成！\n上次同步: {self.config.last_sync_time}"
                self.window.show_sync_result(True, message)
            else:
                message = "同步过程中出现错误，请查看日志。"
                self.window.show_sync_result(False, message)

        except Exception as e:
            message = f"同步失败: {e}"
            self.window.show_sync_result(False, message)
            self.logger.error(message)

        finally:
            self.window.set_syncing(False)

    def run(self):
        """运行应用"""
        return self.app.exec()

    def cleanup(self):
        """清理资源"""
        self.scheduler.shutdown()


def main():
    app = GitSyncApp()

    # 确保在退出时清理
    app.app.aboutToQuit.connect(app.cleanup)

    sys.exit(app.run())


if __name__ == "__main__":
    main()
