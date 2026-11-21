import { localForageStorageForScope } from "@/lib/localforage-storage";
import { markdownPlainText } from "@/lib/markdown-plain-text";
import { getActiveUserScope } from "@/lib/user-scope";
import type { AgentPermissionMode, AgentRun } from "@/services/api/agent";
import { isAgentPageContext, type AgentRequestTarget } from "@/lib/agent-page-context";
import { loadAgentConversationRows, saveAgentConversationRows } from "@/services/cloud-agent-conversation-store";

export type CloudAgentMessagePresentation = {
    displayText?: string;
    canvasReferenceNodeId?: string;
};

export type CloudAgentDraftPrefill = CloudAgentMessagePresentation & {
    text: string;
    target: AgentRequestTarget;
    requiresVision?: boolean;
};

export type CloudAgentConversationMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    streaming?: boolean;
    reasoning?: boolean;
    planItems?: Array<{ id: string; title: string; status: "pending" | "doing" | "done" }>;
    planTerminal?: boolean;
    question?: { question: string; options: Array<{ label: string; detail?: string }>; allowFreeform?: boolean };
    meta?: string;
    detail?: unknown;
    attachments?: Array<{ id: string; name: string; url: string }>;
    interjection?: CloudAgentInterjectionState;
};

/**
 * 插话气泡状态。sending：请求还没返回（只在内存里，不写入本机快照）；
 * requeued：未送达后已转为下一轮（重新进入队列），不再提供转发入口。
 */
export type CloudAgentInterjectionState = "sending" | "sent" | "delivered" | "undelivered" | "withdrawn" | "requeued";

export type CloudAgentConversation = {
    id: string;
    serverConversationId?: string;
    runs?: AgentRun[];
    lastEventSeq?: number;
    /** 未发送草稿和主动选中的会话只属于本机，不由云端覆盖。 */
    draft?: string;
    draftEditId?: string;
    /** 页面讨论的完整要求与原目标，随本机草稿保存，刷新不能改投当前页。 */
    draftPrefill?: CloudAgentDraftPrefill;
    localNewCanvasId?: string;
    localSelectedCanvasId?: string;
    title: string;
    messages: CloudAgentConversationMessage[];
    run: AgentRun | null;
    model?: string;
    permissionMode: AgentPermissionMode;
    skillIds?: string[];
    createdAt: string;
    updatedAt: string;
};

type CloudAgentConversationDocument = {
    version: 1;
    activeId: string | null;
    conversations: CloudAgentConversation[];
    readOnly?: true;
};

export type CloudAgentPendingSubmission = CloudAgentMessagePresentation & {
    fingerprint: string;
    key: string;
    draftEditId?: string;
    request?: import("@/services/api/agent").CreateAgentRunInput;
    parentRunId?: string;
    messageId?: string;
};

const CLOUD_AGENT_CONVERSATIONS_KEY = "cloud-agent-conversations-v2";

// 平台只有一个 Agent：对话按账号保存，不再按画布分桶。每轮绑定哪个画布由发送时所在页面决定。
export async function loadCloudAgentConversations(scope = getActiveUserScope()): Promise<CloudAgentConversationDocument> {
    const restored = await loadAgentConversationRows(CLOUD_AGENT_CONVERSATIONS_KEY, scope, parseLegacyArchive, (raw) => {
        const row: unknown = JSON.parse(raw);
        if (!isConversation(row)) throw new Error("Agent 对话历史格式无效");
        return row;
    });
    return { version: 1, ...restored };
}

function parseLegacyArchive(value: string): CloudAgentConversationDocument {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("Agent 对话历史已损坏");
    }
    if (!isConversationDocument(parsed)) throw new Error("Agent 对话历史格式无效");
    return parsed;
}

export function saveCloudAgentConversations(activeId: string | null, conversation: CloudAgentConversation | undefined, scope = getActiveUserScope(), deleted: string[] = []) {
    return saveAgentConversationRows(CLOUD_AGENT_CONVERSATIONS_KEY, scope, activeId, conversation, deleted);
}

