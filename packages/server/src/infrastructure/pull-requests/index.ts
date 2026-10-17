import type { PullRequestsPort } from '@/application/ports/pull-requests';
import { createAzurePullRequests } from './azure';
import { azureRest, createAzureCredentials } from './azure-rest';
import type { FetchLike } from './cli';
import { runCli, type RunCli } from './cli';
import { createGitHubPullRequests } from './github';
import { createGitHubCredentials, githubRest } from './github-rest';
import { discoverPullRequestRepositories } from './repositories';

export function createCliPullRequestProviders(
  run: RunCli = runCli,
  fetcher: FetchLike = fetch,
): Pick<PullRequestsPort, 'repositories' | 'provider'> {
  // Shared across requests so Azure tokens are minted once per organization, not per call.
  const azure = createAzureCredentials(run, fetcher);
  // Shared so the gh token and its account are read once, not per request.
  const github = createGitHubCredentials(run);
  return {
    repositories: discoverPullRequestRepositories,
    provider: (_root, repository) =>
      repository.provider === 'github'
        ? createGitHubPullRequests(githubRest(fetcher, github), repository)
        : createAzurePullRequests(azureRest(fetcher, azure, repository), repository),
  };
}
