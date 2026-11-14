import { nanoid } from "nanoid";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { packagingMockupConfig, packagingMockupPrompt } from "@/lib/packaging/mockup";
import type { PackagingProject } from "@/lib/packaging/types";
import { packagingApi } from "@/services/api/packaging";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { AiConfig } from "@/stores/use-config-store";

export async function submitPackagingMockup(project: PackagingProject, reference: Blob, config: AiConfig, scene: string, note: string, signal: AbortSignal, source?: { resourceId: string; parentTaskId: string }) {
    if (!project.id || project.revision < 1) throw new Error("请先把包装方案保存到服务器，再生成效果图");
    const session = captureUserSession();
    const boundary = AbortSignal.any([signal, session.signal]);
    const generation = packagingMockupConfig(config);
    const current = await packagingApi.project(project.id, boundary);
    assertCurrentUserSession(session);
    if (current.revision !== project.revision) throw new Error("包装方案版本已更新，请重新载入并截取参考图");
    const prompt = packagingMockupPrompt(current, scene, note);
    const resource = source ? { id: source.resourceId } : await uploadResourceFile(reference, "image", { fileName: "packaging-reference.png", expectedUserId: session.scope, signal: boundary });
    assertCurrentUserSession(session);
    return submitBackendGenerationTask({
        mode: "image",
        config: generation,
        prompt,
        expectedUserScope: session.scope,
        signal: boundary,
        clientOperationId: `packaging-${nanoid()}`,
        referenceImages: [{ id: resource.id, name: "当前包装结构与印刷参考", type: "image/png", dataUrl: "", storageKey: resourceStorageKey(resource.id), ...(source ? {} : { width: 1024, height: 1024 }) }],
        metadata: { source: "packaging-mockup", packagingProjectId: project.id, packagingRevision: project.revision, packagingReferenceId: resource.id, packagingScene: scene, ...(source ? { packagingParentTaskId: source.parentTaskId } : {}) },
    }).catch((cause: unknown) => {
        if (boundary.aborted) throw cause;
        throw new Error(`${cause instanceof Error ? cause.message : "任务提交失败"}；${source ? "原效果图保留在素材库" : "已上传的包装参考图保留在素材库"}`, { cause });
    });
}
