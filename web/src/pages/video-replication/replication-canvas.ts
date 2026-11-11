import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { cinematicStoryboardColumns, createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { storyboardComposerContent } from "@/lib/canvas/canvas-storyboard-materializer";
import { buildVideoFrameNodes } from "@/lib/canvas/canvas-video-frame-nodes";
import { replicaProductNote, type VideoReplicaPlan } from "@/lib/canvas/video-replica-plan";
import { compileReplicaDirection } from "@/lib/canvas/replica-director";
import { videoReplicaProductFramePrompt, videoReplicaProductVideoPrompt, videoTeardownReportMarkdown, videoTeardownStoryboardRows, type VideoReplicaMode, type VideoTeardownAnalysis } from "@/lib/canvas/video-teardown";
import { getResource, resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import type { UploadedImage } from "@/services/image-storage";
import type { VideoTeardownBundle } from "@/services/api/video-replication";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";

export type VideoReplicaOptions = { plan: VideoReplicaPlan };

/** 方案里的商品图（已在服务端的图片资源）转成画布图片节点要的格式。 */
function productUploads(plan: VideoReplicaPlan): UploadedImage[] {
    return plan.product.images.map((image) => ({ url: resourceFileUrl(image.resourceId), storageKey: resourceStorageKey(image.resourceId), width: image.width || 1024, height: image.height || 1024, bytes: image.bytes, mimeType: image.mimeType }));
}

/** 换商品但没有商品图：只能把商品写进提示词。 */
function textOnlyProductPrompt(prompt: string, note: string) {
    return [note ? `画面里的商品是：${note}，不要画成原片里的商品。` : "", prompt].filter(Boolean).join("\n");
}

const REPORT_SIZE = { width: 520, height: 680 };
const NODE_GAP = 120;
// 关键帧缩成小图排成网格：几十个镜头也不会铺满画布；节点标题在图上方，行距留出标题高度。
const KEYFRAME_BOX = 240;
const KEYFRAME_GAP = { x: 24, y: 64 };
const KEYFRAME_MAX_COLUMNS = 6;
const PRODUCT_BOX = 200;
const FIRST_FRAME_GAP = 36;

function boxed(width: number, height: number, box: number) {
    const scale = Math.min(box / Math.max(width, 1), box / Math.max(height, 1), 1);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * 去画布复刻：视频右侧放关键帧格子和分镜脚本（「先做首帧」模式，生成首帧 → 生成视频 → 合并成片），
 * 关键帧格子下面放拆解报告。商品图放在分镜脚本上方。分镜按复刻方案逐镜处理：
 *
 * - remake：首帧按提示词重新生成，不用原片画面和人物。
 * - original：原片关键帧直接当首帧（方案里已确认授权）。
 * - product：有商品图时预先建好首帧节点，参考图（已授权时是原画面 + 商品图，否则只有商品图）用普通连线接到首帧节点，
 *   只参与这张首帧的生成；视频那一步只带首帧，商品图不会再进视频请求。没有商品图时只把商品写进提示词。
 * - skip：不放进分镜。
 * 口播、画面字和提示词用方案里改过的版本。
 */
export function buildVideoTeardownCanvas(anchor: CanvasNodeData, bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, model: string, existing: CanvasNodeData[], options: VideoReplicaOptions) {
    const { plan } = options;
    const facts = plan.product.sellingPoints
        .split(/\n+/)
        .map((fact) => fact.replace(/^[\s\-*·•\d.、]+/, "").trim())
        .filter(Boolean);
    for (const shot of plan.shots) {
        if (shot.treatment === "skip" || shot.treatment === "original" || !shot.director) continue;
        if (!shot.director.action.trim()) throw new Error(`镜头 ${shot.shotNumber} 还没有具体导演动作`);
        if (shot.director.beat === "proof" && !facts.includes(shot.director.evidence.trim())) throw new Error(`镜头 ${shot.shotNumber} 的证明依据须逐字引用一条商品卖点`);
    }
    const uploads = productUploads(plan);
    const note = replicaProductNote(plan.product);
    const swapMode: VideoReplicaMode = plan.authorized ? "reuse" : "remake";
    const frames = buildVideoFrameNodes(
        anchor,
        bundle.shots.map((shot) => ({
            timeMs: shot.keyframeTimeMs,
            image: { url: resourceFileUrl(shot.keyframeResourceId), storageKey: resourceStorageKey(shot.keyframeResourceId), width: shot.keyframeWidth, height: shot.keyframeHeight, bytes: 0, mimeType: "image/jpeg" },
        })),
    ).map((frame, index) => {
        const shot = bundle.shots[index];
        // 标成手动尺寸：图片解码和打开画布时的按原图适配会把小图撑回原始尺寸，网格就互相压住了。
        return { ...frame, title: `镜头 ${index + 1} · ${frame.title}`, ...boxed(shot.keyframeWidth, shot.keyframeHeight, KEYFRAME_BOX), metadata: { ...frame.metadata, manualSize: true } };
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
    const framesBottom = Math.max(anchor.position.y + anchor.height, ...frames.map((frame) => frame.position.y + frame.height));
    const title = analysis.title || anchor.title || "视频拆解";

    const products: CanvasNodeData[] = uploads.map((image, index) => ({
        id: `image-${nanoid()}`,
        type: CanvasNodeType.Image,
        title: `商品图 ${index + 1}`,
        position: { x: 0, y: 0 },
        ...boxed(image.width, image.height, PRODUCT_BOX),
        // prop：分镜资产里按「道具」理解，和人物、场景参考区分开。
        metadata: { ...imageMetadata(image), assetCategory: "prop", manualSize: true },
    }));
    const baseRows = videoTeardownStoryboardRows(bundle, analysis.rows);
    const shotPlans = new Map(plan.shots.map((shot) => [shot.shotNumber, shot]));
    const swapRowIds = new Set<string>();
    // 关键帧下标 = 镜头编号 - 1；跳过的镜头不进分镜，但关键帧照样放在画布上作参考。
    const frameOf = new Map<string, CanvasNodeData>();
    const rows: StoryboardRow[] = baseRows.flatMap((base, index) => {
        const shot = shotPlans.get(base.shotNumber);
        const directed = shot ? compileReplicaDirection(shot, plan.campaign) : undefined;
        if (shot?.treatment === "skip") return [];
        const row: StoryboardRow = shot
            ? {
                  ...base,
                  dialogue: shot.dialogue,
                  imageGenerationPrompt: directed?.imagePrompt || base.imageGenerationPrompt,
                  videoMotionPrompt: directed?.videoPrompt || base.videoMotionPrompt,
                  sourceAnalysis: base.sourceAnalysis ? { ...base.sourceAnalysis, onScreenText: shot.onScreenText } : base.sourceAnalysis,
              }
            : base;
        if (frames[index]) frameOf.set(row.id, frames[index]);
        if (shot?.treatment === "product") {
            if (!products.length) return [{ ...row, imageGenerationPrompt: textOnlyProductPrompt(row.imageGenerationPrompt, note), videoMotionPrompt: videoReplicaProductVideoPrompt(row, note) }];
            swapRowIds.add(row.id);
            return [{ ...row, imageGenerationPrompt: videoReplicaProductFramePrompt(row, swapMode, note), videoMotionPrompt: videoReplicaProductVideoPrompt(row, note) }];
        }
        return [shot?.treatment === "original" && plan.authorized && frames[index] ? { ...row, imageNodeId: frames[index].id } : row];
    });

    const scriptSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Script];
    const scriptHeight = Math.min(720, Math.max(scriptSpec.height, 160 + rows.length * 72));
    const scriptTop = anchor.position.y + (products.length ? PRODUCT_BOX + 80 : 0);
    const script = createCanvasNode(
        CanvasNodeType.Script,
        { x: framesRight + NODE_GAP + scriptSpec.width / 2, y: scriptTop + scriptHeight / 2 },
        {
            storyboard: { rows, visibleColumns: cinematicStoryboardColumns(["plotDescription", "imageGenerationPrompt"]), referenceNodeIds: [] },
            storyboardVideoInputMode: "keyframe",
            workflowKind: "storyboard",
            workflowTitle: `复刻 · ${title}`,
            composerContent: `复刻「${title}」`,
            model,
            status: "idle",
        },
    );
    script.title = `复刻分镜 · ${title}`;
    script.height = scriptHeight;
    script.position = { x: framesRight + NODE_GAP, y: scriptTop };
    products.forEach((node, index) => {
        node.position = { x: script.position.x + index * (PRODUCT_BOX + 24) + (PRODUCT_BOX - node.width) / 2, y: anchor.position.y + (PRODUCT_BOX - node.height) / 2 };
    });

    const connections: CanvasConnection[] = [...frames.map((frame) => ({ id: nanoid(), fromNodeId: anchor.id, toNodeId: frame.id }))];
    const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const firstFrames: CanvasNodeData[] = [];
    rows.forEach((row) => {
        if (!swapRowIds.has(row.id)) return;
        // 参考图顺序决定提示词里的编号：已授权时第一张是原画面。
        const frame = frameOf.get(row.id);
        const referenceIds = [...(swapMode === "reuse" && frame ? [frame.id] : []), ...products.map((node) => node.id)];
        const prompt = row.imageGenerationPrompt;
        const node = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { prompt, workflowKind: "shot", workflowTitle: `镜头 ${row.shotNumber} 首帧`, shotIndex: row.shotNumber, status: "idle" });
        node.title = `镜头 ${row.shotNumber} · 首帧（换商品）`;
        node.position = { x: script.position.x + script.width + NODE_GAP, y: script.position.y + firstFrames.length * (imageSpec.height + FIRST_FRAME_GAP) };
        node.metadata = { ...node.metadata, composerContent: storyboardComposerContent(prompt, referenceIds, [...frames, ...products]) };
        row.imageNodeId = node.id;
        firstFrames.push(node);
        connections.push(...referenceIds.map((fromNodeId) => ({ id: nanoid(), fromNodeId, toNodeId: node.id })), {
            id: nanoid(),
            fromNodeId: script.id,
            toNodeId: node.id,
            fromHandleId: `row:${row.id}`,
            relation: "storyboard-output" as const,
            storyboardRowId: row.id,
        });
    });

    const report: CanvasNodeData = {
        id: `markdown-${nanoid()}`,
        type: CanvasNodeType.Text,
        title: `拆解报告 · ${title}`,
        position: { x: startX, y: framesBottom + NODE_GAP },
        width: REPORT_SIZE.width,
        height: REPORT_SIZE.height,
        metadata: { content: videoTeardownReportMarkdown(bundle, analysis, baseRows), textFormat: "markdown", status: "success" },
    };
    connections.push({ id: nanoid(), fromNodeId: anchor.id, toNodeId: report.id });

    const group = [...frames, ...products, script, ...firstFrames, report];
    const left = Math.min(...group.map((node) => node.position.x));
    const top = Math.min(...group.map((node) => node.position.y));
    const groupSize = { width: Math.max(...group.map((node) => node.position.x + node.width)) - left, height: Math.max(...group.map((node) => node.position.y + node.height)) - top };
    const origin = findAvailableGenerationGroupPosition(existing, { x: left, y: top }, groupSize);
    for (const node of group) node.position = { x: node.position.x + origin.x - left, y: node.position.y + origin.y - top };
    return { nodes: group, connections, scriptId: script.id, swappedShots: rows.filter((row) => swapRowIds.has(row.id)).map((row) => row.shotNumber) };
}

/**
 * 新建一张画布放入原视频、关键帧、分镜脚本、商品图和拆解报告，在画布里接着生成首帧、视频和成片。
 * 返回画布 ID；云端同步失败时画布已在本机创建，syncError 交给调用方提示。
 */
export async function openVideoTeardownInCanvas(bundle: VideoTeardownBundle, analysis: VideoTeardownAnalysis, model: string, options: VideoReplicaOptions) {
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
    const placed = buildVideoTeardownCanvas(video, bundle, analysis, model, [video], options);
    return createCanvasProjectWithRemoteSync(`复刻 · ${title}`, undefined, { nodes: [video, ...placed.nodes], connections: placed.connections });
}
