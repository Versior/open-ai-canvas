import { http } from "./request";
import type { CubeLut, TimelineLut } from "@/lib/timeline/timeline-lut";

export type LUTLibraryItem = {
    id: string;
    name: string;
    category: string;
    description: string;
    preset?: string;
    cubeSize: number;
    defaultStrength: number;
    enabled: boolean;
    sortOrder: number;
    version: number;
    createdAt: string;
    updatedAt: string;
};
export type LUTLibraryWrite = Pick<LUTLibraryItem, "name" | "category" | "description" | "defaultStrength" | "enabled" | "sortOrder"> & { cube?: CubeLut; expectedVersion?: number };
export type LUTLibraryDetail = { item: LUTLibraryItem; lut: TimelineLut };
export const lutLibraryQueryKey = ["lut-library"] as const;

export async function listLUTLibrary(admin = false, signal?: AbortSignal) {
    const data = await http.get<{ items: LUTLibraryItem[] }>(`${admin ? "/admin" : ""}/lut-library/items`, { signal });
    return data.items;
}
export function getLUTLibraryItem(id: string, admin = false, signal?: AbortSignal) {
    return http.get<LUTLibraryDetail>(`${admin ? "/admin" : ""}/lut-library/items/${encodeURIComponent(id)}`, { signal });
}
export async function saveLUTLibraryItem(input: LUTLibraryWrite, id?: string) {
    const path = `/admin/lut-library/items${id ? `/${encodeURIComponent(id)}` : ""}`;
    const data = id ? await http.put<{ item: LUTLibraryItem }>(path, input) : await http.post<{ item: LUTLibraryItem }>(path, input);
    return data.item;
}
export function deleteLUTLibraryItem(item: LUTLibraryItem) {
    return http.delete(`/admin/lut-library/items/${encodeURIComponent(item.id)}`, { params: { version: item.version } });
}
