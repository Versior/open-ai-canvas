import { nanoid } from "nanoid";

import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { buildVideoFrameNodes } from "@/lib/canvas/canvas-video-frame-nodes";
import { videoTeardownBatchTable, videoTeardownReportMarkdown, videoTeardownStoryboardRows, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getResource, resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

const REPORT_SIZE = { width: 520, height: 680 };
const TABLE_SIZE = { width: 1280, height: 560 };
const NODE_GAP = 120;
// 关键帧缩成小图排成网格：几十个镜头也不会铺满画布；节点标题在图上方，行距留出标题高度。
const KEYFRAME_BOX = 240;
const KEYFRAME_GAP = { x: 24, y: 64 };
const KEYFRAME_MAX_COLUMNS = 6;

/**
 * 视频右侧依次放关键帧格子（按镜头顺序连到分镜表的关键帧列）、拆解分镜表和拆解报告，整组再挪到最近的空位。
 * 关键帧节点带 videoFrameSourceNodeId / videoFrameTimeMs，从分镜表「创建视频脚本」时直接复用，不再从浏览器抽帧。
 */
export function buildVideoTeardownCanvas(anchor: CanvasNodeData, bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, model: string, existing: CanvasNodeData[]) {
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

/**
 * 新建一张画布放入原视频、关键帧、拆解分镜表和拆解报告，用来接着「创建视频脚本」和生成视频。
 * 返回画布 ID；云端同步失败时画布已在本机创建，syncError 交给调用方提示。
 */
export async function openVideoTeardownInCanvas(bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, model: string) {
    const resource = await getResource(bundle.source.resourceId);
    const size = fitNodeSize(bundle.source.width, bundle.source.height, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
    const title = analysis.title || "视频拆解";
    const video: CanvasNodeData = {
        id: `video-${nanoid()}`,
        type: CanvasNodeType.Video,
        title,
        position: { x: -size.width / 2, y: -size.height / 2 },
        width: size.width,
        height: size.height,
        metadata: videoMetadata({
            url: resourceFileUrl(resource.id),
            storageKey: resourceStorageKey(resource.id),
            width: bundle.source.width,
            height: bundle.source.height,
            durationMs: bundle.source.durationMs,
            bytes: resource.size,
            mimeType: resource.mimeType,
        }),
    };
    const placed = buildVideoTeardownCanvas(video, bundle, analysis, model, [video]);
    const created = await createCanvasProjectWithRemoteSync(`拆解 · ${title}`, undefined, { nodes: [video, ...placed.nodes], connections: placed.connections });
    return created;
}
