const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { ConfigManager } = require('./src/services/config-manager');
const { GitService } = require('./src/services/git-service');
const { SyncScheduler } = require('./src/services/scheduler');
const { Logger } = require('./src/services/logger');

let mainWindow;
let configManager;
let gitService;
let scheduler;
let logger;
let isSyncing = false;

function createWindow() {
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

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
}

function initServices() {
  configManager = new ConfigManager();
  logger = new Logger();
  gitService = new GitService(configManager, logger);
  scheduler = new SyncScheduler();

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  scheduler.shutdown();
});
