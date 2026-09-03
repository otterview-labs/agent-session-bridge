export type WorkspaceEntry = {
  isDirectory: boolean;
  modifiedAt: string;
  name: string;
  path: string;
  size: number;
};

export type WorkspaceListing = {
  entries: WorkspaceEntry[];
  path: string;
  sessionName: string;
  workspacePath: string;
};

export type WorkspaceFilePreview = {
  content: string | null;
  isBinary: boolean;
  isTruncated: boolean;
  path: string;
  sessionName: string;
  size: number;
  workspacePath: string;
};

export type GitStatusEntry = {
  path: string;
  renameFrom: string | null;
  status: string;
};

export type WorkspaceGitStatus = {
  available: boolean;
  branch: string | null;
  clean: boolean;
  entries: GitStatusEntry[];
  reason: string | null;
  sessionName: string;
  workspacePath: string;
};

export type WorkspaceGitDiff = {
  available: boolean;
  content: string;
  isTruncated: boolean;
  path: string | null;
  reason: string | null;
  sessionName: string;
  workspacePath: string;
};
