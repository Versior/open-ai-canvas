import { App } from "antd";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { buildVideoFrameNodes } from "@/lib/canvas/canvas-video-frame-nodes";
import {
    buildVideoTeardownPrompt,
    buildVideoTeardownSummaryPrompt,
    parseVideoTeardownAnalysis,
    parseVideoTeardownSummary,
    videoTeardownBatchTable,
    videoTeardownModelError,
    videoTeardownReportMarkdown,
    videoTeardownStoryboardRows,
    videoTeardownTextRequirements,
    VIDEO_TEARDOWN_MAX_GRIDS_PER_REQUEST,
    type VideoTeardownAnalysis,
    type VideoTeardownAnalysisRow,
    type VideoTeardownOptions,
} from "@/lib/canvas/video-teardown";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { modelCompatibilityError } from "@/lib/model-selection";
import { getActiveUserScope } from "@/lib/user-scope";
import { runBackendGenerationTask } from "@/services/api/generation-task";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey } from "@/services/api/resources";
import { waitForGenerationTask } from "@/services/api/task-center";
import { createVideoTeardown, parseVideoTeardownBundle, type VideoTeardownBundle, type VideoTeardownGrid } from "@/services/api/video-replication";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";
import type { StartCanvasUploadStatus } from "./use-canvas-upload";

type UseCanvasVideoTeardownOptions = {
    canvasId: string;
    config: AiConfig;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    setNodes: (nodes: CanvasNodeData[]) => void;
    setConnections: (connections: CanvasConnection[]) => void;
    setSelectedNodeIds: (ids: Set<string>) => void;
    setSelectedConnectionId: (id: string | null) => void;
    setDialogNodeId: (id: string | null) => void;
    startUploadStatus: StartCanvasUploadStatus;
    /** 把视野移到新建的分镜表。 */
    focusNode?: (nodeId: string) => void;
};

const TEARDOWN_TASK_TIMEOUT_MS = 11 * 60 * 1000;
const REPORT_SIZE = { width: 520, height: 680 };
const TABLE_SIZE = { width: 1280, height: 560 };
const NODE_GAP = 120;
// 关键帧缩成小图排成网格：几十个镜头也不会铺满画布；节点标题在图上方，行距留出标题高度。
const KEYFRAME_BOX = 240;
const KEYFRAME_GAP = { x: 24, y: 64 };
const KEYFRAME_MAX_COLUMNS = 6;
// 竖屏 9:16（420×747）和横屏 16:9（720×405）视频节点都放得下的占位框。
const VIDEO_SLOT = { width: 720, height: 760 };

/** 弹窗里新导入的视频先放到视野中心附近的空位，后面的关键帧和表格跟在它右侧。 */
export function teardownVideoSlot(nodes: CanvasNodeData[], center: Position) {
    const topLeft = findAvailableGenerationGroupPosition(nodes, { x: center.x - VIDEO_SLOT.width / 2, y: center.y - VIDEO_SLOT.height / 2 }, VIDEO_SLOT);
    return { topLeft, center: { x: topLeft.x + VIDEO_SLOT.width / 2, y: topLeft.y + VIDEO_SLOT.height / 2 } };
}

function isAbort(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}

/**
 * 画布上的「拆解复刻」：后端切镜抽帧 → 看图模型逐镜分析 → 在视频右侧放关键帧、拆解分镜表和拆解报告。
 * 同一时间只跑一个拆解；切换画布或账号时中止，不把结果写进别的画布。
 */
