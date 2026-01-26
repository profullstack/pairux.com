/**
 * Base Package Manager
 *
 * Abstract base class with shared functionality for all package managers.
 */

import type {
  PackageManager,
  PackageManagerConfig,
  Platform,
  ReleaseInfo,
  SubmissionResult,
  PRSubmissionParams,
  CrossForkPRSubmissionParams,
  GitHubFile,
  Logger,
} from './types.js';

const GITHUB_API = 'https://api.github.com';

export abstract class BasePackageManager implements PackageManager {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly platform: Platform;
  abstract readonly priority: number;

  protected config: PackageManagerConfig;
  protected logger: Logger;

  constructor(config: PackageManagerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  abstract isConfigured(): Promise<boolean>;
  abstract checkExisting(version: string): Promise<boolean>;
  abstract generateManifest(release: ReleaseInfo): Promise<string | Record<string, string>>;
  abstract submit(release: ReleaseInfo, dryRun?: boolean): Promise<SubmissionResult>;

  /**
   * Get GitHub token from environment or config
   */
  protected getGitHubToken(): string | undefined {
    return this.config.apiToken ?? process.env.GITHUB_TOKEN;
  }

  /**
   * Make an authenticated GitHub API request
   */
  protected async githubRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getGitHubToken();
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable required');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API}${endpoint}`;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'PairUX-Submit-Packages',
      'Content-Type': 'application/json',
    };

