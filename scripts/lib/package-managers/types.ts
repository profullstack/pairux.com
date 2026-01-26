/**
 * Package Manager Types
 *
 * Shared interfaces for the package manager submission system.
 */

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
  contentType: string;
  sha256?: string;
}

export interface ReleaseInfo {
  version: string;
  tagName: string;
  assets: ReleaseAsset[];
  checksums: Map<string, string>;
  publishedAt: Date;
  releaseUrl: string;
  isPrerelease: boolean;
}

export interface PackageManagerConfig {
  enabled: boolean;
  repoOwner?: string;
  repoName?: string;
  apiToken?: string;
  maintainerEmail?: string;
  additionalConfig?: Record<string, unknown>;
}

export type SubmissionStatus = 'success' | 'skipped' | 'failed' | 'pending';

export interface SubmissionResult {
  packageManager: string;
  status: SubmissionStatus;
  message: string;
  prUrl?: string;
  commitUrl?: string;
  error?: Error;
  alreadyExists?: boolean;
}

export type Platform = 'linux' | 'macos' | 'windows' | 'all';

export interface PackageManager {
  /** Unique identifier for this package manager */
  readonly name: string;

  /** Display name for logging */
  readonly displayName: string;

  /** Target platform(s) */
  readonly platform: Platform;

  /** Priority for submission order (lower = higher priority) */
  readonly priority: number;

  /**
   * Check if this package manager is configured and ready to use
   */
  isConfigured(): Promise<boolean>;

  /**
   * Check if the specified version is already submitted
   */
  checkExisting(version: string): Promise<boolean>;

  /**
   * Generate the manifest/formula content for this package manager
   */
  generateManifest(release: ReleaseInfo): Promise<string | Record<string, string>>;

  /**
   * Submit the package to this package manager
   */
  submit(release: ReleaseInfo, dryRun?: boolean): Promise<SubmissionResult>;

  /**
   * Optional: Validate the generated manifest
   */
  validate?(manifest: string): Promise<boolean>;
}

export interface GitHubFile {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface PRSubmissionParams {
  owner: string;
  repo: string;
  baseBranch: string;
  headBranch: string;
  files: GitHubFile[];
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  success: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}
