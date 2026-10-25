import type { HttpClient } from '../transport/http';
import type { AgentGroup, AgentGroupMessage, PermissionMode } from '../shared';

export interface ListGroupsResponse {
  groups: AgentGroup[];
}

export interface GetGroupResponse {
  group: AgentGroup;
}

export interface ListGroupMessagesResponse {
  messages: AgentGroupMessage[];
  hasMore: boolean;
}

export interface PostGroupMessageResponse {
  message: AgentGroupMessage;
  /** Member ids woken by this post. */
  woken: string[];
}

export interface CreateGroupInput {
  workspaceId: string;
  name: string;
  memberAgentIds: string[];
  defaultAgentId?: string;
  /** Default `standard`. */
  permissionMode?: PermissionMode;
}

export interface UpdateGroupInput {
  name?: string;
  defaultAgentId?: string;
  /** Applied to every member session. */
  permissionMode?: PermissionMode;
}

/** Group chats between the person and their agents (`/api/groups`). */
export class GroupsRestNamespace {
  constructor(private http: HttpClient) {}

  async list(workspaceId: string, options?: { signal?: AbortSignal }): Promise<ListGroupsResponse> {
    return this.http.get(`/workspaces/${encodeURIComponent(workspaceId)}/groups`, { signal: options?.signal });
  }

  async get(groupId: string, options?: { signal?: AbortSignal }): Promise<GetGroupResponse> {
    return this.http.get(`/groups/${encodeURIComponent(groupId)}`, { signal: options?.signal });
  }

  async create(body: CreateGroupInput, options?: { signal?: AbortSignal }): Promise<GetGroupResponse> {
    return this.http.post('/groups', body, { signal: options?.signal });
  }

  async update(groupId: string, body: UpdateGroupInput, options?: { signal?: AbortSignal }): Promise<GetGroupResponse> {
    return this.http.patch(`/groups/${encodeURIComponent(groupId)}`, body, { signal: options?.signal });
  }

  async delete(groupId: string, options?: { signal?: AbortSignal }): Promise<{ ok: boolean }> {
    return this.http.delete(`/groups/${encodeURIComponent(groupId)}`, { signal: options?.signal });
  }

  async addMember(groupId: string, agentId: string, options?: { signal?: AbortSignal }): Promise<GetGroupResponse> {
    return this.http.post(`/groups/${encodeURIComponent(groupId)}/members`, { agentId }, { signal: options?.signal });
  }

  async removeMember(groupId: string, agentId: string, options?: { signal?: AbortSignal }): Promise<GetGroupResponse> {
    return this.http.delete(`/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(agentId)}`, { signal: options?.signal });
  }

  /** The newest `limit` messages before `before` (a seq), oldest first. */
  async listMessages(groupId: string, query: { before?: number; limit?: number } = {}, options?: { signal?: AbortSignal }): Promise<ListGroupMessagesResponse> {
    const params = new URLSearchParams();
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.http.get(`/groups/${encodeURIComponent(groupId)}/messages${suffix}`, { signal: options?.signal });
  }

  /** The person posts; `mentions` are member ids chosen as chips, they win over `@Name` in the text. */
  async post(groupId: string, body: { text: string; mentions?: string[] }, options?: { signal?: AbortSignal }): Promise<PostGroupMessageResponse> {
    return this.http.post(`/groups/${encodeURIComponent(groupId)}/messages`, body, { signal: options?.signal });
  }
}