export function useCanvasVideoTeardown({ canvasId, config, nodesRef, connectionsRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId, startUploadStatus, focusNode }: UseCanvasVideoTeardownOptions) {
    const { message } = App.useApp();
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const runningRef = useRef(false);
    const controllersRef = useRef(new Set<AbortController>());

    useEffect(
        () => () => {
            controllersRef.current.forEach((controller) => controller.abort());
            controllersRef.current.clear();
        },
        [canvasId],
    );

    const analyze = useCallback(
        async (videoNode: CanvasNodeData, bundle: VideoTeardownBundle, options: VideoTeardownOptions & { signal: AbortSignal; expectedScope: string; onProgress: (detail: string) => void }): Promise<VideoTeardownAnalysis> => {
            const maxImages = modelCapabilityConfigFor(config, options.model).text?.references.maxImages ?? 0;
            const batchSize = Math.min(VIDEO_TEARDOWN_MAX_GRIDS_PER_REQUEST, maxImages);
            if (batchSize < 1) throw new Error("所选模型不支持图片输入，请换一个能看图的文本模型");
            const batches: VideoTeardownGrid[][] = [];
            for (let start = 0; start < bundle.grids.length; start += batchSize) batches.push(bundle.grids.slice(start, start + batchSize));
            const run = async (prompt: string, grids: VideoTeardownGrid[]) => {
                const requirements = videoTeardownTextRequirements(config, grids.length);
                const error = modelCompatibilityError(config, options.model, requirements);
                if (error) throw new Error(`所选模型不能用于拆解：${error}`);
                const nodeForConfig = { ...videoNode, metadata: { ...videoNode.metadata, model: options.model } };
                const result = await runBackendGenerationTask({
                    projectId: canvasId,
                    mode: "text",
                    prompt,
                    config: { ...buildGenerationConfig(config, nodeForConfig, "text", requirements), model: options.model },
                    referenceImages: grids.map((grid, index) => ({
                        id: grid.resourceId,
                        name: `宫格 ${index + 1}`,
                        type: "image/jpeg",
                        dataUrl: "",
                        storageKey: resourceStorageKey(grid.resourceId),
                        width: grid.width,
                        height: grid.height,
                    })),
                    streamText: false,
                    signal: options.signal,
                    expectedUserScope: options.expectedScope,
                });
                return result.text || "";
            };
            // 回复缺镜头或不是 JSON 时重试一次，再失败就报错，不拿空行补齐。
            const withRetry = async <T>(attempt: () => Promise<T>) => {
                try {
                    return await attempt();
                } catch (error) {
                    if (isAbort(error) || options.signal.aborted) throw error;
                    return attempt();
                }
            };
            const rows: VideoTeardownAnalysisRow[] = [];
            let title = "";
            let summary: VideoTeardownAnalysis["summary"] = null;
            for (const [index, grids] of batches.entries()) {
                options.onProgress(batches.length > 1 ? `模型分析镜头（${index + 1}/${batches.length}）` : "模型分析镜头");
                const withSummary = batches.length === 1;
                const expected = grids.flatMap((grid) => grid.shotIndexes);
                const analysis = await withRetry(async () => parseVideoTeardownAnalysis(await run(buildVideoTeardownPrompt(bundle, grids, withSummary), grids), expected, withSummary));
                rows.push(...analysis.rows);
                if (withSummary) ({ title, summary } = analysis);
            }
            if (batches.length > 1) {
                options.onProgress("总结全片结构");
                ({ title, summary } = await withRetry(async () => parseVideoTeardownSummary(await run(buildVideoTeardownSummaryPrompt(bundle, rows), []))));
            }
            return { title: title || videoNode.title || "视频拆解", summary, rows };
        },
        [canvasId, config],
    );

    const runTeardown = useCallback(
        async (videoNode: CanvasNodeData, options: VideoTeardownOptions) => {
            if (runningRef.current) {
                message.info("正在拆解另一段视频，请等它完成");
                return;
            }
            const resourceId = resourceIdFromStorageKey(videoNode.metadata?.storageKey);
            if (videoNode.type !== CanvasNodeType.Video || !resourceId) {
                message.warning("视频还没有保存到服务器，等上传完成后再拆解");
                return;
            }
            const modelError = videoTeardownModelError(config, options.model);
            if (modelError) {
                message.warning(modelError);
                return;
            }
            runningRef.current = true;
            setRunningNodeId(videoNode.id);
            const controller = new AbortController();
            controllersRef.current.add(controller);
            const expectedScope = getActiveUserScope();
            const assertCurrent = () => {
                if (!controller.signal.aborted && getActiveUserScope() !== expectedScope) controller.abort();
                if (controller.signal.aborted) throw new DOMException("拆解上下文已变化", "AbortError");
            };
            const progress = startUploadStatus("拆解复刻", "提交拆解任务", 4);
            try {
                const created = await createVideoTeardown({ resourceId, projectId: canvasId, transcribe: options.transcribe }, controller.signal);
                assertCurrent();
                const task = await waitForGenerationTask(created.id, {
                    initialTask: created,
                    signal: controller.signal,
                    timeoutMs: TEARDOWN_TASK_TIMEOUT_MS,
                    onTaskUpdate: (current) => {
                        const percent = typeof current.progress === "number" ? ` ${Math.round(Math.min(Math.max(current.progress, 0), 100))}%` : "";
                        progress.update(`${current.stage || "切镜、截取关键帧"}${percent}`, 1);
                    },
                });
                assertCurrent();
                const bundle = parseVideoTeardownBundle(task);
                progress.update(`已切出 ${bundle.shots.length} 个镜头，模型分析中`, 2);
                const analysis = await analyze(videoNode, bundle, { ...options, signal: controller.signal, expectedScope, onProgress: (detail) => progress.update(detail, 2) });
                assertCurrent();
                progress.update("写入画布", 3);
                const anchor = nodesRef.current.find((item) => item.id === videoNode.id) ?? videoNode;
                const placed = buildTeardownCanvasNodes(anchor, bundle, analysis, options.model, nodesRef.current);
                const nextNodes = [...nodesRef.current, ...placed.nodes];
                const nextConnections = [...connectionsRef.current, ...placed.connections];
                nodesRef.current = nextNodes;
                connectionsRef.current = nextConnections;
                setNodes(nextNodes);
                setConnections(nextConnections);
                const tableId = placed.tableId;
                const createdCount = placed.nodes.length;
                setSelectedNodeIds(new Set([tableId]));
                setSelectedConnectionId(null);
                focusNode?.(tableId);
                setDialogNodeId(tableId);
                progress.done(`已拆出 ${bundle.shots.length} 个镜头`);
                message.success(`拆解完成：${bundle.shots.length} 个镜头，关键帧、分镜表和拆解报告已放在视频右侧（共 ${createdCount} 个节点）`);
                if (bundle.warnings.length) message.warning(bundle.warnings.join("；"));
            } catch (error) {
                if (isAbort(error)) return;
                const details = error instanceof Error ? error.message : "视频拆解失败";
                progress.fail(details);
                message.error(`拆解失败：${details}`);
            } finally {
                controllersRef.current.delete(controller);
                runningRef.current = false;
                setRunningNodeId(null);
            }
        },
        [analyze, canvasId, config, connectionsRef, focusNode, message, nodesRef, setConnections, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, startUploadStatus],
    );

    return { runTeardown, runningNodeId };
}

