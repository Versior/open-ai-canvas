import { http } from "./request";
import { normalizeStudioProduct } from "@/lib/ecommerce-studio/product";
import type { StudioProduct } from "@/lib/ecommerce-studio/types";
import type { EcommerceSuiteTemplate } from "./ecommerce-canvas";

export type StudioWorkspace = { revision: number; products: StudioProduct[] };

/** 商品已被其他窗口或助手修改；details.revision 是服务端当前的商品修订号。 */
export const STUDIO_PRODUCT_CONFLICT = "studio_product_conflict";

export async function getStudioWorkspace(): Promise<StudioWorkspace> {
    const data = await http.get<{ revision: number; products: unknown[] }>("/ecommerce/studio");
    const products = (Array.isArray(data.products) ? data.products : []).map(normalizeStudioProduct).filter((product): product is StudioProduct => Boolean(product));
    return { revision: Number(data.revision) || 0, products };
}

export async function getStudioProduct(id: string, signal?: AbortSignal): Promise<StudioProduct> {
    const data = await http.get<{ revision: number; product: unknown }>(`/ecommerce/studio/products/${encodeURIComponent(id)}`, { signal });
    const product = normalizeStudioProduct(data.product);
    if (!product) throw new Error("服务端返回的商品数据无法识别");
    return product;
}

/** 按 expectedRevision 比较交换保存整个商品；返回服务端写入后的版本（带新的 revision）。 */
export async function saveStudioProduct(product: StudioProduct, expectedRevision: number) {
    const data = await http.put<{ revision: number; product: unknown }>(`/ecommerce/studio/products/${encodeURIComponent(product.id)}`, { product, expectedRevision });
    const saved = normalizeStudioProduct(data.product);
    if (!saved) throw new Error("服务端返回的商品数据无法识别");
    return { revision: Number(data.revision) || 0, product: saved };
}

export async function deleteStudioProduct(id: string) {
    const data = await http.delete<{ revision: number }>(`/ecommerce/studio/products/${encodeURIComponent(id)}`);
    return { revision: Number(data.revision) || 0 };
}
/** 后台已启用的套图模板，供「模板套图」选择；停用的草稿不会返回。 */
export async function getStudioSuiteTemplates(signal?: AbortSignal): Promise<EcommerceSuiteTemplate[]> {
    const data = await http.get<{ templates: EcommerceSuiteTemplate[] }>("/ecommerce/studio/templates", { signal, timeout: 15000 });
    return Array.isArray(data.templates) ? data.templates : [];
}
