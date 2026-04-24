import sys
import traceback
from PyQt6.QtWidgets import QApplication, QMessageBox
from PyQt6.QtCore import QTimer
from config_manager import ConfigManager
from git_service import GitService
from scheduler import SyncScheduler
from gui.main_window import MainWindow
from utils.logger import Logger


def handle_exception(exc_type, exc_value, exc_traceback):
    """全局异常处理器"""
    error_msg = ''.join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    print(f"发生异常:\n{error_msg}")

    try:
        # 尝试显示错误对话框
        app = QApplication.instance()
        if app:
            msg_box = QMessageBox()
            msg_box.setWindowTitle("错误")
            msg_box.setText(f"程序发生错误:\n{exc_value}")
            msg_box.setDetailedText(error_msg)
            msg_box.exec()
    except Exception as e:
        print(f"无法显示错误对话框: {e}")


# 设置全局异常处理器
sys.excepthook = handle_exception


class GitSyncApp:
    def __init__(self):
        self.app = QApplication(sys.argv)
        self.config = ConfigManager()
        self.logger = Logger()
        self.git_service = GitService(self.config)
        self.scheduler = SyncScheduler()

        print("正在创建主窗口...")
        self.window = MainWindow(self.config)
        self.window.set_sync_callback(self.perform_sync)
        self.window.set_next_sync_time(self.scheduler.next_run_time)

        # 启动调度器
        print("正在启动调度器...")
        self.scheduler.start()

        # 如果有配置，设置定时任务
        if self.config.is_configured:
            print("配置存在，设置定时任务...")
            self.setup_schedule()

        print("显示窗口...")
        self.window.show()

    def setup_schedule(self):
        """设置定时任务"""
        try:
            print(f"设置每日同步时间: {self.config.sync_time}")
            if self.scheduler.schedule_daily(
                self.config.sync_time,
                self.perform_sync
            ):
                self.window.set_next_sync_time(self.scheduler.next_run_time)
        except Exception as e:
            print(f"设置定时任务失败: {e}")
            traceback.print_exc()

    def perform_sync(self):
        """执行同步"""
        print("开始执行同步...")
        self.window.set_syncing(True)

        try:
            print("调用git_service.sync()...")
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
            traceback.print_exc()

        finally:
            self.window.set_syncing(False)

    def run(self):
        """运行应用"""
        return self.app.exec()

    def cleanup(self):
        """清理资源"""
        print("清理资源...")
        self.scheduler.shutdown()


def main():
    print("程序启动...")
    try:
        app = GitSyncApp()

        # 确保在退出时清理
        app.app.aboutToQuit.connect(app.cleanup)

        print("程序运行中...")
        sys.exit(app.run())
    except Exception as e:
        print(f"程序启动失败: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
