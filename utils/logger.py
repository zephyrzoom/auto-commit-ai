from datetime import datetime
from enum import Enum
from typing import List
from PyQt6.QtCore import QObject, pyqtSignal


class LogLevel(Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    SUCCESS = "SUCCESS"


class LogEntry:
    def __init__(self, level: LogLevel, message: str, timestamp: datetime = None):
        self.level = level
        self.message = message
        self.timestamp = timestamp or datetime.now()

    def __str__(self):
        timestamp_str = self.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        return f"[{timestamp_str}] [{self.level.value}] {self.message}"


class Logger(QObject):
    log_added = pyqtSignal(LogEntry)

    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if not self._initialized:
            super().__init__()
            self._logs: List[LogEntry] = []
            self._initialized = True

    def log(self, level: LogLevel, message: str):
        entry = LogEntry(level, message)
        self._logs.append(entry)
        self.log_added.emit(entry)
        print(entry)

    def info(self, message: str):
        self.log(LogLevel.INFO, message)

    def warning(self, message: str):
        self.log(LogLevel.WARNING, message)

    def error(self, message: str):
        self.log(LogLevel.ERROR, message)

    def success(self, message: str):
        self.log(LogLevel.SUCCESS, message)

    def get_logs(self) -> List[LogEntry]:
        return self._logs.copy()

    def clear(self):
        self._logs.clear()
