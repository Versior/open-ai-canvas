import type { LibTVGalleryFetcher } from "@/lib/libtv-gallery";
import { getGuestLibTVGallery, getGuestLibTVWorkDetail, getLibTVGallery, getLibTVWorkDetail } from "@/services/api/libtv-gallery";
import { useUserStore } from "@/stores/use-user-store";

/** 游客读游客接口（服务端短缓存、按来源限流），登录后换回账号接口；身份切换时查询缓存整体清空。 */
export function useLibTVGalleryFetcher(): LibTVGalleryFetcher {
    const guest = useUserStore((state) => !state.user);
    return guest ? getGuestLibTVGallery : getLibTVGallery;
}

export function useLibTVWorkDetailFetcher() {
    const guest = useUserStore((state) => !state.user);
    return guest ? getGuestLibTVWorkDetail : getLibTVWorkDetail;
}
