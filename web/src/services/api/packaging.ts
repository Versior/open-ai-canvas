import { http, compactApiParams } from "./request";
import type { PackagingCatalog, PackagingDocument, PackagingProject, PackagingProjectSummary } from "@/lib/packaging/types";
import type { GenerationTask } from "./task-center";

export type PackagingMockupTask = GenerationTask & { packagingRevision: number; referenceResourceId: string; scene: string; parentTaskId?: string; outputResourceIds: string[] };

export const packagingApi = {
    catalog: (signal?: AbortSignal, admin = false) => http.get<PackagingCatalog>(`${admin ? "/admin" : ""}/packaging/catalog`, { signal }),
    saveCatalog: (catalog: PackagingCatalog) => http.put<PackagingCatalog>("/admin/packaging/catalog", { catalog, expectedRevision: catalog.revision }),
    projects: (page = 1, admin = false, params: { userId?: string; templateId?: string } = {}, signal?: AbortSignal) =>
        http.get<{ items: PackagingProjectSummary[]; total: number; page: number; pageSize: number }>(`${admin ? "/admin" : ""}/packaging/projects`, { params: compactApiParams({ page, pageSize: 30, ...params }), signal }),
    project: (id: string, signal?: AbortSignal, admin = false) => http.get<PackagingProject>(`${admin ? "/admin" : ""}/packaging/projects/${encodeURIComponent(id)}`, { signal }),
    mockups: (id: string, page = 1, signal?: AbortSignal, admin = false) =>
        http.get<{ items: PackagingMockupTask[]; total: number; page: number; pageSize: number }>(`${admin ? "/admin" : ""}/packaging/projects/${encodeURIComponent(id)}/mockups`, { params: { page, pageSize: 12 }, signal }),
    save: (id: string, name: string, document: PackagingDocument, expectedRevision: number, signal?: AbortSignal) =>
        id ? http.put<PackagingProject>(`/packaging/projects/${encodeURIComponent(id)}`, { name, document, expectedRevision }, { signal }) : http.post<PackagingProject>("/packaging/projects", { name, document, expectedRevision }, { signal }),
    remove: (id: string, expectedRevision: number, signal?: AbortSignal, admin = false) => http.delete<{ deleted: boolean }>(`${admin ? "/admin" : ""}/packaging/projects/${encodeURIComponent(id)}`, { params: { expectedRevision }, signal }),
    overview: () => http.get<{ projects: number; users: number; last7Days: number; byTemplate: { templateId: string; total: number }[] }>("/admin/packaging/overview"),
};
