import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Button, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { CreationMessageView } from "@/pages/create/creation-workspace-messages";
import type { CreationMessage } from "@/pages/create/creation-types";
import { useThemeStore } from "@/stores/use-theme-store";
import { getActiveUserScope } from "@/lib/user-scope";
import { loadAssetLibraryPage } from "@/services/user-data-sync";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { WorkbenchGalleryTile, type GalleryActions, type GalleryBatch } from "@/pages/workbench/workbench-gallery";
import { ImageNodeContent } from "@/components/canvas/canvas-node-media-content";
import { CanvasNodeType } from "@/types/canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import type { GenerationTask } from "@/services/api/task-center";
import { ResultTile } from "@/pages/ecommerce-studio/studio-results";
import { createStudioProduct } from "@/lib/ecommerce-studio/product";
import type { StudioShot } from "@/lib/ecommerce-studio/types";
import "@/pages/ecommerce-studio/studio.css";
import "@/pages/workbench/workbench.css";
import "@/pages/create/creation-product.css";

const samples = ["fantasy-3d", "suspense-noir", "cyberpunk-neon", "ink-narrative", "space-opera", "watercolor", "chibi-3d", "food-healing"];
const sampleProduct = createStudioProduct("image-pack-demo", "2026-11-15T00:00:00.000Z");
const noop = () => {};
const galleryActions: GalleryActions = {
    openOutput: noop,
    download: noop,
    cancelTask: noop,
    retryTask: noop,
    reuse: noop,
    copyPrompt: noop,
    downloadAll: noop,
    cancelBatch: noop,
    retryFailed: noop,
    resume: noop,
    dismiss: noop,
    visible: noop,
    measure: noop,
};

