const simpleGit = require('simple-git');
const path = require('path');
const os = require('os');
const fs = require('fs');

class GitService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.sourceRepoPath = path.join(os.homedir(), '.auto-commit-source');
    this.targetRepoPath = path.join(os.homedir(), '.auto-commit-target');
    this.sourceGit = null;
    this.targetGit = null;
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

  async _cloneOrPull(repoUrl, localPath, label) {
    try {
      const authUrl = this._getAuthUrl(repoUrl);

      if (!fs.existsSync(localPath)) {
        this.logger.info(`正在克隆${label}仓库...`);
        await simpleGit().clone(authUrl, localPath);
        this.logger.success(`${label}仓库克隆成功`);
        return simpleGit(localPath);
      }

      this.logger.info(`正在更新${label}仓库...`);
      const git = simpleGit(localPath);
      await git.remote(['set-url', 'origin', authUrl]);
      await git.fetch('origin');
      this.logger.success(`${label}仓库更新成功`);
      return git;
    } catch (e) {
      this.logger.error(`${label}仓库操作失败: ${e.message}`);
      return null;
    }
  }

  async cloneOrPullSource() {
    this.sourceGit = await this._cloneOrPull(this.config.sourceRepoUrl, this.sourceRepoPath, '源');
    return this.sourceGit !== null;
  }

  async cloneOrPullTarget() {
    this.targetGit = await this._cloneOrPull(this.config.targetRepoUrl, this.targetRepoPath, '目标');
    return this.targetGit !== null;
  }

  async _resolveRemoteBranch(git, branchName) {
    try {
      const refs = await git.branch(['-r']);
      const remoteBranches = refs.all;
      const targetRef = `origin/${branchName}`;

      if (remoteBranches.includes(targetRef)) return branchName;

      try {
        const headRef = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
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
      await this.sourceGit.fetch(['--all']);
      const actualBranch = await this._resolveRemoteBranch(this.sourceGit, this.config.sourceBranch);
      const ref = `origin/${actualBranch}`;

      const SEP = '__|__';
      const rawLog = await this.sourceGit.raw([
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
      const localBranches = await this.targetGit.branchLocal();
      if (localBranches.all.includes(this.config.targetBranch)) return true;

      const remoteBranches = await this.targetGit.branch(['-r']);
      return remoteBranches.all.includes(`origin/${this.config.targetBranch}`);
    } catch {
      return false;
    }
  }

  async _exportPatch(hash) {
    try {
      const patch = await this.sourceGit.raw(['diff-tree', '-p', hash]);
      return patch;
    } catch (e) {
      this.logger.error(`导出补丁失败 ${hash.slice(0, 8)}: ${e.message}`);
      return null;
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

  async _applyPatchInTarget(patch, commit) {
    try {
      const patchPath = path.join(os.tmpdir(), `sync-patch-${commit.hash.slice(0, 8)}.patch`);
      fs.writeFileSync(patchPath, patch);

      try {
        await this.targetGit.raw(['apply', patchPath]);
      } catch (applyErr) {
        try {
          await this.targetGit.raw(['apply', '--3way', patchPath]);
        } catch {
          throw applyErr;
        }
      } finally {
        try { fs.unlinkSync(patchPath); } catch {}
      }

      await this.targetGit.add('-A');
      const message = commit.message.trim() || `Sync commit ${commit.hash.slice(0, 8)}`;
      const env = this._buildAuthorEnv(commit);
      await this.targetGit.env(env).commit(message);
      return true;
    } catch (e) {
      this.logger.error(`应用补丁失败 ${commit.hash.slice(0, 8)}: ${e.message}`);
      try {
        await this.targetGit.raw(['checkout', '--', '.']);
        await this.targetGit.raw(['clean', '-fd']);
      } catch {}
      return false;
    }
  }

  async _prepareTargetBranch(isFullSync) {
    if (isFullSync) {
      try {
        try {
          await this.targetGit.branch(['-D', this.config.targetBranch]);
        } catch {}

        await this.targetGit.checkout(['--orphan', this.config.targetBranch]);
        await this.targetGit.raw(['rm', '-rf', '--cached', '.']);
        await this.targetGit.clean('f', ['-d']);

        this.logger.info(`已创建孤立分支: ${this.config.targetBranch}`);
        return true;
      } catch (e) {
        this.logger.error(`创建分支失败: ${e.message}`);
        return false;
      }
    } else {
      try {
        const localBranches = await this.targetGit.branchLocal();
        if (localBranches.all.includes(this.config.targetBranch)) {
          await this.targetGit.checkout(this.config.targetBranch);
        } else {
          await this.targetGit.checkout(['-b', this.config.targetBranch, `origin/${this.config.targetBranch}`]);
        }

        this.logger.info(`已切换到目标分支: ${this.config.targetBranch}`);
        return true;
      } catch (e) {
        this.logger.error(`切换分支失败: ${e.message}`);
        return false;
      }
    }
  }

  async _recommit(commits) {
    let successCount = 0;

    for (const commit of commits) {
      const patch = await this._exportPatch(commit.hash);
      if (!patch || !patch.trim()) {
        this.logger.warning(`跳过空提交 ${commit.hash.slice(0, 8)}`);
        continue;
      }

      const ok = await this._applyPatchInTarget(patch, commit);
      if (ok) {
        successCount++;
        this.logger.info(`同步提交: ${commit.message.trim().slice(0, 50)}...`);
      }
    }

    this.logger.success(`成功同步 ${successCount}/${commits.length} 个提交`);
    return { success: true, count: successCount };
  }

  async pushToRemote() {
    try {
      const authUrl = this._getAuthUrl(this.config.targetRepoUrl);
      await this.targetGit.remote(['set-url', 'origin', authUrl]);
      await this.targetGit.push('origin', this.config.targetBranch, ['--force']);
      this.logger.success('推送到目标仓库成功');
      return true;
    } catch (e) {
      this.logger.error(`推送失败: ${e.message}`);
      return false;
    }
  }

  async sync() {
    this.logger.info('='.repeat(50));
    this.logger.info('开始跨仓库同步...');

    if (!await this.cloneOrPullSource()) return false;

    const sinceHash = this.config.lastSyncHash;
    const commits = await this.fetchCommits(sinceHash);

    if (commits.length === 0) {
      this.logger.info('没有新的提交需要同步');
      this.config.lastSyncTime = new Date().toLocaleString('zh-CN', { hour12: false });
      return true;
    }

    this.logger.info(`发现 ${commits.length} 个新提交`);

    if (!await this.cloneOrPullTarget()) return false;

    const isFullSync = !sinceHash || !await this._targetBranchExists();

    if (!await this._prepareTargetBranch(isFullSync)) return false;

    const result = await this._recommit(commits);
    if (!result.success) return false;

    if (!await this.pushToRemote()) return false;

    const lastCommit = commits[commits.length - 1];
    this.config.lastSyncHash = lastCommit.hash;
    this.config.lastSyncTime = new Date().toLocaleString('zh-CN', { hour12: false });

    this.logger.success(`跨仓库同步完成！共同步 ${result.count} 个提交`);
    this.logger.info('='.repeat(50));
    return true;
  }
}

module.exports = { GitService };
