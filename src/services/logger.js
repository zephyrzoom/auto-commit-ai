const { BrowserWindow } = require('electron');

const LogLevel = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  SUCCESS: 'SUCCESS',
};

class Logger {
  constructor() {
    this.logs = [];
  }

  _log(level, message) {
    const entry = {
      level,
      message,
      timestamp: new Date().toLocaleString('zh-CN', { hour12: false }),
    };
    this.logs.push(entry);

    const tag = `[${entry.timestamp}] [${level}]`;
    console.log(`${tag} ${message}`);

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('log-entry', entry);
      }
    }
  }

  info(msg) { this._log(LogLevel.INFO, msg); }
  warning(msg) { this._log(LogLevel.WARNING, msg); }
  error(msg) { this._log(LogLevel.ERROR, msg); }
  success(msg) { this._log(LogLevel.SUCCESS, msg); }

  getLogs() { return this.logs; }
  clear() { this.logs = []; }
}

module.exports = { Logger, LogLevel };