export default function ImagePackLab() {
    const [count, setCount] = useState(5);
    const [surface, setSurface] = useState("create");
    const [failure, setFailure] = useState("task");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [item, setItem] = useState<CreationMessage>({ id: "image-pack-preview", role: "assistant", mode: "image", status: "done", content: "示例图演示", createdAt: "2026-11-15T00:00:00.000Z" });
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const studioAssets = useQuery({
        queryKey: ["dev-image-pack-existing-images", getActiveUserScope()],
        queryFn: ({ signal }) => loadAssetLibraryPage({ page: 1, pageSize: 8, kind: "image", status: "active", signal }),
        enabled: surface === "studio",
        retry: false,
    });
    const assets = studioAssets.data?.assets || [];
    const studioImages = assets.flatMap((asset) => {
        if (asset.kind !== "image") return [];
        const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
        return resourceId ? [{ resourceId, width: asset.data.width, height: asset.data.height }] : [];
    });
    useEffect(() => {
        if (item.status !== "pending") return;
        const timer = window.setTimeout(() => setItem((current) => ({ ...current, status: "done" })), 1800);
        return () => window.clearTimeout(timer);
    }, [item.status]);
    const startGeneration = () => setItem({ id: "image-pack-preview", role: "assistant", mode: "image", status: "pending", content: "示例图演示", createdAt: new Date().toISOString(), taskIds: ["image-pack-demo"], generationStatus: "running" });
    const task: GenerationTask = {
        id: "image-pack-demo",
        type: "image",
        status: item.status === "pending" ? "running" : item.status === "cancelled" ? "cancelled" : item.status === "error" ? "failed" : "succeeded",
        prompt: "示例图演示",
        error: item.error,
        stage: "正在生成图片",
        attempts: 1,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
    };
    const batch: GalleryBatch = {
        key: "demo",
        createdAt: item.createdAt,
        prompt: "示例图演示",
        chips: [],
        tiles: [],
        tasks: [task],
        outputs: [],
        counts: { done: 0, active: 0, failed: 0, pending: 0, total: count },
        resumable: 0,
        submitting: false,
        localOnly: true,
        ratio: 16 / 9,
    };
    return (
        <main className={`creation-home app-user-overlays${surface === "workbench" ? " wb-library-modal" : ""}`} style={{ display: "block", maxWidth: 1000, margin: "0 auto", padding: "var(--space-6)", color: "var(--workspace-text)" }}>
            <Link to="/create">← 返回创作页</Link>
            <h1 style={{ fontSize: "var(--fs-title)", marginTop: "var(--space-6)" }}>图片生成特效</h1>
            <p style={{ color: "var(--workspace-text-muted)", marginBottom: "var(--space-5)" }}>使用项目示例图模拟生成过程：生成中显示卡包，完成后自动展开为图片结果。电商生图台复用素材库里已有的图片。这里不会提交模型任务。</p>
            <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-5)", flexWrap: "wrap" }}>
                <Select
                    aria-label="动效测试入口"
                    virtual={false}
                    value={surface}
                    disabled={item.status === "pending"}
                    onChange={setSurface}
                    options={[
                        { value: "create", label: "创作页" },
                        { value: "workbench", label: "图片工具箱" },
                        { value: "studio", label: "电商生图台" },
                        { value: "canvas", label: "画布节点（缩放 65%）" },
                    ]}
                    style={{ minWidth: 200 }}
                />
                {[1, 5, 8].map((value) => (
                    <Button key={value} disabled={item.status === "pending"} aria-pressed={count === value} onClick={() => setCount(value)}>
                        {value} 张图片
                    </Button>
                ))}
                <Button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>切换明暗主题</Button>
                <Button type="primary" disabled={item.status === "pending" || (surface === "studio" && !studioImages.length)} onClick={startGeneration}>
                    模拟图片生成
                </Button>
                <select aria-label="异常提示场景" value={failure} disabled={item.status === "pending"} onChange={(event) => setFailure(event.target.value)}>
                    <option value="task">生成失败</option>
                    <option value="cancelled">已取消</option>
                    {surface === "create" ? (
                        <>
                            <option value="sync">结果未同步</option>
                            <option value="save">保存失败</option>
                            <option value="cost">费用待核对</option>
                        </>
                    ) : null}
                </select>
                <Button
                    disabled={item.status !== "pending"}
                    onClick={() =>
                        setItem((current) => ({
                            ...current,
                            status: failure === "cancelled" ? "cancelled" : "error",
                            errorKind: failure === "sync" ? "sync" : "task",
                            mediaRecoverable: failure === "save",
                            error: failure === "cost" ? "上游请求超时（524）" : "演示任务失败",
                            content: failure === "cancelled" ? "已停止" : current.content,
                        }))
                    }
                >
                    模拟生成失败
                </Button>
            </div>
            {surface === "create" ? (
                <CreationMessageView
                    key={count}
                    item={{ ...item, settings: { ratio: "16:9", count: String(count), quality: "auto", seconds: "", videoQuality: "" }, resultUrls: item.status === "done" ? samples.slice(0, count).map((name) => `/short-drama-styles/${name}.jpg`) : [] }}
                    shotNumber={1}
                    onEditUserMessage={noop}
                    onRetryFailure={startGeneration}
                    onRefreshResult={noop}
                    onRecoverMedia={noop}
                    onCreateVariant={noop}
                    onContinueCanvas={noop}
                    openingCanvas={false}
                />
            ) : surface === "workbench" ? (
                <div className="wb-tiles" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", "--wb-tile-ratio": batch.ratio } as CSSProperties}>
                    {samples.slice(0, count).map((name, index) => (
                        <WorkbenchGalleryTile
                            key={`${surface}-${index}`}
                            kind="image"
                            batch={batch}
                            actions={{ ...galleryActions, retryTask: startGeneration }}
                            busy={false}
                            tile={
                                item.status === "pending"
                                    ? { type: "active", key: String(index), task, slot: index }
                                    : item.status === "error" || item.status === "cancelled"
                                      ? { type: "failed", key: String(index), task }
                                      : { type: "output", key: String(index), task, output: { key: String(index), taskId: task.id, index, kind: "image", url: `/short-drama-styles/${name}.jpg`, thumbUrl: `/short-drama-styles/${name}.jpg` } }
                            }
                        />
                    ))}
                </div>
            ) : surface === "studio" ? (
                <div className="es-portal" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
                    {studioAssets.error ? (
                        <p role="alert">读取素材失败：{studioAssets.error.message}</p>
                    ) : !studioImages.length ? (
                        <p role="status">{studioAssets.isFetching ? "正在读取已有图片…" : "素材库暂无已上传的图片，其他入口可直接使用项目示例图。"}</p>
                    ) : null}
                    {studioImages.slice(0, count).map((image, index) => {
                        const shot: StudioShot = {
                            id: `demo-${index}`,
                            role: "main-white",
                            title: `${String(index + 1).padStart(2, "0")} · 示例商品图片`,
                            ratio: "3:4",
                            headline: "",
                            subline: "",
                            lines: [],
                            sellingPointIds: [],
                            tweaks: [],
                            attempts: [
                                {
                                    id: `attempt-${index}`,
                                    model: "sample",
                                    status: task.status,
                                    createdAt: item.createdAt,
                                    error: item.error,
                                    tweaks: [],
                                    outputs: item.status === "done" ? [{ ...image, url: "" }] : [],
                                },
                            ],
                        };
                        return (
                            <ResultTile
                                key={shot.id}
                                product={sampleProduct}
                                group={{ key: "sample", ref: { planKind: "main" }, title: "示例商品图片", createdAt: item.createdAt, textMode: "model", shots: [shot], fromAgent: false }}
                                shot={shot}
                                blocked=""
                                onView={noop}
                                onDownload={noop}
                                onReference={noop}
                                onRerun={startGeneration}
                                onSync={noop}
                            />
                        );
                    })}
                </div>
            ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                    {samples.slice(0, count).map((name, index) => (
                        <div key={`${surface}-${index}`} style={{ width: 208, height: 156 }}>
                            <div style={{ width: 320, height: 240, transform: "scale(0.65)", transformOrigin: "0 0" }}>
                                <ImageNodeContent
                                    node={{
                                        id: `demo-${index}`,
                                        type: CanvasNodeType.Image,
                                        title: "示例图片",
                                        position: { x: 0, y: 0 },
                                        width: 320,
                                        height: 240,
                                        metadata: {
                                            status: item.status === "pending" ? "loading" : item.status === "error" || item.status === "cancelled" ? "error" : "success",
                                            content: item.status === "done" ? `/short-drama-styles/${name}.jpg` : "",
                                            taskStatus: task.status,
                                            taskId: task.id,
                                            taskCreatedAt: task.createdAt,
                                            taskStage: task.stage,
                                            errorDetails: item.error,
                                        },
                                    }}
                                    theme={theme === "dark" ? canvasThemes.dark : canvasThemes.light}
                                    renderLOD="full"
                                    isEditingContent={false}
                                    textareaRef={textareaRef}
                                    isBatchRoot={false}
                                    batchCount={0}
                                    batchExpanded={false}
                                    batchOpening={false}
                                    batchRecovering={false}
                                    onContentChange={noop}
                                    onRetry={startGeneration}
                                    onStopEditing={noop}
                                    mentionReferences={[]}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
