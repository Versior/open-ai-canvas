import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { useLocaleStore } from "@/stores/use-locale-store";
import { DEFAULT_LOCALE, type AppLocale } from "./locales";
import zhCN from "./catalogs/zh-CN";

const loaders = {
    "en-US": () => import("./catalogs/en-US"),
    "fr-FR": () => import("./catalogs/fr-FR"),
    "de-DE": () => import("./catalogs/de-DE"),
    "ja-JP": () => import("./catalogs/ja-JP"),
    "ko-KR": () => import("./catalogs/ko-KR"),
};
const loading = new Map<AppLocale, Promise<void>>();

/**
 * 应用唯一的 i18next 实例。语言来自 useLocaleStore（本设备偏好，首次按浏览器语言），
 * 中文回退同步可用；其他语言只在首选或切换到该语言时加载。
 */
export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
    resources: { [DEFAULT_LOCALE]: { translation: zhCN } },
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    initAsync: false,
    returnNull: false,
    interpolation: { escapeValue: false },
});

export function loadLocale(locale: AppLocale): Promise<void> {
    if (locale === DEFAULT_LOCALE) return Promise.resolve();
    const pending = loading.get(locale);
    if (pending) return pending;
    const request = loaders[locale]()
        .then(({ default: catalog }) => {
            i18n.addResourceBundle(locale, "translation", catalog);
        })
        .catch((error: unknown) => {
            loading.delete(locale);
            throw error;
        });
    loading.set(locale, request);
    return request;
}

export async function syncLocale() {
    const locale = currentLocale();
    await loadLocale(locale);
    if (currentLocale() === locale) await i18n.changeLanguage(locale);
}

export const i18nReady = syncLocale().catch(() => {
    console.warn("界面语言加载失败，已回退到简体中文。");
    return i18n.changeLanguage(DEFAULT_LOCALE);
});
useLocaleStore.subscribe((state, previous) => {
    if (state.locale !== previous.locale) void syncLocale().catch(() => console.warn("界面语言加载失败，保留当前文案，请刷新重试。"));
});

/** 当前界面语言；用于 Intl 日期与数字格式化。 */
export function currentLocale(): AppLocale {
    return useLocaleStore.getState().locale;
}

/** 非组件代码（服务层、工具函数）使用的翻译函数。 */
export function translate(key: string, options?: Record<string, unknown>): string {
    return i18n.t(key, options) as string;
}

/**
 * 用户切换界面语言：保存偏好后整页刷新。部分文案在模块加载或缓存数据里生成，
 * 只靠组件重渲染会出现新旧语言混排；刷新保证整页使用同一种语言。
 */
export function switchLocale(next: AppLocale) {
    if (next === currentLocale()) return;
    useLocaleStore.getState().setLocale(next);
    if (typeof window !== "undefined") window.location.reload();
}
