# 包装刀板：开源项目与竞品研究

研究基于固定版本源码和官方功能页。官网数量与能力描述属于厂商声明；本次没有购买商业许可证、上传项目或实测付费导出。外部仓库仅作为研究资料，未安装或运行其程序，未复制参考项目的实现代码。

## 判断与实施方向

现有工作台已具备十二参数结构、刀版/3D 共享几何、图稿和工艺、项目保存、后台目录与资源保护。下一步最有价值的是把“设计预览”连接到“可修订、可打样、可核算”的流程，而不是继续堆盒型名称。

本轮实施四项：方案撤销/重做、A4/A3 真尺寸分页白样、可解释的网格拼版和纸材用量、图稿等比适配及层级操作。生产试算是纯计算，不新增数据表和服务接口；项目仍通过原包装 API 保存，材料仍来自管理员目录。

## GitHub 参考

| 项目与固定提交 | 许可 | 实际研究结论 |
| --- | --- | --- |
| [open-dieline](https://github.com/BrownBear127/open-dieline/tree/6087959a5dc8007356065daede043c3243c8bfb6) | PolyForm Noncommercial 1.0.0 | 生产 SVG 叠图校准、咬口/间距、纸张方向比较值得借鉴。它是有非商业限制的源码可见项目，不应称为可直接商用的开源依赖。仅研究方法。 |
| [packaging-dieline-generator](https://github.com/NealZhouPanda/packaging-dieline-generator/tree/f14d352209b01420fd24f52a2a2cd1ca3667975e) | MIT | 对照几何样本与回归、真实毫米 PDF、纸材估算。README 中英结构数量不同；实际 `src/main.js` 注册八个生成器，其中厂商编号与 FEFCO 编号不能混称。 |
| [PackagingWorkbench](https://github.com/stoneproof-tech/PackagingWorkbench/tree/81be7d6d719deaadf2fe37b7c2f13b9db20f06a0) | LGPL 2.1 | FreeCAD 的参数结构和切割/折叠/穿孔层体现 CAD 交付边界。若接入源码须单独处理 LGPL 义务，本轮不接入。 |
| [Rhino Packaging Toolkit](https://github.com/DDR68/Rhino_Packaging_Toolkit/tree/e062327c0f309a0bb3a374fb9a210713d97a13ca) | MIT | 结构与印前工具可分阶段交付；本次核对仓库和文档，未验证 Rhino 插件运行能力。 |
| [packbox](https://github.com/sbarrak/packbox/tree/3b1b33e34500e1fe615dbfe2d486e818696c0c78) | MIT | 对本项目最直接的参考：图稿操作、历史、内外面、真尺寸分页和自包含方案。其 README 也承认自动锁底没有真实配对锁槽，不能以名称推断生产结构正确。 |
| [OrigamiSimulator](https://github.com/amandaghassaei/OrigamiSimulator/tree/903ef27afcec7113390659935ae884798ed27188) | MIT | GPU 力学求解与 FOLD/SVG 输入有研究价值，但折纸运动不等于纸盒的纸厚、粘合、压痕及印前验证。 |
| [SVGnest](https://github.com/Jack000/SVGnest/tree/1248dc21efd3f90d1aa52ba5785e27e5217ed2c9) | MIT | 真实轮廓 NFP/IFP、遗传排序、worker 可作为后续异形排料参考。本轮用明确标注的整套外框网格，不宣称实现 SVGnest 级嵌套优化。 |

### 深读源码得到的约束

- packbox [`src/App.tsx`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/App.tsx)：历史保留不可变状态引用并按 400ms 合并，快捷键跳过输入框。本项目按字段区分合并组，保留输入框的原生撤销；任何新编辑都清空 redo，避免合并期间遗留分支。
- packbox [`paginate.ts`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/geometry/paginate.ts)：单页比较横竖，超幅后固定竖版、没有重叠。本项目两种方向都比较页数，采用可调重叠。
- packbox [`pdfExport.ts`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/geometry/pdfExport.ts)：注释称有内面图稿才输出内面，实际 `hasInside = true` 固定双面。本项目白样只输出一组结构，不默认重复印刷页数，不承诺未经验证的双面套准。
- packbox [`DielineEditor.tsx`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/components/DielineEditor.tsx)：等比角点、自由边点、45° 旋转吸附可以降低图稿误操作。本轮先落地等比参数编辑、放入/铺满/居中、旋转、复制和顺序，变换手柄另列后续。
- generator [`pdf.js`](https://github.com/NealZhouPanda/packaging-dieline-generator/blob/f14d352209b01420fd24f52a2a2cd1ca3667975e/src/pdf.js)：用 `72/25.4` 转换毫米；注释明确过早保留三位缩放会产生每米约 0.125mm 误差。本项目保留转换精度，并用独立 PDF 解析检查页面尺寸和路径变换。
- SVGnest [`placementworker.js`](https://github.com/Jack000/SVGnest/blob/1248dc21efd3f90d1aa52ba5785e27e5217ed2c9/util/placementworker.js)：先算内 NFP，再合并已放置部件的排斥轮廓，差集得到可放位置。缺失 NFP 会跳过部件，结果还需独立检查全部部件是否放入。
- SVGnest [`svgnest.js`](https://github.com/Jack000/SVGnest/blob/1248dc21efd3f90d1aa52ba5785e27e5217ed2c9/svgnest.js)：以定时器持续迭代；`stop()` 清掉定时器但没有在该方法中终止已启动 worker。未来接入必须有计算预算、取消与迟到结果隔离，不能直接将整个搜索循环放入 React 主线程。

## 官方竞品对照

| 产品与证据 | 对本项目的启发 | 实施边界 |
| --- | --- | --- |
| [Pacdora Dieline Generator](https://www.pacdora.com/tools/dieline-generator) | 参数尺寸、材料纸厚、AI/PDF/DXF 和在线协作；主站还有多对象场景、灯光、AI 背景 | 本次核对官方功能介绍，未实测编辑器/付费下载。AI 格式、多人协同及大规模结构库不能计为现有能力。 |
| [EngView Layout Optimizer](https://www.engview.com/en/packaging/layout-optimizer) | 比较排版废料、按数量建议份数、纸张数与多出数量、手动移动碰撞保护 | 本轮实现 0°/90° 整套网格比较和数量统计。不同结构混排、同结构不同图稿混排、异形排料需单独项目。 |
| [EngView Cost Estimator](https://www.engview.com/en/packaging/cost-estimator) | 成本由客户定义规则，抽取长度和面积；不是一个固定“市场价格” | 本轮单价由用户输入，只算纸材成本；印刷/制版/工艺/税费/运输不纳入。 |
| [ArtiosCAD](https://www.esko.com/en/products/artioscad) | 内衬、装配说明、折叠序列、报告、工业 CAD 产品导入 | 后续优先做可追溯的装配交付，再评估 STEP 等互操作。当前浏览器模型不宣称工业 CAD 等价。 |
| [Templatemaker 帮助](https://www.templatemaker.nl/help/) | 大模板重叠分页，PDF 100% 打印，DXF 可能被软件自动缩放，部分切割软件丢失折线颜色 | 本轮白样提供校准尺、页坐标、拼接标记和打印说明；生产 SVG/DXF 仍需工厂核对图层和单位。 |

## 后续优先级

| 优先级 | 能力 | 进入开发前的证据/验证 |
| --- | --- | --- |
| P1 | 真实图稿变换手柄、文字/条码图层、内外面 | 字体嵌入、条码可读性、内外 UV 与镜像套准；不能只在 2D 显示正确 |
| P1 | 结构白样校准档案、装配说明、工艺分层交付 | 工厂参考样、纸厚/间隙规则、工艺文件一致性；区分普通模板与已校准模板 |
| P2 | 分部件及多结构异形排料 | NFP 预算/取消、丝向、咬口、刀线间距、全量不相交验证、剩余部件报告 |
| P2 | 后台纸张目录、采购价格与报价版本 | 供应商授权数据、地区/币种/税费、有效期；保存报价快照而非套无依据默认价 |
| P2 | Illustrator/AI 与工业 CAD 接入 | 格式许可、解析器、专色/色彩管理、几何精度与生产样验收 |

这些后续项尚未实现。现有十二结构也没有 FEFCO/ECMA 认证；图稿数量、模板变体和独立结构数分别统计，不用一种数量代替另一种能力。
