import { http } from "./request";
import type { CreativeTopic } from "@/lib/remake/creative";

export type VideoTrendBoard = {
    source: CreativeTopic["source"];
    status: "live" | "api" | "web_api" | "synced" | "stale" | "unavailable";
    fetchedAt?: string;
    pageUrl?: string;
    description?: string;
    topics: Array<{ title: string; url: string; rank: number }>;
};
export const getVideoTrends = (source: CreativeTopic["source"], signal?: AbortSignal) => http.get<VideoTrendBoard>("/video-creation/trends", { params: { source }, signal });
