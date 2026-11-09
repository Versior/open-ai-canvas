import { expect, test } from "bun:test";
import { getClipSeekTime, getTimelineClipTitle, getFilmstripTiles, getPreviewClipAtTime, getPreviewAudioClips, timelinePreviewVolume } from "../src/lib/timeline/timeline-clip-view";
import type { TimelineClip } from "../src/types/timeline";

const clip: TimelineClip = { id: "clip-1", nodeId: "asset:internal-id", kind: "video", trackId: "video-1", startMs: 5000, durationMs: 2000, sourceStartMs: 1000, title: "第二个镜头" };

test("预览混音只播放当前可见未静音音轨，音量遵循淡入淡出", () => {
    const audio = { ...clip, kind: "audio" as const, trackId: "audio", volume: 0.5, fadeInMs: 500, fadeOutMs: 500 };
    const project = { version: 2 as const, tracks: [{ id: "audio", kind: "audio" as const, label: "音乐", order: 0 }], clips: [audio], durationMs: 7000 };
    expect(getPreviewAudioClips(project, 5100)).toHaveLength(1);
    expect(getPreviewAudioClips(project, 7000)).toHaveLength(0);
    expect(getPreviewAudioClips({ ...project, tracks: [{ ...project.tracks[0], muted: true }] }, 5100)).toHaveLength(0);
    expect(getPreviewAudioClips({ ...project, tracks: [{ ...project.tracks[0], visible: false }] }, 5100)).toHaveLength(0);
    expect(timelinePreviewVolume(audio, 5100)).toBeCloseTo(0.1);
    expect(timelinePreviewVolume(audio, 6000)).toBeCloseTo(0.5);
    expect(timelinePreviewVolume(audio, 6900)).toBeCloseTo(0.1);
});

test("多轨重叠时优先预览被点击的可见片段，离开片段后继续下一镜", () => {
    const first = { ...clip, id: "first", startMs: 0, durationMs: 10000 };
    const second = { ...clip, id: "second", trackId: "video-2", startMs: 0, durationMs: 3000 };
    const project = {
        version: 2 as const,
        durationMs: 10000,
        tracks: [
            { id: "video-1", kind: "video" as const, label: "一", order: 0 },
            { id: "video-2", kind: "video" as const, label: "二", order: 1 },
        ],
        clips: [first, second],
    };
    expect(getPreviewClipAtTime(project, 1000, "second")?.id).toBe("second");
    expect(getPreviewClipAtTime(project, 4000, "second")?.id).toBe("first");
    expect(getPreviewClipAtTime({ ...project, tracks: project.tracks.map((track) => ({ ...track, visible: track.id !== "video-2" })) }, 1000, "second")?.id).toBe("first");
});

test("片段显示素材名称，不展示内部素材 ID", () => {
    expect(getTimelineClipTitle(clip)).toBe("第二个镜头");
    expect(getTimelineClipTitle({ ...clip, title: undefined, directMedia: { id: "asset-1", kind: "video", title: "原片.mp4" } })).toBe("原片.mp4");
    expect(getTimelineClipTitle({ ...clip, title: undefined })).toBe("视频片段");
});

test("单击定位使用时间线坐标，右边缘不能跳到下一个镜头", () => {
    expect(getClipSeekTime(clip, 96, 0.096)).toBe(6000);
    expect(getClipSeekTime(clip, -10, 0.096)).toBe(5000);
    expect(getClipSeekTime(clip, 1000, 0.096)).toBe(6999);
});

test("胶片条从裁剪源起点采样，放大后取帧更密", () => {
    const normal = getFilmstripTiles({ durationMs: 2000, sourceStartMs: 1000, pxPerMs: 0.096, visibleStartPx: 0, visibleEndPx: 1000 });
    expect(normal.map((tile) => tile.timeMs)).toEqual([1000, 1667, 2333]);
    const zoomed = getFilmstripTiles({ durationMs: 2000, sourceStartMs: 1000, pxPerMs: 0.192, visibleStartPx: 0, visibleEndPx: 1000 });
    expect(zoomed.length).toBe(6);
    expect(zoomed[1].timeMs).toBe(1333);
});

test("长片高倍缩放只为可见区域生成有限数量缩略图", () => {
    const tiles = getFilmstripTiles({ durationMs: 3600000, sourceStartMs: 0, pxPerMs: 6.144, visibleStartPx: 100000, visibleEndPx: 101024 });
    expect(tiles.length).toBeLessThanOrEqual(19);
    expect(tiles[0].left).toBeGreaterThanOrEqual(99904);
    expect(tiles.at(-1)!.left).toBeLessThanOrEqual(101088);
});

test("片段完全离开可见区时不提取帧", () => {
    expect(getFilmstripTiles({ durationMs: 2000, sourceStartMs: 0, pxPerMs: 0.096, visibleStartPx: 1000, visibleEndPx: 2000 })).toEqual([]);
});
