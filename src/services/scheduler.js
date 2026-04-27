const cron = require('node-cron');

class SyncScheduler {
  constructor() {
    this.task = null;
    this.scheduledTime = null;
  }

  scheduleDaily(timeStr, callback) {
    this.removeSchedule();
    const [hour, minute] = timeStr.split(':').map(Number);
    this.scheduledTime = timeStr;
    this.task = cron.schedule(`${minute} ${hour} * * *`, () => {
      callback();
    });
  }

  removeSchedule() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      this.scheduledTime = null;
    }
  }

  runNow(callback) {
    callback();
  }

  get hasSchedule() {
    return this.task !== null;
  }

  getNextRunTime() {
    if (!this.scheduledTime) return '未设置';
    const [hour, minute] = this.scheduledTime.split(':').map(Number);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.toLocaleString('zh-CN', { hour12: false });
  }

  shutdown() {
    this.removeSchedule();
  }
}

module.exports = { SyncScheduler };
