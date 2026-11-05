import { useCallback, useEffect, useState } from "react";

import type { VideoTeardownShot } from "@/services/api/video-replication";

/** 播放到 ms 时所在的镜头；早于第一镜算第一镜，晚于最后一镜算最后一镜。 */
export function shotAt(shots: VideoTeardownShot[], ms: number) {
    return shots.find((shot) => ms >= shot.startMs && ms < shot.endMs) || (shots.length && ms >= shots[shots.length - 1].endMs ? shots[shots.length - 1] : shots[0]);
}

/**
 * 原视频和时间线、分镜列表的联动：当前播到第几镜、是否在播放，以及跳到某一镜。
 * videoRef 是回调 ref，播放器挂载或换源后都能重新绑定事件。
 */
export function useReplicationPlayback(shots: VideoTeardownShot[]) {
    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        if (!video) return;
        const sync = () => setActiveIndex(shotAt(shots, video.currentTime * 1000)?.index || 0);
        const play = () => setPlaying(true);
        const pause = () => setPlaying(false);
        sync();
        video.addEventListener("timeupdate", sync);
        video.addEventListener("seeked", sync);
        video.addEventListener("play", play);
        video.addEventListener("pause", pause);
        video.addEventListener("ended", pause);
        return () => {
            video.removeEventListener("timeupdate", sync);
            video.removeEventListener("seeked", sync);
            video.removeEventListener("play", play);
            video.removeEventListener("pause", pause);
            video.removeEventListener("ended", pause);
        };
    }, [video, shots]);

    // 跳到镜头开头时往后让一帧，避免停在上一镜的最后一帧上。
    const playShot = useCallback(
        (shot: VideoTeardownShot, play = true) => {
            setActiveIndex(shot.index);
            if (!video) return;
            video.currentTime = (shot.startMs + Math.min(40, (shot.endMs - shot.startMs) / 2)) / 1000;
            if (play) void video.play().catch(() => undefined);
        },
        [video],
    );

    return { videoRef: setVideo, video, activeIndex, playing, playShot };
}
