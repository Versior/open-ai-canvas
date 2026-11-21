import { useEffect } from "react";

import { generationNoticeKind } from "@/lib/generation-notice";
import { ApiError } from "@/services/api/request";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { forgetGenerationTask, staleActiveGenerationTaskIds, subscribeGenerationTaskSuccess } from "@/services/generation-completion-tracker";
import { installNotificationAudioUnlock, playGenerationSuccessSound } from "@/services/notification-sound";
import { remindHiddenTab } from "@/services/tab-attention";
import { useNotificationPreferencesStore } from "@/stores/use-notification-preferences-store";
import { useUserStore } from "@/stores/use-user-store";

/** 同一批（工作台多张、画布多图）在这个窗口内合并成一声提示音与一次标签更新。 */
const FLUSH_DELAY_MS = 600;
/** 页面自己的轮询停止后（例如离开画布），继续低频查询仍在运行的任务。 */
const WATCH_INTERVAL_MS = 10_000;
const WATCH_STALE_MS = 12_000;
const WATCH_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const WATCH_LIMIT = 8;

/**
 * 生成完成只播放提示音，并在后台标签页计数；页面内由原位置的结果与开包反馈完成，不再弹通知。
 */
export function GenerationSuccessNotifier() {
    const userId = useUserStore((state) => state.user?.id || "");
    const soundEnabled = useNotificationPreferencesStore((state) => state.generationNotice && state.generationSound);

    useEffect(() => {
        if (userId && soundEnabled) return installNotificationAudioUnlock();
    }, [userId, soundEnabled]);

    useEffect(() => {
        if (!userId) return;
        let buffer: GenerationTask[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | undefined;

        const flush = () => {
            flushTimer = undefined;
            const tasks = buffer;
            buffer = [];
            const preferences = useNotificationPreferencesStore.getState();
            if (!tasks.length || !preferences.generationNotice) return;
            if (preferences.generationSound) playGenerationSuccessSound();
            remindHiddenTab(tasks.length);
        };

        const unsubscribe = subscribeGenerationTaskSuccess((task) => {
            if (!generationNoticeKind(task)) return;
            buffer.push(task);
            flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
        });

        const watch = window.setInterval(() => {
            if (!useNotificationPreferencesStore.getState().generationNotice) return;
            for (const id of staleActiveGenerationTaskIds(WATCH_STALE_MS, WATCH_MAX_AGE_MS, WATCH_LIMIT)) {
                // 查询结果经 task-center 汇入完成跟踪；任务已删除时停止跟踪，其余失败下一轮再试。
                void queryGenerationTask(id).catch((error) => {
                    if (error instanceof ApiError && (error.status === 404 || error.reason === "not_found")) forgetGenerationTask(id);
                });
            }
        }, WATCH_INTERVAL_MS);

        return () => {
            unsubscribe();
            if (flushTimer) clearTimeout(flushTimer);
            window.clearInterval(watch);
        };
    }, [userId]);

    return null;
}
