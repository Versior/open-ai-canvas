import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { http } from "@/services/api/request";

export type CanvasShareStatus = {
    enabled: boolean;
    token?: string;
    expiresAt?: string;
    createdAt?: string;
};

export type PublicCanvasShare = {
    project: CanvasProject;
    expiresAt?: string;
};

export function getCanvasShare(projectId: string, signal?: AbortSignal) {
    return http.get<{ share: CanvasShareStatus }>(`/canvas-projects/${encodeURIComponent(projectId)}/share`, { signal, timeout: 15_000 });
}

export function createCanvasShare(projectId: string, params: { expiresDays: number; rotate?: boolean }, signal?: AbortSignal) {
    return http.post<{ share: CanvasShareStatus }>(`/canvas-projects/${encodeURIComponent(projectId)}/share`, params, { signal, timeout: 15_000 });
}

export function deleteCanvasShare(projectId: string) {
    return http.delete<{ id: string }>(`/canvas-projects/${encodeURIComponent(projectId)}/share`);
}

export function getPublicCanvasShare(token: string) {
    return http.get<PublicCanvasShare>(`/public/canvas-shares/${encodeURIComponent(token)}`);
}
