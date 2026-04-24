from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLineEdit, QTimeEdit, QPushButton, QLabel,
    QMessageBox, QDialogButtonBox
)
from PyQt6.QtCore import Qt, QTime, QRegularExpression
from PyQt6.QtGui import QRegularExpressionValidator
from typing import Optional, Callable


class ConfigDialog(QDialog):
    def __init__(self, config, parent=None):
        super().__init__(parent)
        self.config = config
        self._on_config_saved: Optional[Callable] = None
        self.init_ui()
        self.load_config()

    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("配置")
        self.setMinimumWidth(400)

        layout = QVBoxLayout()
        form_layout = QFormLayout()

        # Git仓库URL
        self.repo_url_input = QLineEdit()
        self.repo_url_input.setPlaceholderText("https://github.com/username/repo.git")
        form_layout.addRow("仓库URL*:", self.repo_url_input)

        # 用户名
        self.username_input = QLineEdit()
        form_layout.addRow("用户名*:", self.username_input)

        # 密码
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        form_layout.addRow("密码*:", self.password_input)

        # 源分支
        self.source_branch_input = QLineEdit()
        self.source_branch_input.setText("main")
        form_layout.addRow("源分支:", self.source_branch_input)

        # 目标分支
        self.target_branch_input = QLineEdit()
        self.target_branch_input.setText("my-sync-branch")
        form_layout.addRow("目标分支*:", self.target_branch_input)

        # 用户姓名
        self.user_name_input = QLineEdit()
        form_layout.addRow("您的姓名*:", self.user_name_input)

        # 用户邮箱
        self.user_email_input = QLineEdit()
        user_email_validator = QRegularExpressionValidator(
            QRegularExpression(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
        )
        self.user_email_input.setValidator(user_email_validator)
        form_layout.addRow("您的邮箱*:", self.user_email_input)

        # 同步时间
        self.sync_time_input = QTimeEdit()
        self.sync_time_input.setDisplayFormat("HH:mm")
        self.sync_time_input.setTime(QTime(0, 0))
        form_layout.addRow("每日同步时间:", self.sync_time_input)

        layout.addLayout(form_layout)

        # 说明标签
        info_label = QLabel(
            "<b>说明：</b><br>"
            "• 标有 * 的为必填项<br>"
            "• 目标分支将包含同步后的所有提交<br>"
            "• 每次同步将强制覆盖目标分支"
        )
        info_label.setWordWrap(True)
        info_label.setStyleSheet("color: #666; font-size: 11px;")
        layout.addWidget(info_label)

        # 按钮
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save |
            QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.save_config)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.setLayout(layout)

    def load_config(self):
        """加载配置到UI"""
        self.repo_url_input.setText(self.config.repo_url)
        self.username_input.setText(self.config.username)
        self.password_input.setText(self.config.password)
        self.source_branch_input.setText(self.config.source_branch)
        self.target_branch_input.setText(self.config.target_branch)
        self.user_name_input.setText(self.config.user_name)
        self.user_email_input.setText(self.config.user_email)

        # 加载同步时间
        try:
            hour, minute = map(int, self.config.sync_time.split(":"))
            self.sync_time_input.setTime(QTime(hour, minute))
        except (ValueError, AttributeError):
            self.sync_time_input.setTime(QTime(0, 0))

    def save_config(self):
        """保存配置"""
        # 验证必填字段
        required_fields = {
            "仓库URL": self.repo_url_input.text(),
            "用户名": self.username_input.text(),
            "密码": self.password_input.text(),
            "目标分支": self.target_branch_input.text(),
            "您的姓名": self.user_name_input.text(),
            "您的邮箱": self.user_email_input.text(),
        }

        empty_fields = [name for name, value in required_fields.items() if not value.strip()]

        if empty_fields:
            QMessageBox.warning(
                self,
                "验证失败",
                f"以下字段不能为空：\n{', '.join(empty_fields)}"
            )
            return

        # 验证邮箱格式
        if not self.user_email_input.hasAcceptableInput():
            QMessageBox.warning(self, "验证失败", "请输入有效的邮箱地址")
            return

        # 保存配置
        self.config.repo_url = self.repo_url_input.text().strip()
        self.config.username = self.username_input.text().strip()
        self.config.password = self.password_input.text()
        self.config.source_branch = self.source_branch_input.text().strip() or "main"
        self.config.target_branch = self.target_branch_input.text().strip()
        self.config.user_name = self.user_name_input.text().strip()
        self.config.user_email = self.user_email_input.text().strip()

        # 保存同步时间
        time = self.sync_time_input.time()
        self.config.sync_time = time.toString("HH:mm")

        self.config.sync()

        QMessageBox.information(self, "成功", "配置已保存！")

        # 回调
        if self._on_config_saved:
            self._on_config_saved()

        self.accept()

    def set_config_saved_callback(self, callback: Callable):
        """设置配置保存后的回调"""
        self._on_config_saved = callback
