import type { HttpClient } from '../transport/http';
import type {
  ListTerminalSessionsResponse,
  CreateTerminalSessionResponse,
  GetTerminalSessionResponse,
  RenameTerminalSessionResponse,
  DeleteTerminalSessionResponse,
} from '../types/rest-responses';

interface ListOptions {
  signal?: AbortSignal;
}

interface CreateOptions {
  signal?: AbortSignal;
  body?: {
    cwd?: string;
    shell?: string;
  };
}

interface GetOptions {
  signal?: AbortSignal;
}

interface DeleteOptions {
  signal?: AbortSignal;
}

export class TerminalsRestNamespace {
  constructor(private http: HttpClient) {}

  async list(workspaceId: string, options?: ListOptions): Promise<ListTerminalSessionsResponse> {
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/terminals`, {
      signal: options?.signal,
    });
  }

  async create(workspaceId: string, options?: CreateOptions): Promise<CreateTerminalSessionResponse> {
    const { signal, body } = options ?? {};
    return this.http.post(`/workspaces/${encodeURIComponent(workspaceId)}/terminals`, body ?? {}, { signal });
  }

  async get(workspaceId: string, sessionId: string, options?: GetOptions): Promise<GetTerminalSessionResponse> {
    return this.http.get(
      `/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(sessionId)}`,
      { signal: options?.signal },
    );
  }

  /** Renames a terminal. Subscribers receive a title_changed event. */
  async rename(
    workspaceId: string,
    sessionId: string,
    title: string,
    options?: { signal?: AbortSignal },
  ): Promise<RenameTerminalSessionResponse> {
    return this.http.patch(
      `/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(sessionId)}`,
      { title },
      { signal: options?.signal },
    );
  }

  async delete(workspaceId: string, sessionId: string, options?: DeleteOptions): Promise<DeleteTerminalSessionResponse> {
    return this.http.delete(
      `/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(sessionId)}`,
      { signal: options?.signal },
    );
  }
}
