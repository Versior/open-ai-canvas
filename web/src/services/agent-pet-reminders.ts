import type { AgentPetReminderContext } from "@/lib/canvas/agent-pet-lines";
import { listDramas } from "@/services/api/drama";
import { listGenerationTasks } from "@/services/api/task-center";
import { listRemoteCanvasProjectsPage } from "@/services/api/user-data";

/** 头顶气泡的“未完成提醒”数据，同一用户 10 分钟内只读一次；任一来源失败只是少一类提醒。 */
const CACHE_MS = 10 * 60_000;
let cached: { userId: string; at: number; value: AgentPetReminderContext } | null = null;
let pending: { userId: string; promise: Promise<AgentPetReminderContext> } | null = null;

export function loadAgentPetReminderContext(userId: string, options: { shortDramaEnabled: boolean }): Promise<AgentPetReminderContext> {
    if (cached && cached.userId === userId && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
    if (pending?.userId === userId) return pending.promise;
    const promise = (async () => {
        const [tasks, dramas, canvases] = await Promise.allSettled([
            listGenerationTasks(20, { activeOnly: true }),
            options.shortDramaEnabled ? listDramas({ page: 1, pageSize: 1 }) : Promise.reject(new Error("短剧功能未开放")),
            listRemoteCanvasProjectsPage({ page: 1, pageSize: 1 }),
        ]);
        const value: AgentPetReminderContext = {};
        if (tasks.status === "fulfilled") value.activeTasks = tasks.value.length;
        if (dramas.status === "fulfilled") {
            const counts = dramas.value.statusCounts;
            value.unfinishedDramas = (counts.draft ?? 0) + (counts.running ?? 0) + (counts.paused ?? 0);
            const latest = dramas.value.items.find((item) => item.status !== "completed");
            if (latest?.project.name) value.dramaTitle = latest.project.name;
        }
        if (canvases.status === "fulfilled" && canvases.value.projects[0]?.title) value.recentCanvas = canvases.value.projects[0].title;
        cached = { userId, at: Date.now(), value };
        return value;
    })();
    pending = { userId, promise };
    void promise
        .finally(() => {
            if (pending?.promise === promise) pending = null;
        })
        .catch(() => undefined);
    return promise;
}
