import { setStudioPromptOverrides } from "@/lib/ecommerce-studio/prompt-overrides";
import { getStudioPrompts } from "@/services/api/ecommerce-studio";

/** 读失败恢复内置规则；已取消的旧账号请求不再写入配置。 */
export async function loadStudioPromptConfig(signal: AbortSignal) {
    setStudioPromptOverrides({});
    try {
        const value = await getStudioPrompts(signal);
        if (!signal.aborted) setStudioPromptOverrides(value);
    } catch (error) {
        if (signal.aborted) return;
        setStudioPromptOverrides({});
        throw error;
    }
}
