import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { packagingApi } from "@/services/api/packaging";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";
import { newPackagingDocument, validatePackagingParameters, type PackagingCatalog, type PackagingDocument, type PackagingProject, type PackagingProjectSummary, type PackagingTemplate } from "@/lib/packaging/types";
import { readPackagingProjectZip } from "@/lib/packaging/delivery";
import { compilePackaging } from "@/lib/packaging/geometry";
import { useUserStore } from "@/stores/use-user-store";

export function usePackagingProject() {
    const userId = useUserStore((s) => s.user?.id);
    const [catalog, setCatalog] = useState<PackagingCatalog>();
    const [project, setProject] = useState<PackagingProject>();
    const [projects, setProjects] = useState<PackagingProjectSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [error, setError] = useState("");
    const [status, setStatus] = useState<"loading" | "ready" | "saving" | "uploading">("loading");
    const [dirty, setDirty] = useState(false);
    const sequence = useRef(0);
    const projectEpoch = useRef(0);
    const pageRequest = useRef(0);
    const currentProject = useRef(project);
    currentProject.current = project;
    const resources = useRef(new Map<string, Blob>());
    const images = useRef(new Map<string, HTMLImageElement>());
    const [imageRevision, setImageRevision] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setStatus("loading");
        projectEpoch.current++;
        setCatalog(undefined);
        setProject(undefined);
        setProjects([]);
        resources.current.clear();
        images.current.clear();
        const session = captureUserSession();
        Promise.all([packagingApi.catalog(controller.signal), packagingApi.projects(1, false, {}, controller.signal)])
            .then(([c, list]) => {
                assertCurrentUserSession(session);
                setCatalog(c);
                setProjects(list.items);
                setTotal(list.total);
                setPage(1);
                if (c.templates[0] && c.materials[0])
                    setProject({ id: "", userId: session.scope, name: "未命名包装", templateId: c.templates[0].id, revision: 0, createdAt: "", updatedAt: "", document: newPackagingDocument(c.templates[0], c.materials[0]) });
                setStatus("ready");
                setDirty(false);
                setError("");
            })
            .catch((e: unknown) => {
                if (!controller.signal.aborted) {
                    setStatus("ready");
                    setError(e instanceof Error ? e.message : "目录读取失败");
                }
            });
        return () => controller.abort();
    }, [userId]);
    useEffect(() => {
        const controller = new AbortController();
        const session = captureUserSession();
        const ids = [...new Set(project?.document.artworks.map((a) => a.resourceId) ?? [])];
        Promise.all(
            ids.map(async (id) => {
                if (images.current.has(id)) return;
                const response = await fetch(resourceFileUrl(id), { credentials: "include", signal: controller.signal });
                if (!response.ok) throw new Error(`图稿读取失败（${response.status}）`);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    image.src = url;
                    await image.decode();
                    assertCurrentUserSession(session);
                    resources.current.set(id, blob);
                    images.current.set(id, image);
                } finally {
                    URL.revokeObjectURL(url);
                }
            }),
        )
            .then(() => {
                if (!controller.signal.aborted) setImageRevision((v) => v + 1);
            })
            .catch((e: unknown) => {
                if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "图稿读取失败");
            });
        return () => controller.abort();
    }, [project?.id, project?.document.artworks.map((a) => a.resourceId).join("|")]);
    const edit = (update: (p: PackagingProject) => PackagingProject) => {
        sequence.current++;
        setProject((p) => (p ? update(p) : p));
        setDirty(true);
    };
    const updateDocument = (update: (d: PackagingDocument) => PackagingDocument) => edit((p) => ({ ...p, document: update(p.document) }));
    const newProject = (template?: PackagingTemplate) => {
        const session = captureUserSession();
        sequence.current++;
        projectEpoch.current++;
        if (!template || !catalog!.materials[0]) {
            setProject(undefined);
            setDirty(false);
            return;
        }
        setProject({ id: "", userId: session.scope, name: template.name, templateId: template.id, revision: 0, createdAt: "", updatedAt: "", document: newPackagingDocument(template, catalog!.materials[0]) });
        setDirty(false);
        setError("");
    };
    const loadPage = async (next: number) => {
        const request = ++pageRequest.current;
        const session = captureUserSession();
        const list = await packagingApi.projects(next, false, {}, session.signal);
        assertCurrentUserSession(session);
        if (request !== pageRequest.current) return;
        setProjects(list.items);
        setTotal(list.total);
        setPage(next);
    };
    const load = async (id: string) => {
        const epoch = ++projectEpoch.current;
        const submitted = sequence.current;
        const session = captureUserSession();
        const value = await packagingApi.project(id, session.signal);
        assertCurrentUserSession(session);
        if (epoch !== projectEpoch.current) return;
        if (submitted !== sequence.current) throw new Error("读取期间有新的编辑，已保留当前修改；请重新打开项目");
        setProject(value);
        setDirty(false);
        setError("");
        sequence.current++;
    };
    const save = async (copy = false) => {
        if (!project || status !== "ready") return;
        const session = captureUserSession();
        validatePackagingParameters(project.document.parameters);
        setStatus("saving");
        setError("");
        const submitted = sequence.current;
        const epoch = projectEpoch.current;
        try {
            const value = await packagingApi.save(copy ? "" : project.id, copy ? `${project.name} 副本` : project.name, project.document, copy ? 0 : project.revision, session.signal);
            assertCurrentUserSession(session);
            if (epoch !== projectEpoch.current) return;
            setProject((current) => (submitted === sequence.current ? value : current ? { ...current, id: value.id, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt } : value));
            setDirty(submitted !== sequence.current);
            await loadPage(1);
        } catch (e) {
            if (!session.signal.aborted && epoch === projectEpoch.current) setError(e instanceof Error ? e.message : "保存失败");
        } finally {
            if (!session.signal.aborted) setStatus("ready");
        }
    };
    const upload = async (file: File, panelId = "", role: PackagingDocument["artworks"][number]["role"] = "artwork") => {
        if (!project) return;
        const session = captureUserSession();
        const base = project;
        const epoch = projectEpoch.current;
        if (file.size > 25 * 1024 * 1024) throw new Error("图稿不能超过 25 MB");
        const blobUrl = URL.createObjectURL(file);
        setStatus("uploading");
        try {
            const image = new Image();
            image.src = blobUrl;
            await image.decode();
            if (file.size > 25 * 1024 * 1024 || image.width * image.height > 40_000_000) throw new Error("图稿最多 25 MB / 4000 万像素");
            const uploadFile =
                file.type !== "image/svg+xml"
                    ? file
                    : await new Promise<File>((resolve, reject) => {
                          const canvas = document.createElement("canvas");
                          canvas.width = image.width;
                          canvas.height = image.height;
                          canvas.getContext("2d")!.drawImage(image, 0, 0);
                          canvas.toBlob((blob) => (blob ? resolve(new File([blob], file.name.replace(/\.svg$/i, "") + ".png", { type: "image/png" })) : reject(new Error("SVG 转换失败"))), "image/png");
                      });
            const resource = await uploadResourceFile(uploadFile, "image", { fileName: uploadFile.name, expectedUserId: session.scope, signal: session.signal });
            assertCurrentUserSession(session);
            if (epoch !== projectEpoch.current || currentProject.current?.document.parameters !== base.document.parameters) throw new Error("项目或尺寸已切换，请重新添加图稿；已上传文件保留在素材库");
            const layout = compilePackaging(base.document);
            const panel = layout.panels.find((p) => p.id === panelId);
            const x = panel ? Math.min(...panel.points.map((p) => p[0])) : layout.bounds.x;
            const y = panel ? Math.min(...panel.points.map((p) => p[1])) : layout.bounds.y;
            const width = panel ? Math.max(...panel.points.map((p) => p[0])) - x : layout.bounds.width;
            resources.current.set(resource.id, uploadFile);
            images.current.set(resource.id, image);
            setImageRevision((v) => v + 1);
            updateDocument((d) => ({ ...d, artworks: [...d.artworks, { id: nanoid(), resourceId: resource.id, name: file.name, panelId, role, x, y, width, height: (width * image.height) / image.width, rotation: 0, opacity: 1 }] }));
        } finally {
            URL.revokeObjectURL(blobUrl);
            if (!session.signal.aborted) setStatus("ready");
        }
    };
    const importProject = async (file: File) => {
        if (file.size > 100 * 1024 * 1024) throw new Error("方案包不能超过 100 MB");
        const epoch = ++projectEpoch.current;
        const submitted = sequence.current;
        const session = captureUserSession();
        const imported = readPackagingProjectZip(new Uint8Array(await file.arrayBuffer()));
        assertCurrentUserSession(session);
        const template = catalog!.templates.find((t) => t.id === imported.document.template.id && t.structure === imported.document.template.structure);
        const material = catalog!.materials.find((m) => m.id === imported.document.material.id);
        if (!template || !material) throw new Error("方案盒型或材料不在当前启用目录中");
        setStatus("uploading");
        try {
            const ids = new Map<string, string>();
            for (const [id, blob] of imported.resources) {
                const url = URL.createObjectURL(blob);
                try {
                    const image = new Image();
                    image.src = url;
                    await image.decode();
                    if (image.width * image.height > 40_000_000) throw new Error("图稿不能超过 4000 万像素");
                } finally {
                    URL.revokeObjectURL(url);
                }
                const resource = await uploadResourceFile(blob, "image", {
                    fileName: `${id}.${blob.type === "image/jpeg" ? "jpg" : blob.type === "image/svg+xml" ? "svg" : blob.type === "image/webp" ? "webp" : "png"}`,
                    expectedUserId: session.scope,
                    signal: session.signal,
                });
                assertCurrentUserSession(session);
                ids.set(id, resource.id);
            }
            if (epoch !== projectEpoch.current) return;
            if (submitted !== sequence.current) throw new Error("导入期间有新的编辑，已保留当前修改；请重新导入。已上传图稿保留在素材库");
            setProject({
                id: "",
                userId: session.scope,
                name: imported.name,
                templateId: template.id,
                revision: 0,
                createdAt: "",
                updatedAt: "",
                document: { ...imported.document, artworks: imported.document.artworks.map((a) => ({ ...a, resourceId: ids.get(a.resourceId)! })) },
            });
            setDirty(true);
            sequence.current++;
        } finally {
            if (!session.signal.aborted) setStatus("ready");
        }
    };
    return {
        catalog,
        project,
        projects,
        total,
        page,
        error,
        setError,
        status,
        dirty,
        images: images.current,
        resources: resources.current,
        imageRevision,
        edit,
        updateDocument,
        newProject,
        loadPage,
        load,
        save,
        upload,
        importProject,
        remove: async () => {
            if (!project?.id) return;
            const session = captureUserSession();
            const epoch = projectEpoch.current;
            await packagingApi.remove(project.id, project.revision, session.signal);
            assertCurrentUserSession(session);
            if (epoch !== projectEpoch.current) return;
            newProject(catalog!.templates[0]);
            await loadPage(1);
        },
    };
}
