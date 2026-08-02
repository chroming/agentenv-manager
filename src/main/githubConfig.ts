export const DEFAULT_GITHUB_OAUTH_CLIENT_ID = "Ov23liOAxChYXPhAjVh8";

export const resolveGitHubOAuthClientId = (
  environment: NodeJS.ProcessEnv = process.env
) => environment.AGENTENV_GITHUB_OAUTH_CLIENT_ID?.trim() || DEFAULT_GITHUB_OAUTH_CLIENT_ID;