/**
 * 放在视频右侧：关键帧格子（按镜头顺序连到分镜表的关键帧列，每行显示自己的关键帧）→ 拆解分镜表 → 拆解报告。
 * 整组再挪到最近的空位，不压住画布上已有的节点（比如上一次拆解的结果）。
 * 关键帧节点带 videoFrameSourceNodeId / videoFrameTimeMs，从分镜表生成视频脚本时直接复用，不再从浏览器抽帧。
 */
function buildTeardownCanvasNodes(anchor: CanvasNodeData, bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, model: string, existing: CanvasNodeData[]) {
    const frames = buildVideoFrameNodes(
        anchor,
        bundle.shots.map((shot) => ({
            timeMs: shot.keyframeTimeMs,
            image: { url: resourceFileUrl(shot.keyframeResourceId), storageKey: resourceStorageKey(shot.keyframeResourceId), width: shot.keyframeWidth, height: shot.keyframeHeight, bytes: 0, mimeType: "image/jpeg" },
        })),
    ).map((frame, index) => {
        const shot = bundle.shots[index];
        const scale = Math.min(KEYFRAME_BOX / shot.keyframeWidth, KEYFRAME_BOX / shot.keyframeHeight, 1);
        // 标成手动尺寸：图片解码和打开画布时的按原图适配会把小图撑回原始尺寸，网格就互相压住了。
        return { ...frame, title: `镜头 ${index + 1} · ${frame.title}`, width: Math.round(shot.keyframeWidth * scale), height: Math.round(shot.keyframeHeight * scale), metadata: { ...frame.metadata, manualSize: true } };
    });
    const columns = Math.min(KEYFRAME_MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(frames.length * 2))));
    const cellWidth = Math.max(...frames.map((frame) => frame.width));
    const cellHeight = Math.max(...frames.map((frame) => frame.height));
    const startX = anchor.position.x + anchor.width + NODE_GAP;
    frames.forEach((frame, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        frame.position = { x: startX + column * (cellWidth + KEYFRAME_GAP.x) + (cellWidth - frame.width) / 2, y: anchor.position.y + row * (cellHeight + KEYFRAME_GAP.y) + (cellHeight - frame.height) / 2 };
    });
    const framesRight = Math.max(anchor.position.x + anchor.width, ...frames.map((frame) => frame.position.x + frame.width));
    const storyboardRows = videoTeardownStoryboardRows(bundle, analysis.rows);
    const title = analysis.title || anchor.title || "视频拆解";
    const tableId = `batch-table-${nanoid()}`;
    const table: CanvasNodeData = {
        id: tableId,
        type: CanvasNodeType.BatchTable,
        title: `拆解分镜表 · ${title}`,
        position: { x: framesRight + NODE_GAP, y: anchor.position.y },
        width: TABLE_SIZE.width,
        height: TABLE_SIZE.height,
        metadata: { batchTable: videoTeardownBatchTable(storyboardRows, { title, sourceNodeId: anchor.id, keyframeNodeIds: frames.map((frame) => frame.id) }), model, status: "idle" },
    };
    const report: CanvasNodeData = {
        id: `markdown-${nanoid()}`,
        type: CanvasNodeType.Markdown,
        title: `拆解报告 · ${title}`,
        position: { x: table.position.x + table.width + NODE_GAP, y: anchor.position.y },
        width: REPORT_SIZE.width,
        height: REPORT_SIZE.height,
        metadata: { content: videoTeardownReportMarkdown(bundle, analysis, storyboardRows), status: "success" },
    };
    const group = [...frames, table, report];
    const left = Math.min(...group.map((node) => node.position.x));
    const top = Math.min(...group.map((node) => node.position.y));
    const groupSize = { width: Math.max(...group.map((node) => node.position.x + node.width)) - left, height: Math.max(...group.map((node) => node.position.y + node.height)) - top };
    const origin = findAvailableGenerationGroupPosition(existing, { x: left, y: top }, groupSize);
    for (const node of group) node.position = { x: node.position.x + origin.x - left, y: node.position.y + origin.y - top };
    const connections: CanvasConnection[] = [
        ...frames.map((frame) => ({ id: nanoid(), fromNodeId: anchor.id, toNodeId: frame.id })),
        ...frames.map((frame) => ({ id: `conn-${nanoid()}`, fromNodeId: frame.id, fromHandleId: "output", toNodeId: tableId, toHandleId: "batch-reference:ai-ref", relation: "batch-input" as const })),
        { id: nanoid(), fromNodeId: anchor.id, toNodeId: report.id },
    ];
    return { nodes: group, connections, tableId };
}
