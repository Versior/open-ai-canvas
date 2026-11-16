import { defaultPackagingSurface, packagingRoleNames, packagingRoles, type PackagingDocument, type PackagingSurface } from "@/lib/packaging/types";
import { packagingSurface, packagingStudios } from "@/lib/packaging/surface";

export function PackagingSurfacePanel({ document, onChange }: { document: PackagingDocument; onChange: (surface: PackagingSurface) => void }) {
    const surface = packagingSurface(document);
    const change = (patch: Partial<PackagingSurface>) => onChange({ ...surface, ...patch });
    return (
        <aside className="pkg-parameters">
            <section>
                <h3>纸张与覆膜</h3>
                <label>
                    纸纹
                    <select aria-label="预览纸纹" value={surface.paper} onChange={(e) => change({ paper: e.target.value as PackagingSurface["paper"] })}>
                        <option value="smooth">平滑白卡</option>
                        <option value="kraft">牛皮纤维</option>
                        <option value="linen">细纹特种纸</option>
                    </select>
                </label>
                <label>
                    覆膜
                    <select aria-label="预览覆膜" value={surface.film} onChange={(e) => change({ film: e.target.value as PackagingSurface["film"] })}>
                        <option value="none">无膜</option>
                        <option value="matte">哑膜</option>
                        <option value="gloss">亮膜</option>
                        <option value="soft">触感膜</option>
                    </select>
                </label>
                <p className="pkg-help">外观设置只改变预览。结构纸厚继续取自材料与尺寸。</p>
            </section>
            <section>
                <h3>影棚与检查</h3>
                <label>
                    影棚
                    <select aria-label="包装影棚" value={surface.studio} onChange={(e) => change({ studio: e.target.value as PackagingSurface["studio"] })}>
                        {Object.entries(packagingStudios).map(([id, studio]) => (
                            <option key={id} value={id}>
                                {studio.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    检查模式
                    <select aria-label="包装工艺检查模式" value={surface.inspection} onChange={(e) => change({ inspection: e.target.value as PackagingSurface["inspection"] })}>
                        {packagingRoles.map((role) => (
                            <option key={role} value={role}>
                                {role === "artwork" ? "完整彩稿与工艺" : `${packagingRoleNames[role]}区域`}
                            </option>
                        ))}
                        <option value="checker">UV 棋盘 · 20 mm</option>
                    </select>
                </label>
                <label>
                    贴图精度
                    <select aria-label="包装预览精度" value={surface.quality} onChange={(e) => change({ quality: Number(e.target.value) as PackagingSurface["quality"] })}>
                        <option value={1024}>流畅 · 1024</option>
                        <option value={2048}>标准 · 2048</option>
                        <option value={4096}>细节 · 4096</option>
                    </select>
                </label>
            </section>
            <section>
                <h3>工艺外观</h3>
                <div className="pkg-fields">
                    <label>
                        烫金色
                        <input aria-label="烫金颜色" type="color" value={surface.foilColor} onChange={(e) => change({ foilColor: e.target.value })} />
                    </label>
                    <label>
                        烫银色
                        <input aria-label="烫银颜色" type="color" value={surface.silverColor} onChange={(e) => change({ silverColor: e.target.value })} />
                    </label>
                </div>
                <label>
                    凸凹预览深度 mm
                    <input aria-label="凸凹预览深度" type="range" min={0.05} max={1} step={0.05} value={surface.depth} onChange={(e) => change({ depth: Number(e.target.value) })} />
                    <span>{surface.depth.toFixed(2)} mm</span>
                </label>
                <p className="pkg-help">击凸、击凹使用高度与法线预览；镭射随视角改变颜色。生产分版只交付工艺覆盖区域。</p>
                <button type="button" onClick={() => onChange({ ...defaultPackagingSurface })}>
                    重置外观
                </button>
            </section>
        </aside>
    );
}
