import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, Sparkles } from "lucide-react";
import { GenerationCostNotice, TaskSettlement } from "@/components/generation-cost-notice";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { defaultImageParamsForModel, modelCompatibilityError } from "@/lib/model-selection";
import { packagingMockupRequirements, packagingMockupScenes } from "@/lib/packaging/mockup";
import type { PackagingProject } from "@/lib/packaging/types";
import { captureUserSession, assertCurrentUserSession } from "@/lib/user-scope";
import { packagingApi } from "@/services/api/packaging";
import { adminResourceFileUrl } from "@/services/api/admin-storage";
import { resourceFileUrl } from "@/services/api/resources";
import { cancelGenerationTask } from "@/services/api/task-center";
import { submitPackagingMockup } from "@/services/packaging-generation";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { downloadPackaging } from "@/lib/packaging/delivery";

export function PackagingMockups({ project, reference, enabled, admin = false }: { project: PackagingProject; reference?: Blob; enabled: boolean; admin?: boolean }) {
    const base = useEffectiveConfig();
    const user = useUserStore((state) => state.user?.id);
    const theme = useActiveTheme();
    const [model, setModel] = useState(base.imageModel || "");
    const [settings, setSettings] = useState(() => defaultImageParamsForModel(base, base.imageModel || ""));
    const [scene, setScene] = useState("studio");
    const [note, setNote] = useState("");
    const [preview, setPreview] = useState("");
    const [revisionReference, setRevisionReference] = useState<{ blob: Blob; resourceId: string; parentTaskId: string }>();
    const activeReference = revisionReference?.blob ?? reference;
    const compose = useRef<HTMLDivElement>(null);
    const [busy, setBusy] = useState(false);
    const [cancelling, setCancelling] = useState("");
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const operation = useRef<AbortController>(null);
    const client = useQueryClient();
    const config = useMemo(() => ({ ...base, ...settings, model, imageModel: model, count: "1", taskWorkflowProvider: "model" as const }), [base, settings, model]);
    const requirements = useMemo(() => packagingMockupRequirements(config), [config]);
    const problem = model ? modelCompatibilityError(config, model, requirements) : "请选择支持参考图编辑的图片模型";
    const key = ["packaging-mockups", user, project.id, admin, page];
    const tasks = useQuery({
        queryKey: key,
        enabled: Boolean(project.id),
        queryFn: ({ signal }) => packagingApi.mockups(project.id, page, signal, admin),
        refetchInterval: (query) => (query.state.data?.items.some((task) => task.status === "queued" || task.status === "running") ? 3000 : false),
    });
    useEffect(() => {
        if (!activeReference) return;
        const url = URL.createObjectURL(activeReference);
        setPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [activeReference]);
    useEffect(() => () => operation.current?.abort(), []);
    const run = async () => {
        if (!activeReference || busy) return;
        const controller = new AbortController();
        operation.current = controller;
        setBusy(true);
        setError("");
        try {
            await submitPackagingMockup(project, activeReference, config, scene, note, controller.signal, revisionReference);
            setPage(1);
            await client.invalidateQueries({ queryKey: ["packaging-mockups", user, project.id] });
        } catch (cause) {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "效果图任务提交失败");
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    };
    const imageUrl = admin ? adminResourceFileUrl : resourceFileUrl;
    const revise = async (resourceId: string, parentTaskId: string) => {
        if (busy) return;
        const controller = new AbortController();
        const session = captureUserSession();
        operation.current = controller;
        setBusy(true);
        setError("");
        try {
            const response = await fetch(imageUrl(resourceId), { credentials: "include", signal: AbortSignal.any([controller.signal, session.signal]) });
            if (!response.ok) throw new Error(`原效果图读取失败（${response.status}）`);
            const blob = await response.blob();
            assertCurrentUserSession(session);
            controller.signal.throwIfAborted();
            setRevisionReference({ blob, resourceId, parentTaskId });
            setNote("");
            compose.current?.scrollIntoView({ block: "start" });
        } catch (cause) {
            if (!controller.signal.aborted && !session.signal.aborted) setError(cause instanceof Error ? cause.message : "原效果图读取失败");
        } finally {
            if (!controller.signal.aborted && !session.signal.aborted) setBusy(false);
        }
    };
    const cancel = async (id: string) => {
        if (cancelling) return;
        const session = captureUserSession();
        setCancelling(id);
        setError("");
        try {
            await cancelGenerationTask(id);
            assertCurrentUserSession(session);
            await client.invalidateQueries({ queryKey: ["packaging-mockups", user, project.id] });
        } catch (cause) {
            if (!session.signal.aborted) setError(cause instanceof Error ? cause.message : "取消失败");
        } finally {
            if (!session.signal.aborted) setCancelling("");
        }
    };
    const download = async (id: string, taskId: string) => {
        const session = captureUserSession();
        const response = await fetch(imageUrl(id), { credentials: "include", signal: session.signal });
        if (!response.ok) throw new Error(`效果图下载失败（${response.status}）`);
        const blob = await response.blob();
        assertCurrentUserSession(session);
        downloadPackaging(blob, `${project.name}-${taskId}`, blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png");
    };
    return (
        <div className="pkg-workbench pkg-production pkg-mockups">
            {error || tasks.error ? (
                <p className="pkg-error" role="alert">
                    {error || tasks.error?.message}
                </p>
            ) : null}
            <div ref={compose} />
            {activeReference && !admin ? (
                <div className="pkg-mockup-compose">
                    <figure>
                        <img src={preview} alt="当前包装效果图参考" />
                        <figcaption>
                            {revisionReference ? "继续修改原效果图" : "当前 3D 视角 · 1024 × 1024"} · 项目 v{project.revision}
                        </figcaption>
                        {revisionReference && reference ? (
                            <button type="button" disabled={busy} onClick={() => setRevisionReference(undefined)}>
                                使用原 3D 参考
                            </button>
                        ) : null}
                    </figure>
                    <fieldset disabled={busy || !enabled}>
                        <label>
                            场景
                            <select aria-label="包装效果图场景" value={scene} onChange={(e) => setScene(e.target.value)}>
                                {packagingMockupScenes.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            补充要求
                            <textarea aria-label="包装效果图补充要求" rows={3} maxLength={1200} value={note} placeholder="背景、布光、道具和保留细节…" onChange={(e) => setNote(e.target.value)} />
                        </label>
                        <ModelPicker
                            config={config}
                            value={model}
                            onChange={(value) => {
                                setModel(value);
                                setSettings(defaultImageParamsForModel(base, value));
                            }}
                            capability="image"
                            requirements={requirements}
                            fullWidth
                            showOptionPrices
                        />
                        {model ? (
                            <ImageSettingsPanel config={config} onConfigChange={(name, value) => setSettings((current) => ({ ...current, [name]: value }))} theme={canvasThemes[theme]} showTitle={false} showCount={false} showTransparent={false} />
                        ) : null}
                        <p className="pkg-help">{!enabled ? "后台未开放包装效果图生成" : problem || "每次提交一张效果图，按所选模型计费。"}</p>
                        <GenerationCostNotice config={config} model={model} capability="image" requirements={requirements} label="包装效果图" />
                        <button type="button" className="pkg-primary" disabled={!enabled || busy || Boolean(problem)} onClick={() => void run()}>
                            <Sparkles size={15} />
                            {busy ? "正在处理…" : revisionReference ? "让 AI 继续修改" : "生成包装效果图"}
                        </button>
                    </fieldset>
                </div>
            ) : !admin ? (
                <p className="pkg-help">保存方案后，在 3D 面板选择视角并点击“用此视角生成效果图”。</p>
            ) : null}
            <p className="pkg-help">模型使用这张包装参考图生成场景和材质效果。生成后核对文字、Logo、开合与结构；效果图独立存入素材库，不更改刀版或印刷稿。</p>
            {scene === "design" ? <p className="pkg-help">创意提案允许 AI 探索配色与排版。认可的设计仍需制作平面印刷稿，再回贴到刀版确认各面与出血。</p> : null}
            <div className="pkg-toolbar">
                <strong>效果图库 · {tasks.data?.total ?? 0} 次生成</strong>
                <button type="button" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>
                    <RefreshCw size={14} />
                    刷新
                </button>
            </div>
            {tasks.isLoading ? <p role="status">读取效果图任务…</p> : null}
            <TaskSettlement ids={admin ? [] : (tasks.data?.items.map((task) => task.id) ?? [])} />
            <div className="pkg-mockup-results">
                {tasks.data?.items.map((task) => (
                    <article key={task.id}>
                        <div className="pkg-toolbar">
                            <strong>
                                v{task.packagingRevision} · {packagingMockupScenes.find((s) => s.id === task.scene)?.name || task.scene}
                            </strong>
                            <span>{{ queued: "排队中", running: "生成中", succeeded: "已生成", failed: "生成失败", cancelled: "已取消" }[task.status]}</span>
                        </div>
                        <small>
                            {task.model} · {new Date(task.createdAt).toLocaleString()}
                        </small>
                        {task.referenceResourceId ? (
                            <details>
                                <summary>生成参考</summary>
                                <img src={imageUrl(task.referenceResourceId)} alt={`项目 v${task.packagingRevision} 的生成参考`} />
                            </details>
                        ) : null}
                        {task.outputResourceIds.map((id) => (
                            <div key={id}>
                                <img src={imageUrl(id)} alt={`包装效果图 · ${task.id}`} />
                                <div className="pkg-toolbar">
                                    <button type="button" onClick={() => void download(id, task.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "下载失败"))}>
                                        <Download size={14} />
                                        下载效果图
                                    </button>
                                    {!admin ? (
                                        <button
                                            type="button"
                                            disabled={busy || !enabled || task.packagingRevision !== project.revision}
                                            title={task.packagingRevision !== project.revision ? "该结果属于旧方案版本，请从当前保存方案重新生成" : "基于这张效果图继续调整背景、材质与设计"}
                                            onClick={() => void revise(id, task.id)}
                                        >
                                            继续修改
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                        {task.status === "queued" || task.status === "running" ? (
                            <>
                                <p role="status">
                                    {task.stage} · {task.progress}%
                                </p>
                                {!admin ? (
                                    <button type="button" disabled={Boolean(cancelling)} onClick={() => void cancel(task.id)}>
                                        {cancelling === task.id ? "正在取消…" : "取消生成"}
                                    </button>
                                ) : null}
                            </>
                        ) : null}
                        {task.status === "failed" ? <p className="pkg-help">{task.errorCode || "任务执行失败，可在任务中心查看详情"}</p> : null}
                        <details>
                            <summary>生成要求</summary>
                            <p className="pkg-help">{task.prompt}</p>
                            <small>任务 {task.id}</small>
                        </details>
                        {task.parentTaskId ? <small>上一轮任务 {task.parentTaskId}</small> : null}
                    </article>
                ))}
            </div>
            {tasks.data && tasks.data.total > 12 ? (
                <div className="pkg-toolbar">
                    <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        上一页
                    </button>
                    <span>{page} 页</span>
                    <button type="button" disabled={page * 12 >= tasks.data.total} onClick={() => setPage((p) => p + 1)}>
                        下一页
                    </button>
                </div>
            ) : null}
            {tasks.data?.total === 0 ? <p>当前项目还没有模型效果图。</p> : null}
        </div>
    );
}