    // Merge additional headers if provided
    if (options.headers) {
      const optHeaders = options.headers as Record<string, string>;
      for (const [key, value] of Object.entries(optHeaders)) {
        headers[key] = value;
      }
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub API error (${String(response.status)}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check if a repository exists
   */
  protected async repoExists(owner: string, repo: string): Promise<boolean> {
    try {
      await this.githubRequest(`/repos/${owner}/${repo}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a repository if it doesn't exist
   */
  protected async ensureRepo(
    owner: string,
    repo: string,
    description: string,
    isPrivate = false
  ): Promise<void> {
    if (await this.repoExists(owner, repo)) {
      return;
    }

    this.logger.info(`Creating repository ${owner}/${repo}...`);

    // Check if it's a user or org
    const userResponse = await this.githubRequest<{ type: string }>(`/users/${owner}`);

    if (userResponse.type === 'Organization') {
      await this.githubRequest(`/orgs/${owner}/repos`, {
        method: 'POST',
        body: JSON.stringify({
          name: repo,
          description,
          private: isPrivate,
          auto_init: true,
        }),
      });
    } else {
      await this.githubRequest('/user/repos', {
        method: 'POST',
        body: JSON.stringify({
          name: repo,
          description,
          private: isPrivate,
          auto_init: true,
        }),
      });
    }

    // Wait a moment for the repo to be ready
    await this.sleep(2000);
  }

  /**
   * Get the default branch of a repository
   */
  protected async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const response = await this.githubRequest<{ default_branch: string }>(
      `/repos/${owner}/${repo}`
    );
    return response.default_branch;
  }

  /**
   * Get the SHA of a branch
   */
  protected async getBranchSha(owner: string, repo: string, branch: string): Promise<string> {
    const response = await this.githubRequest<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`
    );
    return response.object.sha;
  }

  /**
   * Check if a branch exists
   */
  protected async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
    try {
      await this.getBranchSha(owner, repo, branch);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new branch from the default branch
   */
  protected async createBranch(
    owner: string,
    repo: string,
    branch: string,
    fromBranch?: string
  ): Promise<void> {
    const baseBranch = fromBranch ?? (await this.getDefaultBranch(owner, repo));
    const baseSha = await this.getBranchSha(owner, repo, baseBranch);

    await this.githubRequest(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseSha,
      }),
    });
  }

  /**
   * Get file content from a repository
   */
  protected async getFileContent(
    owner: string,
    repo: string,
    path: string,
    branch?: string
  ): Promise<{ content: string; sha: string } | null> {
    try {
      const ref = branch ? `?ref=${branch}` : '';
      const response = await this.githubRequest<{ content: string; sha: string }>(
        `/repos/${owner}/${repo}/contents/${path}${ref}`
      );
      return {
        content: Buffer.from(response.content, 'base64').toString('utf-8'),
        sha: response.sha,
      };
    } catch {
      return null;
    }
  }

  /**
   * Create or update a file in a repository
   */
  protected async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch?: string,
    existingSha?: string
  ): Promise<{ sha: string; url: string }> {
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content).toString('base64'),
    };

    if (branch) {
      body.branch = branch;
    }

    if (existingSha) {
      body.sha = existingSha;
    } else {
      // Check if file exists and get its SHA
      const existing = await this.getFileContent(owner, repo, path, branch);
      if (existing) {
        body.sha = existing.sha;
      }
    }

    const response = await this.githubRequest<{
      content: { sha: string; html_url: string };
    }>(`/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    return {
      sha: response.content.sha,
      url: response.content.html_url,
    };
  }

  /**
   * Submit changes via a Pull Request
   */
  protected async submitViaPR(params: PRSubmissionParams): Promise<SubmissionResult> {
    const { owner, repo, baseBranch, headBranch, files, commitMessage, prTitle, prBody } = params;

    try {
      // Check if branch already exists (from previous run)
      const branchExistsAlready = await this.branchExists(owner, repo, headBranch);

      if (!branchExistsAlready) {
        // Create the branch
        await this.createBranch(owner, repo, headBranch, baseBranch);
      }

      // Create/update all files
      for (const file of files) {
        await this.createOrUpdateFile(
          owner,
          repo,
          file.path,
          file.content,
          commitMessage,
          headBranch
        );
      }

      // Check for existing PR
      const existingPRs = await this.githubRequest<{ html_url: string; number: number }[]>(
        `/repos/${owner}/${repo}/pulls?head=${owner}:${headBranch}&state=open`
      );

      if (existingPRs.length > 0) {
        return {
          packageManager: this.name,
          status: 'success',
          message: `PR already exists: #${String(existingPRs[0].number)}`,
          prUrl: existingPRs[0].html_url,
        };
      }

      // Create the PR
      const pr = await this.githubRequest<{ html_url: string; number: number }>(
        `/repos/${owner}/${repo}/pulls`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: prTitle,
            body: prBody,
            head: headBranch,
            base: baseBranch,
          }),
        }
      );

      return {
        packageManager: this.name,
        status: 'success',
        message: `PR created: #${String(pr.number)}`,
        prUrl: pr.html_url,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        packageManager: this.name,
        status: 'failed',
        message: errorMessage,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Submit changes via a cross-fork Pull Request (e.g., for microsoft/winget-pkgs)
   * This creates files in your fork and opens a PR to the upstream repo.
   */
  protected async submitCrossForkPR(
    params: CrossForkPRSubmissionParams
  ): Promise<SubmissionResult> {
    const {
      upstreamOwner,
      upstreamRepo,
      forkOwner,
      baseBranch,
      headBranch,
      files,
      commitMessage,
      prTitle,
      prBody,
    } = params;

    try {
      // Check if branch already exists in our fork (from previous run)
      const branchExistsAlready = await this.branchExists(forkOwner, upstreamRepo, headBranch);

      if (!branchExistsAlready) {
        // Create the branch in our fork from the base branch
        await this.createBranch(forkOwner, upstreamRepo, headBranch, baseBranch);
      }

      // Create/update all files in our fork
      for (const file of files) {
        await this.createOrUpdateFile(
          forkOwner,
          upstreamRepo,
          file.path,
          file.content,
          commitMessage,
          headBranch
        );
      }

      // Check for existing PR on the upstream repo
      const existingPRs = await this.githubRequest<{ html_url: string; number: number }[]>(
        `/repos/${upstreamOwner}/${upstreamRepo}/pulls?head=${forkOwner}:${headBranch}&state=open`
      );

      if (existingPRs.length > 0) {
        return {
          packageManager: this.name,
          status: 'success',
          message: `PR already exists: #${String(existingPRs[0].number)}`,
          prUrl: existingPRs[0].html_url,
        };
      }

      // Create the PR on the upstream repo
      const pr = await this.githubRequest<{ html_url: string; number: number }>(
        `/repos/${upstreamOwner}/${upstreamRepo}/pulls`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: prTitle,
            body: prBody,
            head: `${forkOwner}:${headBranch}`,
            base: baseBranch,
          }),
        }
      );

      return {
        packageManager: this.name,
        status: 'success',
        message: `PR created: #${String(pr.number)}`,
        prUrl: pr.html_url,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        packageManager: this.name,
        status: 'failed',
        message: errorMessage,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Submit changes directly to a branch (for own repos)
   */
  protected async submitDirect(
    owner: string,
    repo: string,
    files: GitHubFile[],
    commitMessage: string,
    branch?: string
  ): Promise<SubmissionResult> {
    try {
      const targetBranch = branch ?? (await this.getDefaultBranch(owner, repo));
      let commitUrl = '';

      for (const file of files) {
        const result = await this.createOrUpdateFile(
          owner,
          repo,
          file.path,
          file.content,
          commitMessage,
          targetBranch
        );
        commitUrl = result.url;
      }

      return {
        packageManager: this.name,
        status: 'success',
        message: `Committed to ${owner}/${repo}`,
        commitUrl,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        packageManager: this.name,
        status: 'failed',
        message: errorMessage,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Download a file from a URL
   */
  protected async downloadFile(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${String(response.status)}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Sleep for a specified duration
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Find an asset by pattern
   */
  protected findAsset(
    release: ReleaseInfo,
    pattern: RegExp | ((asset: ReleaseInfo['assets'][0]) => boolean)
  ): ReleaseInfo['assets'][0] | undefined {
    if (pattern instanceof RegExp) {
      return release.assets.find((a) => pattern.test(a.name));
    }
    return release.assets.find(pattern);
  }
}
