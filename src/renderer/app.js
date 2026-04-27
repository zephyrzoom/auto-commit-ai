const btnSync = document.getElementById('btnSync');
const btnConfig = document.getElementById('btnConfig');
const btnClearLog = document.getElementById('btnClearLog');
const progressBar = document.getElementById('progressBar');
const logArea = document.getElementById('logArea');
const lastSyncTimeEl = document.getElementById('lastSyncTime');
const nextRunTimeEl = document.getElementById('nextRunTime');

function addLogEntry(entry) {
  const div = document.createElement('div');
  div.className = `log-entry log-${entry.level}`;
  div.textContent = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
}

function setSyncing(syncing) {
  btnSync.disabled = syncing;
  progressBar.style.display = syncing ? 'block' : 'none';
}

async function updateStatus() {
  const status = await window.api.getStatus();
  lastSyncTimeEl.textContent = status.lastSyncTime;
  nextRunTimeEl.textContent = status.nextRunTime;
}

async function loadLogs() {
  const logs = await window.api.getLogs();
  logArea.innerHTML = '';
  logs.forEach(addLogEntry);
}

btnSync.addEventListener('click', async () => {
  const status = await window.api.getStatus();
  if (!status.isConfigured) {
    alert('请先完成配置');
    configDialog.open();
    return;
  }
  await window.api.syncNow();
  await updateStatus();
});

btnConfig.addEventListener('click', () => {
  configDialog.open();
});

btnClearLog.addEventListener('click', async () => {
  await window.api.clearLogs();
  logArea.innerHTML = '';
});

window.api.onLog((entry) => {
  addLogEntry(entry);
});

window.api.onSyncStatus((status) => {
  setSyncing(status.syncing);
  if (!status.syncing) {
    updateStatus();
  }
});

updateStatus();
loadLogs();
