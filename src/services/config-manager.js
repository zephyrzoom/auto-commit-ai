const Store = require('electron-store');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

class ConfigManager {
  constructor() {
    this.store = new Store({ name: 'git-sync-config' });
    this._ensureEncryptionKey();
  }

  _ensureEncryptionKey() {
    if (!this.store.get('_encryptionKey')) {
      const key = crypto.randomBytes(KEY_LENGTH).toString('hex');
      this.store.set('_encryptionKey', key);
    }
  }

  _getKey() {
    return Buffer.from(this.store.get('_encryptionKey'), 'hex');
  }

  _encrypt(plaintext) {
    if (!plaintext) return '';
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this._getKey(), iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  _decrypt(ciphertext) {
    if (!ciphertext) return '';
    try {
      const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, this._getKey(), iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return '';
    }
  }

  get repoUrl() { return this.store.get('repoUrl', ''); }
  set repoUrl(v) { this.store.set('repoUrl', v); }

  get username() { return this.store.get('username', ''); }
  set username(v) { this.store.set('username', v); }

  get password() { return this._decrypt(this.store.get('encryptedPassword', '')); }
  set password(v) { this.store.set('encryptedPassword', this._encrypt(v)); }

  get sourceBranch() { return this.store.get('sourceBranch', 'main'); }
  set sourceBranch(v) { this.store.set('sourceBranch', v); }

  get targetBranch() { return this.store.get('targetBranch', ''); }
  set targetBranch(v) { this.store.set('targetBranch', v); }

  get userName() { return this.store.get('userName', ''); }
  set userName(v) { this.store.set('userName', v); }

  get userEmail() { return this.store.get('userEmail', ''); }
  set userEmail(v) { this.store.set('userEmail', v); }

  get syncTime() { return this.store.get('syncTime', '00:00'); }
  set syncTime(v) { this.store.set('syncTime', v); }

  get lastSyncHash() { return this.store.get('lastSyncHash', ''); }
  set lastSyncHash(v) { this.store.set('lastSyncHash', v); }

  get lastSyncTime() { return this.store.get('lastSyncTime', '从未同步'); }
  set lastSyncTime(v) { this.store.set('lastSyncTime', v); }

  get isConfigured() {
    return !!(this.repoUrl && this.username && this.password &&
              this.targetBranch && this.userName && this.userEmail);
  }

  getAll() {
    return {
      repoUrl: this.repoUrl,
      username: this.username,
      password: this.password,
      sourceBranch: this.sourceBranch,
      targetBranch: this.targetBranch,
      userName: this.userName,
      userEmail: this.userEmail,
      syncTime: this.syncTime,
      lastSyncHash: this.lastSyncHash,
      lastSyncTime: this.lastSyncTime,
      isConfigured: this.isConfigured,
    };
  }

  saveAll(data) {
    if (data.repoUrl !== undefined) this.repoUrl = data.repoUrl;
    if (data.username !== undefined) this.username = data.username;
    if (data.password !== undefined) this.password = data.password;
    if (data.sourceBranch !== undefined) this.sourceBranch = data.sourceBranch;
    if (data.targetBranch !== undefined) this.targetBranch = data.targetBranch;
    if (data.userName !== undefined) this.userName = data.userName;
    if (data.userEmail !== undefined) this.userEmail = data.userEmail;
    if (data.syncTime !== undefined) this.syncTime = data.syncTime;
  }
}

module.exports = { ConfigManager };
