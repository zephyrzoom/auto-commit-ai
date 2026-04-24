from PyQt6.QtCore import QSettings
from cryptography.fernet import Fernet
import base64
import os


class ConfigManager:
    def __init__(self):
        self.settings = QSettings("AutoCommit", "GitSync")
        self._init_encryption()

    def _init_encryption(self):
        """初始化加密密钥"""
        key = self.settings.value("encryption_key")
        if not key:
            key = Fernet.generate_key()
            self.settings.setValue("encryption_key", key)
        self.cipher = Fernet(key)

    def _encrypt(self, text: str) -> str:
        """加密文本"""
        if not text:
            return ""
        encrypted = self.cipher.encrypt(text.encode())
        return base64.b64encode(encrypted).decode()

    def _decrypt(self, encrypted_text: str) -> str:
        """解密文本"""
        if not encrypted_text:
            return ""
        try:
            encrypted = base64.b64decode(encrypted_text.encode())
            decrypted = self.cipher.decrypt(encrypted)
            return decrypted.decode()
        except Exception:
            return ""

    @property
    def repo_url(self) -> str:
        return self.settings.value("repo_url", "", str)

    @repo_url.setter
    def repo_url(self, value: str):
        self.settings.setValue("repo_url", value)

    @property
    def username(self) -> str:
        return self.settings.value("username", "", str)

    @username.setter
    def username(self, value: str):
        self.settings.setValue("username", value)

    @property
    def password(self) -> str:
        encrypted = self.settings.value("password", "", str)
        return self._decrypt(encrypted)

    @password.setter
    def password(self, value: str):
        self.settings.setValue("password", self._encrypt(value))

    @property
    def target_branch(self) -> str:
        return self.settings.value("target_branch", "my-sync-branch", str)

    @target_branch.setter
    def target_branch(self, value: str):
        self.settings.setValue("target_branch", value)

    @property
    def source_branch(self) -> str:
        return self.settings.value("source_branch", "main", str)

    @source_branch.setter
    def source_branch(self, value: str):
        self.settings.setValue("source_branch", value)

    @property
    def user_name(self) -> str:
        return self.settings.value("user_name", "", str)

    @user_name.setter
    def user_name(self, value: str):
        self.settings.setValue("user_name", value)

    @property
    def user_email(self) -> str:
        return self.settings.value("user_email", "", str)

    @user_email.setter
    def user_email(self, value: str):
        self.settings.setValue("user_email", value)

    @property
    def sync_time(self) -> str:
        return self.settings.value("sync_time", "00:00", str)

    @sync_time.setter
    def sync_time(self, value: str):
        self.settings.setValue("sync_time", value)

    @property
    def last_sync_hash(self) -> str:
        return self.settings.value("last_sync_hash", "", str)

    @last_sync_hash.setter
    def last_sync_hash(self, value: str):
        self.settings.setValue("last_sync_hash", value)

    @property
    def last_sync_time(self) -> str:
        return self.settings.value("last_sync_time", "从未同步", str)

    @last_sync_time.setter
    def last_sync_time(self, value: str):
        self.settings.setValue("last_sync_time", value)

    @property
    def is_configured(self) -> bool:
        """检查配置是否完整"""
        return all([
            self.repo_url,
            self.username,
            self.password,
            self.target_branch,
            self.user_name,
            self.user_email
        ])

    def sync(self):
        """同步配置到磁盘"""
        self.settings.sync()

    def clear(self):
        """清空所有配置"""
        self.settings.clear()
        self._init_encryption()
