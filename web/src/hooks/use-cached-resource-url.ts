import { useLayoutEffect, useState } from "react";

import { getActiveUserScope } from "@/lib/user-scope";
import { acquireCachedResourceObjectUrl } from "@/services/resource-blob-cache";

const EMPTY_CACHE = { identity: "", url: "" };

/** 图片进入视口后持有预览地址直到资源切换/卸载；解码与保留旧画面的组件共享这段生命周期。 */
export function useCachedResourceUrl(storageKey: string | undefined, enabled = true) {
    const identity = `${getActiveUserScope()}:${storageKey || ""}`;
    const [cached, setCached] = useState(EMPTY_CACHE);
    const retain = enabled || (cached.identity === identity && Boolean(cached.url));
    useLayoutEffect(() => {
        const lease = retain && storageKey ? acquireCachedResourceObjectUrl(storageKey) : null;
        setCached(lease ? { identity, url: lease.url } : EMPTY_CACHE);
        return () => lease?.release();
    }, [identity, retain, storageKey]);
    return cached.identity === identity ? cached.url : "";
}
