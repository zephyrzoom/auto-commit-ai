const simpleGit = require('simple-git');
const path = require('path');
const os = require('os');
const fs = require('fs');

class GitService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.repoPath = path.join(os.homedir(), '.auto-commit-repo');
    this.git = null;
  }

  _getAuthUrl(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return url;

    let hostPath = url;
    if (hostPath.includes('@')) {
      hostPath = hostPath.split('@').pop();
    }
    if (hostPath.startsWith('http://')) {
      hostPath = hostPath.slice(7);
    } else if (hostPath.startsWith('https://')) {
      hostPath = hostPath.slice(8);
    }

    const encodedUser = encodeURIComponent(this.config.username);
    const encodedPass = encodeURIComponent(this.config.password);
    return `https://${encodedUser}:${encodedPass}@${hostPath}`;
  }

  async cloneOrPull() {
    try {
      const authUrl = this._getAuthUrl(this.config.repoUrl);

      if (!fs.existsSync(this.repoPath)) {
        this.logger.info('正在克隆仓库...');
        await simpleGit().clone(authUrl, this.repoPath);
        this.git = simpleGit(this.repoPath);
        this.logger.success('仓库克隆成功');
        return true;
      }

      this.logger.info('正在更新仓库...');
      this.git = simpleGit(this.repoPath);
      await this.git.remote(['set-url', 'origin', authUrl]);
      await this.git.fetch('origin');
      this.logger.success('仓库更新成功');
      return true;
    } catch (e) {
      this.logger.error(`Git操作失败: ${e.message}`);
      return false;
    }
  }

  async _resolveRemoteBranch(branchName) {
    try {
      const refs = await this.git.branch(['-r']);
      const remoteBranches = refs.all;
      const targetRef = `origin/${branchName}`;

      if (remoteBranches.includes(targetRef)) return branchName;

      try {
        const headRef = await this.git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
        const defaultBranch = headRef.trim().replace('refs/remotes/origin/', '');
        this.logger.info(`远程分支 '${branchName}' 不存在，检测到默认分支: '${defaultBranch}'`);
        return defaultBranch;
      } catch {}

      this.logger.error(`远程分支 '${branchName}' 不存在。可用分支: ${remoteBranches.join(', ')}`);
      return branchName;
    } catch {
      return branchName;
    }
  }

  async fetchCommits(sinceHash = '') {
    try {
      await this.git.fetch(['--all']);
      const actualBranch = await this._resolveRemoteBranch(this.config.sourceBranch);
      const ref = `origin/${actualBranch}`;

      const SEP = '__|__';
      const rawLog = await this.git.raw([
        'log', ref, `--format=%H${SEP}%at${SEP}%s`,
      ]);

      if (!rawLog || !rawLog.trim()) return [];

      const allCommits = rawLog.trim().split('\n').map(line => {
        const [hash, timestamp, ...msgParts] = line.split(SEP);
        return { hash, date: timestamp, message: msgParts.join(SEP) };
      });

      if (!sinceHash) {
        return allCommits.reverse();
      }

      const idx = allCommits.findIndex(c => c.hash === sinceHash);
      if (idx === -1) {
        this.logger.warning('未找到上次同步的hash，将获取所有提交');
        return allCommits.reverse();
      }

      return allCommits.slice(0, idx).reverse();
    } catch (e) {
      this.logger.error(`获取提交记录失败: ${e.message}`);
      return [];
    }
  }

  async _targetBranchExists() {
    try {
      const localBranches = await this.git.branchLocal();
      if (localBranches.all.includes(this.config.targetBranch)) return true;

      const remoteBranches = await this.git.branch(['-r']);
      return remoteBranches.all.includes(`origin/${this.config.targetBranch}`);
    } catch {
      return false;
    }
  }

  async prepareBranchFullSync() {
    try {
      const actualBranch = await this._resolveRemoteBranch(this.config.sourceBranch);
      await this.git.checkout(`origin/${actualBranch}`);

      try {
        await this.git.branch(['-D', this.config.targetBranch]);
      } catch {}

      await this.git.checkout(['--orphan', this.config.targetBranch]);
      await this.git.raw(['rm', '-rf', '--cached', '.']);
      await this.git.clean('f', ['-d']);

      this.logger.info(`已创建孤立分支: ${this.config.targetBranch}`);
      return true;
    } catch (e) {
      this.logger.error(`创建分支失败: ${e.message}`);
      return false;
    }
  }

  async prepareBranchIncremental() {
    try {
      const localBranches = await this.git.branchLocal();
      if (localBranches.all.includes(this.config.targetBranch)) {
        await this.git.checkout(this.config.targetBranch);
      } else {
        await this.git.checkout(['-b', this.config.targetBranch, `origin/${this.config.targetBranch}`]);
      }

      this.logger.info(`已切换到目标分支: ${this.config.targetBranch}`);
      return true;
    } catch (e) {
      this.logger.error(`切换分支失败: ${e.message}`);
      return false;
    }
  }

  _buildAuthorEnv(commit) {
    const originalDate = new Date(parseInt(commit.date) * 1000).toISOString();
    return {
      GIT_AUTHOR_DATE: originalDate,
      GIT_COMMITTER_DATE: originalDate,
      GIT_AUTHOR_NAME: this.config.userName,
      GIT_AUTHOR_EMAIL: this.config.userEmail,
      GIT_COMMITTER_NAME: this.config.userName,
      GIT_COMMITTER_EMAIL: this.config.userEmail,
    };
  }

  async recommitFull(commits) {
    let successCount = 0;

    for (const commit of commits) {
      try {
        await this.git.raw(['read-tree', '-u', '--reset', commit.hash]);
        const message = commit.message.trim() || `Sync commit ${commit.hash.slice(0, 8)}`;
        const env = this._buildAuthorEnv(commit);
        await this.git.env(env).commit(message);
        successCount++;
        this.logger.info(`同步提交: ${message.slice(0, 50)}...`);
      } catch (e) {
        this.logger.error(`重新提交失败 ${commit.hash.slice(0, 8)}: ${e.message}`);
      }
    }

    this.logger.success(`成功同步 ${successCount}/${commits.length} 个提交`);
    return { success: true, count: successCount };
  }

  async recommitIncremental(commits) {
    let successCount = 0;

    for (const commit of commits) {
      try {
        const message = commit.message.trim() || `Sync commit ${commit.hash.slice(0, 8)}`;
        const env = this._buildAuthorEnv(commit);
        await this.git.raw(['cherry-pick', '--no-commit', commit.hash]);
        await this.git.env(env).commit(message);
        successCount++;
        this.logger.info(`同步提交: ${message.slice(0, 50)}...`);
      } catch (e) {
        this.logger.error(`重新提交失败 ${commit.hash.slice(0, 8)}: ${e.message}`);
        try {
          await this.git.raw(['cherry-pick', '--abort']);
        } catch {}
      }
    }

    this.logger.success(`成功同步 ${successCount}/${commits.length} 个提交`);
    return { success: true, count: successCount };
  }

  async pushToRemote() {
    try {
      const authUrl = this._getAuthUrl(this.config.repoUrl);
      await this.git.remote(['set-url', 'origin', authUrl]);
      await this.git.push('origin', this.config.targetBranch, ['--force']);
      this.logger.success('推送到远程成功');
      return true;
    } catch (e) {
      this.logger.error(`推送失败: ${e.message}`);
      return false;
    }
  }

  async sync() {
    this.logger.info('='.repeat(50));
    this.logger.info('开始同步...');

    if (!await this.cloneOrPull()) return false;

    const sinceHash = this.config.lastSyncHash;
    const commits = await this.fetchCommits(sinceHash);

    if (commits.length === 0) {
      this.logger.info('没有新的提交需要同步');
      this.config.lastSyncTime = new Date().toLocaleString('zh-CN', { hour12: false });
      return true;
    }

    this.logger.info(`发现 ${commits.length} 个新提交`);

    const isFullSync = !sinceHash || !await this._targetBranchExists();

    let result;
    if (isFullSync) {
      if (!await this.prepareBranchFullSync()) return false;
      result = await this.recommitFull(commits);
    } else {
      if (!await this.prepareBranchIncremental()) return false;
      result = await this.recommitIncremental(commits);
    }

    if (!result.success) return false;
    if (!await this.pushToRemote()) return false;

    const lastCommit = commits[commits.length - 1];
    this.config.lastSyncHash = lastCommit.hash;
    this.config.lastSyncTime = new Date().toLocaleString('zh-CN', { hour12: false });

    this.logger.success(`同步完成！共同步 ${result.count} 个提交`);
    this.logger.info('='.repeat(50));
    return true;
  }
}

module.exports = { GitService };
