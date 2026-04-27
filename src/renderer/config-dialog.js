const configDialog = (() => {
  const dialog = document.getElementById('configDialog');
  const form = document.getElementById('configForm');
  const btnCancel = document.getElementById('btnCancel');

  const fields = ['repoUrl', 'username', 'password', 'sourceBranch', 'targetBranch', 'userName', 'userEmail', 'syncTime'];

  async function open() {
    const config = await window.api.getConfig();
    for (const field of fields) {
      const el = document.getElementById(field);
      if (el && config[field] !== undefined) {
        el.value = config[field];
      }
    }
    dialog.showModal();
  }

  function close() {
    dialog.close();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emailEl = document.getElementById('userEmail');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailEl.value)) {
      alert('请输入有效的邮箱地址');
      emailEl.focus();
      return;
    }

    const data = {};
    for (const field of fields) {
      data[field] = document.getElementById(field).value;
    }

    await window.api.saveConfig(data);
    close();

    if (typeof updateStatus === 'function') {
      await updateStatus();
    }
  });

  btnCancel.addEventListener('click', close);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  return { open, close };
})();
