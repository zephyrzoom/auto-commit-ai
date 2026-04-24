import os
from typing import List, Optional, Tuple
from urllib.parse import quote
from git import Repo, GitCommandError
from datetime import datetime
from utils.logger import Logger, LogLevel


class GitService:
    def __init__(self, config):
        self.config = config
        self.logger = Logger()
        self.repo: Optional[Repo] = None
        self.repo_path = os.path.join(os.path.expanduser("~"), ".auto-commit-repo")

    def _get_auth_url(self, url: str) -> str:
        """构建带认证的URL"""
        if not url.startswith(("http://", "https://")):
            return url

        # 移除已有的用户名密码部分
        if "@" in url:
            url = url.rsplit("@", 1)[1]

        # 统一转为 https 并提取 host+path
        if url.startswith("http://"):
            host_path = url[7:]
        elif url.startswith("https://"):
            host_path = url[8:]
        else:
            host_path = url

        encoded_user = quote(self.config.username, safe='')
        encoded_pass = quote(self.config.password, safe='')
        return f"https://{encoded_user}:{encoded_pass}@{host_path}"

    def clone_or_pull(self) -> bool:
        """克隆或更新仓库"""
        try:
            if not os.path.exists(self.repo_path):
                self.logger.info("正在克隆仓库...")
                auth_url = self._get_auth_url(self.config.repo_url)
                self.repo = Repo.clone_from(auth_url, self.repo_path)
                self.logger.success("仓库克隆成功")
                return True

            self.logger.info("正在更新仓库...")
            self.repo = Repo(self.repo_path)
            auth_url = self._get_auth_url(self.config.repo_url)

            # 配置远程URL
            if self.repo.remotes:
                origin = self.repo.remotes.origin
                origin.set_url(auth_url)

            self.repo.remotes.origin.fetch()
            self.logger.success("仓库更新成功")
            return True

        except GitCommandError as e:
            self.logger.error(f"Git操作失败: {e}")
            return False
        except Exception as e:
            self.logger.error(f"未知错误: {e}")
            return False

    def _resolve_remote_branch(self, branch_name: str) -> str:
        """检查远程分支是否存在，不存在则尝试检测默认分支"""
        remote_refs = [ref.name for ref in self.repo.references]
        target_ref = f"origin/{branch_name}"

        if target_ref in remote_refs:
            return branch_name

        # 尝试通过远程 HEAD 检测默认分支
        try:
            head_ref = self.repo.git.symbolic_ref('refs/remotes/origin/HEAD')
            # 返回类似 refs/remotes/origin/master
            default_branch = head_ref.replace('refs/remotes/origin/', '')
            self.logger.info(f"远程分支 '{branch_name}' 不存在，检测到默认分支: '{default_branch}'")
            return default_branch
        except GitCommandError:
            pass

        # 列出所有远程分支供参考
        remote_branches = [ref.name for ref in self.repo.references
                           if ref.name.startswith('origin/')]
        self.logger.error(
            f"远程分支 '{branch_name}' 不存在。"
            f"可用分支: {', '.join(remote_branches)}"
        )
        return branch_name

    def fetch_commits(self, since_hash: str = "") -> List[object]:
        """获取从指定hash开始的提交列表"""
        try:
            self.repo.git.fetch("--all")

            # 自动解析实际存在的远程分支
            actual_branch = self._resolve_remote_branch(self.config.source_branch)
            ref = f"origin/{actual_branch}"

            if not since_hash:
                # 如果是第一次同步，获取所有提交
                commits = list(self.repo.iter_commits(ref))
            else:
                # 获取从上次同步hash到最新的提交
                commits = []
                found_start = False
                for commit in self.repo.iter_commits(ref):
                    if commit.hexsha == since_hash:
                        found_start = True
                        break
                    commits.append(commit)

                # 如果没找到起始hash，获取所有提交
                if not found_start:
                    self.logger.warning("未找到上次同步的hash，将获取所有提交")
                    commits = list(self.repo.iter_commits(ref))

            # 反转顺序，从旧到新
            return list(reversed(commits))

        except GitCommandError as e:
            self.logger.error(f"获取提交记录失败: {e}")
            return []
        except Exception as e:
            self.logger.error(f"未知错误: {e}")
            return []

    def _target_branch_exists(self) -> bool:
        """检查目标分支是否已存在（本地或远程）"""
        local_branches = [b.name for b in self.repo.branches]
        if self.config.target_branch in local_branches:
            return True
        remote_refs = [ref.name for ref in self.repo.references]
        return f"origin/{self.config.target_branch}" in remote_refs

    def prepare_branch_full_sync(self) -> bool:
        """首次同步：基于源分支创建孤立的目标分支"""
        try:
            actual_branch = self._resolve_remote_branch(self.config.source_branch)
            self.repo.git.checkout(f'origin/{actual_branch}')

            # 删除已有的本地目标分支
            try:
                self.repo.git.branch('-D', self.config.target_branch)
            except GitCommandError:
                pass

            # 创建孤立分支（无历史记录）
            self.repo.git.checkout('--orphan', self.config.target_branch)
            self.repo.git.rm('-rf', '--cached', '.')
            self.repo.git.clean('-fd')

            self.logger.info(f"已创建孤立分支: {self.config.target_branch}")
            return True

        except GitCommandError as e:
            self.logger.error(f"创建分支失败: {e}")
            return False

    def prepare_branch_incremental(self) -> bool:
        """增量同步：切换到已存在的目标分支"""
        try:
            local_branches = [b.name for b in self.repo.branches]
            if self.config.target_branch in local_branches:
                self.repo.git.checkout(self.config.target_branch)
            else:
                # 本地不存在，从远程拉取
                self.repo.git.checkout(
                    f'origin/{self.config.target_branch}',
                    b=self.config.target_branch
                )

            self.logger.info(f"已切换到目标分支: {self.config.target_branch}")
            return True

        except GitCommandError as e:
            self.logger.error(f"切换分支失败: {e}")
            return False

    def _build_author_env(self, commit) -> dict:
        """构建修改作者的 Git 环境变量"""
        original_date = datetime.fromtimestamp(commit.committed_date).isoformat()
        return {
            'GIT_AUTHOR_DATE': original_date,
            'GIT_COMMITTER_DATE': original_date,
            'GIT_AUTHOR_NAME': self.config.user_name,
            'GIT_AUTHOR_EMAIL': self.config.user_email,
            'GIT_COMMITTER_NAME': self.config.user_name,
            'GIT_COMMITTER_EMAIL': self.config.user_email,
        }

    def recommit_full(self, commits: List[object]) -> Tuple[bool, int]:
        """全量同步：用 read-tree 回放所有提交（修改作者，保留时间）"""
        try:
            success_count = 0

            for commit in commits:
                try:
                    # 用该提交的树替换整个工作区和索引
                    self.repo.git.read_tree('-u', '--reset', commit.hexsha)

                    message = commit.message.strip() or f"Sync commit {commit.hexsha[:8]}"
                    env = self._build_author_env(commit)
                    self.repo.git.commit(m=message, env=env)
                    success_count += 1
                    self.logger.info(f"同步提交: {message[:50]}...")

                except GitCommandError as e:
                    self.logger.error(f"重新提交失败 {commit.hexsha[:8]}: {e}")
                    continue

            self.logger.success(f"成功同步 {success_count}/{len(commits)} 个提交")
            return True, success_count

        except Exception as e:
            self.logger.error(f"重新提交过程出错: {e}")
            return False, 0

    def recommit_incremental(self, commits: List[object]) -> Tuple[bool, int]:
        """增量同步：用 cherry-pick 回放新提交（修改作者，保留时间）"""
        try:
            success_count = 0

            for commit in commits:
                try:
                    message = commit.message.strip() or f"Sync commit {commit.hexsha[:8]}"
                    env = self._build_author_env(commit)

                    # cherry-pick 不提交，然后手动提交以覆盖作者信息
                    self.repo.git.cherry_pick('--no-commit', commit.hexsha)
                    self.repo.git.commit(m=message, env=env)
                    success_count += 1
                    self.logger.info(f"同步提交: {message[:50]}...")

                except GitCommandError as e:
                    self.logger.error(f"重新提交失败 {commit.hexsha[:8]}: {e}")
                    try:
                        self.repo.git.cherry_pick('--abort')
                    except GitCommandError:
                        pass
                    continue

            self.logger.success(f"成功同步 {success_count}/{len(commits)} 个提交")
            return True, success_count

        except Exception as e:
            self.logger.error(f"重新提交过程出错: {e}")
            return False, 0

    def push_to_remote(self) -> bool:
        """推送到远程仓库"""
        try:
            auth_url = self._get_auth_url(self.config.repo_url)
            self.repo.remotes.origin.set_url(auth_url)
            self.repo.git.push('origin', self.config.target_branch, '--force')
            self.logger.success("推送到远程成功")
            return True

        except GitCommandError as e:
            self.logger.error(f"推送失败: {e}")
            return False
        except Exception as e:
            self.logger.error(f"推送过程出错: {e}")
            return False

    def sync(self) -> bool:
        """执行完整同步流程"""
        self.logger.info("=" * 50)
        self.logger.info("开始同步...")

        # 克隆或更新仓库
        if not self.clone_or_pull():
            return False

        # 获取提交记录
        since_hash = self.config.last_sync_hash
        commits = self.fetch_commits(since_hash)

        if not commits:
            self.logger.info("没有新的提交需要同步")
            self.config.last_sync_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            return True

        self.logger.info(f"发现 {len(commits)} 个新提交")

        # 判断全量同步还是增量同步：目标分支必须同时存在于本地和远程才算增量
        is_full_sync = not since_hash or not self._target_branch_exists()

        if is_full_sync:
            if not self.prepare_branch_full_sync():
                return False
            success, count = self.recommit_full(commits)
        else:
            if not self.prepare_branch_incremental():
                return False
            success, count = self.recommit_incremental(commits)

        if not success:
            return False

        # 推送到远程
        if not self.push_to_remote():
            return False

        # 更新最后同步的hash
        last_commit = commits[-1]
        self.config.last_sync_hash = last_commit.hexsha
        self.config.last_sync_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.config.sync()

        self.logger.success(f"同步完成！共同步 {count} 个提交")
        self.logger.info("=" * 50)

        return True
