const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 从最早时刻开始写文件日志
const logFile = path.join(os.homedir(), '.git-sync-tool.log');
function logDebug(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(line.trim());
}

logDebug('=== 进程启动 ===');
logDebug(`平台: ${process.platform}, 架构: ${process.arch}`);
logDebug(`argv: ${process.argv.join(' ')}`);
logDebug(`app path: ${app.getAppPath()}`);
logDebug(`cwd: ${process.cwd()}`);
logDebug(`env DISPLAY: ${process.env.DISPLAY}`);
logDebug(`env XDG_RUNTIME_DIR: ${process.env.XDG_RUNTIME_DIR}`);

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  logDebug('Linux: 已添加 --no-sandbox --disable-gpu --disable-software-rasterizer');
}

process.on('uncaughtException', (err) => {
  logDebug(`未捕获异常: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  logDebug(`未处理 Promise 拒绝: ${reason}`);
});

try {
  var { ConfigManager } = require('./src/services/config-manager');
  var { GitService } = require('./src/services/git-service');
  var { SyncScheduler } = require('./src/services/scheduler');
  var { Logger } = require('./src/services/logger');
  logDebug('所有模块加载成功');
} catch (e) {
  logDebug(`模块加载失败: ${e.stack || e.message}`);
  app.quit();
}

let mainWindow;
let configManager;
let gitService;
let scheduler;
let logger;
let isSyncing = false;

function createWindow() {
  logDebug('创建窗口...');
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    title: 'Git 同步工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(__dirname, 'src/renderer/index.html');
  logDebug(`加载页面: ${htmlPath}`);
  mainWindow.loadFile(htmlPath);

  mainWindow.webContents.on('did-finish-load', () => {
    logDebug('页面加载完成');
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
    logDebug(`页面加载失败: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function initServices() {
  logDebug('初始化服务...');
  configManager = new ConfigManager();
  logger = new Logger();
  gitService = new GitService(configManager, logger);
  scheduler = new SyncScheduler();
  logDebug(`配置已加载, isConfigured: ${configManager.isConfigured}`);

  if (configManager.isConfigured) {
    setupSchedule();
  }
}

function setupSchedule() {
  const syncTime = configManager.syncTime;
  if (syncTime) {
    scheduler.scheduleDaily(syncTime, () => performSync());
    logger.info(`已设置每日同步时间: ${syncTime}`);
  }
}

async function performSync() {
  if (isSyncing) {
    logger.warning('同步正在进行中，请勿重复操作');
    return;
  }

  isSyncing = true;
  sendToRenderer('sync-status', { syncing: true });

  try {
    await gitService.sync();
  } catch (e) {
    logger.error(`同步过程异常: ${e.message}`);
    logDebug(`同步异常: ${e.stack || e.message}`);
  } finally {
    isSyncing = false;
    sendToRenderer('sync-status', { syncing: false });
  }
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function registerIpcHandlers() {
  ipcMain.handle('sync-now', async () => {
    await performSync();
  });

  ipcMain.handle('get-config', () => {
    return configManager.getAll();
  });

  ipcMain.handle('save-config', (_, data) => {
    configManager.saveAll(data);
    scheduler.removeSchedule();
    if (configManager.isConfigured) {
      setupSchedule();
    }
    return configManager.getAll();
  });

  ipcMain.handle('get-status', () => {
    return {
      lastSyncTime: configManager.lastSyncTime,
      nextRunTime: scheduler.getNextRunTime(),
      isConfigured: configManager.isConfigured,
      isSyncing,
    };
  });

  ipcMain.handle('get-logs', () => {
    return logger.getLogs();
  });

  ipcMain.handle('clear-logs', () => {
    logger.clear();
  });
}

app.whenReady().then(() => {
  logDebug('app ready');
  initServices();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  logDebug('所有窗口关闭');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logDebug('应用退出');
  scheduler.shutdown();
});
