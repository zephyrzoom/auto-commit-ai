from PyQt6.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QTextEdit, QMessageBox,
    QProgressBar, QGroupBox, QFormLayout
)
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QTextCursor, QColor
from gui.config_dialog import ConfigDialog
from utils.logger import Logger, LogEntry, LogLevel
from typing import Optional, Callable


class MainWindow(QMainWindow):
    def __init__(self, config, parent=None):
        super().__init__(parent)
        self.config = config
        self.logger = Logger()
        self._sync_callback: Optional[Callable] = None

        self.init_ui()
        self.connect_logger()
        self.update_status()

    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("Git 同步工具")
        self.setMinimumSize(800, 600)

        # 主窗口部件
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout()
        central_widget.setLayout(main_layout)

        # 状态信息区域
        status_group = QGroupBox("状态信息")
        status_layout = QFormLayout()
        status_group.setLayout(status_layout)
        main_layout.addWidget(status_group)

        self.last_sync_label = QLabel("从未同步")
        self.next_sync_label = QLabel("未设置定时任务")
        status_layout.addRow("上次同步:", self.last_sync_label)
        status_layout.addRow("下次同步:", self.next_sync_label)

        # 按钮区域
        button_layout = QHBoxLayout()

        self.sync_now_button = QPushButton("立即同步")
        self.sync_now_button.setMinimumHeight(40)
        self.sync_now_button.clicked.connect(self.on_sync_now)
        button_layout.addWidget(self.sync_now_button)

        self.config_button = QPushButton("配置")
        self.config_button.setMinimumHeight(40)
        self.config_button.clicked.connect(self.show_config_dialog)
        button_layout.addWidget(self.config_button)

        main_layout.addLayout(button_layout)

        # 进度条
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        main_layout.addWidget(self.progress_bar)

        # 日志区域
        log_group = QGroupBox("日志")
        log_layout = QVBoxLayout()
        log_group.setLayout(log_layout)
        main_layout.addWidget(log_group)

        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setMinimumHeight(300)
        log_layout.addWidget(self.log_text)

        # 清空日志按钮
        clear_log_button = QPushButton("清空日志")
        clear_log_button.clicked.connect(self.clear_logs)
        log_layout.addWidget(clear_log_button)

    def connect_logger(self):
        """连接日志信号"""
        self.logger.log_added.connect(self.add_log)

    def add_log(self, entry: LogEntry):
        """添加日志到界面"""
        cursor = self.log_text.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)

        # 根据日志级别设置颜色
        color_map = {
            LogLevel.INFO: QColor("#333"),
            LogLevel.WARNING: QColor("#FFA500"),
            LogLevel.ERROR: QColor("#DC143C"),
            LogLevel.SUCCESS: QColor("#228B22"),
        }

        color = color_map.get(entry.level, QColor("#333"))
        char_format = cursor.charFormat()
        char_format.setForeground(color)
        cursor.setCharFormat(char_format)
        cursor.insertText(str(entry) + "\n")

        self.log_text.setTextCursor(cursor)
        self.log_text.ensureCursorVisible()

    def clear_logs(self):
        """清空日志"""
        self.log_text.clear()
        self.logger.clear()

    def update_status(self):
        """更新状态信息"""
        self.last_sync_label.setText(self.config.last_sync_time)

        # 更新下次同步时间（需要外部设置）
        # 这里只是更新上次同步时间

    def set_next_sync_time(self, time_str: str):
        """设置下次同步时间"""
        self.next_sync_label.setText(time_str if time_str else "未设置定时任务")

    def show_config_dialog(self):
        """显示配置对话框"""
        dialog = ConfigDialog(self.config, self)
        dialog.set_config_saved_callback(self.on_config_saved)
        dialog.exec()

    def on_config_saved(self):
        """配置保存后的处理"""
        self.update_status()
        self.logger.success("配置已更新，请检查并测试连接")

    def on_sync_now(self):
        """立即同步"""
        if not self.config.is_configured:
            QMessageBox.warning(
                self,
                "未配置",
                "请先完成配置后再进行同步。"
            )
            self.show_config_dialog()
            return

        if self._sync_callback:
            self._sync_callback()

    def set_sync_callback(self, callback: Callable):
        """设置同步回调函数"""
        self._sync_callback = callback

    def set_syncing(self, syncing: bool):
        """设置同步状态"""
        self.sync_now_button.setEnabled(not syncing)
        self.config_button.setEnabled(not syncing)
        self.progress_bar.setVisible(syncing)

        if syncing:
            self.progress_bar.setRange(0, 0)  # 无限进度条
        else:
            self.progress_bar.setRange(0, 1)
            self.progress_bar.setValue(1)

    def show_sync_result(self, success: bool, message: str):
        """显示同步结果"""
        if success:
            self.logger.success(message)
            QMessageBox.information(self, "同步完成", message)
        else:
            self.logger.error(message)
            QMessageBox.critical(self, "同步失败", message)

        self.update_status()