// Keep the retry key outside the chat snapshot. If the response is lost, a
// page refresh can safely repeat the same request without creating another
// billed Agent turn.
export async function loadCloudAgentPendingSubmission(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) return null;
    const value = await localForageStorageForScope(scope).getItem(pendingStorageKey(conversationId));
    if (value === null || value === undefined) return null;
    // A corrupt recovery record is not proof that the previous POST never ran.
    // Fail closed rather than discarding its identity and risking another charge.
    try {
        const parsed = JSON.parse(value) as Partial<CloudAgentPendingSubmission> | null;
        if (!parsed || typeof parsed.fingerprint !== "string" || typeof parsed.key !== "string" || parsed.key.length < 8) throw new Error("invalid identity");
        if (parsed.request !== undefined && (!parsed.request || parsed.request.idempotencyKey !== parsed.key || typeof parsed.request.canvasId !== "string" || typeof parsed.request.prompt !== "string")) throw new Error("invalid request");
        if (parsed.parentRunId !== undefined && typeof parsed.parentRunId !== "string") throw new Error("invalid parent");
        if (parsed.messageId !== undefined && typeof parsed.messageId !== "string") throw new Error("invalid message");
        return {
            fingerprint: parsed.fingerprint,
            key: parsed.key,
            ...(typeof parsed.draftEditId === "string" ? { draftEditId: parsed.draftEditId } : {}),
            request: renameLegacySkillIds(parsed.request),
            parentRunId: parsed.parentRunId,
            messageId: parsed.messageId,
            displayText: parsed.displayText,
            canvasReferenceNodeId: parsed.canvasReferenceNodeId,
        } satisfies CloudAgentPendingSubmission;
    } catch {
        throw new Error("待确认请求记录损坏，已暂停本对话发送；请先在任务中心核对原运行，不要直接重复生成");
    }
}

// 请求字段已改名为 pinnedSkillIds，后端拒绝未知字段：升级前保存、尚未发出的待确认请求改名后再重放，
// 否则这条对话会一直卡在“上一条请求待确认”。
function renameLegacySkillIds(request: CloudAgentPendingSubmission["request"]) {
    if (!request || !("skillIds" in request)) return request;
    const { skillIds, ...rest } = request as typeof request & { skillIds?: string[] };
    return { ...rest, pinnedSkillIds: rest.pinnedSkillIds ?? skillIds };
}

export async function saveCloudAgentPendingSubmission(conversationId: string, pending: CloudAgentPendingSubmission, scope = getActiveUserScope()) {
    if (!conversationId) throw new Error("缺少 Agent 对话范围，无法保存幂等提交");
    await localForageStorageForScope(scope).setItem(pendingStorageKey(conversationId), JSON.stringify(pending));
}

export async function clearCloudAgentPendingSubmission(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) return;
    await localForageStorageForScope(scope).removeItem(pendingStorageKey(conversationId));
}

export function cloudAgentConversationServerId(conversation: CloudAgentConversation) {
    return conversation.serverConversationId || conversation.run?.conversationId;
}

export function cloudAgentPendingMatchesRun(pending: CloudAgentPendingSubmission | null, run: AgentRun | null) {
    return Boolean(pending?.key && run?.idempotencyKey && pending.key === run.idempotencyKey);
}

export function cloudAgentConversationTitle(messages: CloudAgentConversationMessage[]) {
    const firstPrompt = displayConversationTitle(messages.find((message) => message.role === "user")?.text || "");
    return firstPrompt.length > 28 ? `${firstPrompt.slice(0, 28)}...` : firstPrompt;
}

function displayConversationTitle(value: string) {
    return markdownPlainText(value.replace(/@\[skill:[^\]]+\]/gu, "技能包")) || "新对话";
}

function pendingStorageKey(conversationId: string) {
    return `${CLOUD_AGENT_CONVERSATIONS_KEY}:pending:${encodeURIComponent(conversationId)}`;
}

function isConversationDocument(value: unknown): value is CloudAgentConversationDocument {
    if (!value || typeof value !== "object") return false;
    const document = value as Partial<CloudAgentConversationDocument>;
    if (document.version !== 1 || !Array.isArray(document.conversations)) return false;
    return document.conversations.every(isConversation);
}

function isConversation(value: unknown): value is CloudAgentConversation {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<CloudAgentConversation>;
    return (
        typeof candidate.id === "string" &&
        typeof candidate.title === "string" &&
        Array.isArray(candidate.messages) &&
        typeof candidate.createdAt === "string" &&
        typeof candidate.updatedAt === "string" &&
        (candidate.draftPrefill === undefined || isDraftPrefill(candidate.draftPrefill)) &&
        ["read_only", "auto", "request_approval"].includes(candidate.permissionMode || "")
    );
}

function isDraftPrefill(value: unknown): value is CloudAgentDraftPrefill {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<CloudAgentDraftPrefill>;
    const target = candidate.target;
    return (
        typeof candidate.text === "string" &&
        typeof candidate.displayText === "string" &&
        Boolean(target && typeof target.canvasId === "string" && (target.pageContext === undefined || (!target.canvasId && isAgentPageContext(target.pageContext)))) &&
        (candidate.requiresVision === undefined || typeof candidate.requiresVision === "boolean") &&
        (candidate.canvasReferenceNodeId === undefined || typeof candidate.canvasReferenceNodeId === "string")
    );
}
