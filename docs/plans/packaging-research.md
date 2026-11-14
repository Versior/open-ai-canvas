# 包装刀板：开源项目与竞品研究

研究基于固定版本源码和官方功能页。官网数量与能力描述属于厂商声明；本次没有购买商业许可证、上传项目或实测付费导出。外部仓库仅作为研究资料，未安装或运行其程序，未复制参考项目的实现代码。

## 判断与实施方向

现有工作台已具备十二参数结构、刀版/3D 共享几何、图稿和工艺、项目保存、后台目录与资源保护。下一步最有价值的是把“设计预览”连接到“可修订、可打样、可核算”的流程，而不是继续堆盒型名称。

已实施方案撤销/重做、A4/A3 真尺寸白样、网格拼版、八向图稿操作、交付检查和工艺分层。最新补齐保存版本的模型效果图、自然语言补充、结果继续修改、后台开关/图库，以及可播放的折叠开合视频。效果图复用既有任务、资源和账务表，没有新增迁移；几何和印刷稿由包装工作台维护。

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
| [packcad](https://github.com/ahzs645/packcad/tree/a42a53240cf107f8b4bf1c6f9f87f8b46e55bc4f) | MIT | 纸厚单位规则、几何 golden tests 与仿真误差边界值得参考。仓库使用外部 file: Atelier 依赖，README 未提供完整生产构建路径；未运行。 |
| [fold-studio](https://github.com/hungvd194/fold-studio/tree/9cab63ce1d903dca269cce1884a821b53472c30d) | 未发现 LICENSE | README 的保守排版、独立顶底插片、撤销/手势取消和印前边界有参考价值；不能作为已获商用许可的代码依赖。 |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI/tree/eee59185ff4f43ae2d9ad122b245619d27d9daad) | GPL 3.0 | `nodes.py` 的 VAEEncode 接受参考像素、KSampler 接受 latent_image/denoise，再通过 SaveImage 保存结果。说明参考输入、变化强度与结果保存是独立环节；本轮复用现有协议和任务，未嵌入 ComfyUI 源码。 |
| [InvokeAI](https://github.com/invoke-ai/InvokeAI/tree/48b83d98daa57315e8bf8e7754bdbc65aac86b8d) | Apache 2.0 | FLUX.2 图生图回归 `tests/app/invocations/test_flux2_denoise_img2img_normalization.py` 明确检验参考 latent 与噪声归一顺序；改变强度和保真度不能靠一个泛化滑块保证。本轮使用所选模型实际暴露的设置，不伪造跨模型通用强度参数。 |

### 深读源码得到的约束

- packbox [`src/App.tsx`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/App.tsx)：历史保留不可变状态引用并按 400ms 合并，快捷键跳过输入框。本项目按字段区分合并组，保留输入框的原生撤销；任何新编辑都清空 redo，避免合并期间遗留分支。
- packbox [`paginate.ts`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/geometry/paginate.ts)：单页比较横竖，超幅后固定竖版、没有重叠。本项目两种方向都比较页数，采用可调重叠。
- packbox [`pdfExport.ts`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/geometry/pdfExport.ts)：注释称有内面图稿才输出内面，实际 `hasInside = true` 固定双面。本项目白样只输出一组结构，不默认重复印刷页数，不承诺未经验证的双面套准。
- packbox [`DielineEditor.tsx`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/components/DielineEditor.tsx)：固定相反锚点的等比角点、自由边点和旋转吸附可以降低误操作。本轮实现八向手柄、15° 旋转吸附、完整图稿画幅与一手势一步撤销；取消恢复原稿及 redo 分支。
- packbox [`glbExport.ts`](https://github.com/sbarrak/packbox/blob/3b1b33e34500e1fe615dbfe2d486e818696c0c78/src/geometry/glbExport.ts)：导出当前姿态 GLB，不能把静态 GLB 当作视频。本项目区分静态 GLB、硬盒 fold/open 动画 GLB 和十二结构的 MP4/WebM 视频。
- generator [`pdf.js`](https://github.com/NealZhouPanda/packaging-dieline-generator/blob/f14d352209b01420fd24f52a2a2cd1ca3667975e/src/pdf.js)：用 `72/25.4` 转换毫米；注释明确过早保留三位缩放会产生每米约 0.125mm 误差。本项目保留转换精度，并用独立 PDF 解析检查页面尺寸和路径变换。
- SVGnest [`placementworker.js`](https://github.com/Jack000/SVGnest/blob/1248dc21efd3f90d1aa52ba5785e27e5217ed2c9/util/placementworker.js)：先算内 NFP，再合并已放置部件的排斥轮廓，差集得到可放位置。缺失 NFP 会跳过部件，结果还需独立检查全部部件是否放入。
- SVGnest [`svgnest.js`](https://github.com/Jack000/SVGnest/blob/1248dc21efd3f90d1aa52ba5785e27e5217ed2c9/svgnest.js)：以定时器持续迭代；`stop()` 清掉定时器但没有在该方法中终止已启动 worker。未来接入必须有计算预算、取消与迟到结果隔离，不能直接将整个搜索循环放入 React 主线程。

## 官方竞品对照

| 产品与证据 | 对本项目的启发 | 实施边界 |
| --- | --- | --- |
| [Pacdora Dieline Generator](https://www.pacdora.com/tools/dieline-generator) | 参数尺寸、材料纸厚、AI/PDF/DXF 和在线协作；主站还有多对象场景、灯光、AI 背景 | 本次核对官方功能介绍，未实测编辑器/付费下载。AI 格式、多人协同及大规模结构库不能计为现有能力。 |
| [Pacdora AI 包装设计](https://www.pacdora.com/tools/ai-inspired-packaging-design) / [AI 背景](https://www.pacdora.com/tools/ai-background-generator) | 选 mockup 或上传参考，描述需求、继续对话微调，并下载效果图；背景流程为上传、选风格、导出 | 官方的结构保真、生产就绪和模板数量属于厂商声明，未实测。落地五场景、补充要求和结果继续修改；不承诺 AI 自动输出可印刷刀版。 |
| [EngView Layout Optimizer](https://www.engview.com/en/packaging/layout-optimizer) | 比较排版废料、按数量建议份数、纸张数与多出数量、手动移动碰撞保护 | 本轮实现 0°/90° 整套网格比较和数量统计。不同结构混排、同结构不同图稿混排、异形排料需单独项目。 |
| [EngView Cost Estimator](https://www.engview.com/en/packaging/cost-estimator) | 成本由客户定义规则，抽取长度和面积；不是一个固定“市场价格” | 本轮单价由用户输入，只算纸材成本；印刷/制版/工艺/税费/运输不纳入。 |
| [ArtiosCAD](https://www.esko.com/en/products/artioscad) | 内衬、装配说明、折叠序列、报告、工业 CAD 产品导入 | 后续优先做可追溯的装配交付，再评估 STEP 等互操作。当前浏览器模型不宣称工业 CAD 等价。 |
| [Templatemaker 帮助](https://www.templatemaker.nl/help/) | 大模板重叠分页，PDF 100% 打印，DXF 可能被软件自动缩放，部分切割软件丢失折线颜色 | 本轮白样提供校准尺、页坐标、拼接标记和打印说明；生产 SVG/DXF 仍需工厂核对图层和单位。 |

## 十二结构是否足够

| 范围 | 已有结构 | 尚缺能力 |
| --- | --- | --- |
| 零售折叠纸盒 | 双插、反插、飞机盒、枕形盒 | 自动锁底/扣底的真实配对锁槽、挂孔/提手专用结构、纸厚与压痕校准档案 |
| 礼盒 | 天地盖、抽屉、书型、对开 | 多件产品装配、异形内衬、磁吸/包边工艺及工厂参考样 |
| 展示与托盘 | 开放托盘、斜边展示 | 陈列架、多层展示、承载/堆码试验 |
| 软包装 | 三边封袋、吸嘴袋 | 自立底/拉链/折边袋、真实膜材受力与制袋工艺校核 |

十二种独立引擎适合通用设计和打样起步，模板复制只是参数变体。没有经过工厂白样验收、FEFCO/ECMA 对号认证和承载试验，不能称为工业完整结构库。扩充优先按真实生产样与装配数据开展。

## 模型与动画的实际实施边界

- 当前 3D 视角生成 1024px 参考图；只有已保存、未变更的方案可截取。图库读取服务端保存快照；提交提示词也从同一服务端版本构建，避免草稿尺寸混入旧版本。
- 五场景为棚拍、主视觉、生活、工艺、包装创意提案。前四项保留印刷内容，创意提案允许探索配色/排版，但不生成新品牌、认证或产品事实。所有结果单独保存，认可后仍须制作平面稿并确认出血。
- 继续修改复用前一轮结果资源，并记录父任务。服务端检查同账号、同项目/版本、父任务成功和引用确实属于其输出；不会自动把旧版本参考绑定新尺寸。
- 模型目录决定可选模型与参考图能力；报价、预占、结算、取消和存储由通用任务执行。没有可用图片模型时明确提示配置，不静默切模型或伪造图像。
- 折叠/开合视频使用现有场景 apply 计算真实帧，8 秒、最高 2K。按浏览器编码能力输出 MP4 或 WebM，支持取消；动画 GLB 仍供三维软件播放。曲面袋体可录视频，但不能用铰链轨道表达顶点形变。
- 取景覆盖运动全程，成品视角仍单独适配。专项以真实场景测量边界，并检查 0/中间/终态投影；录制器初始化失败、取消和退场释放媒体轨道及渲染上下文。
- 本轮未执行收费模型出图，也未运行上述参考项目。真实 AI 的字形、Logo、材质和结构保真需要选定模型后的人工验收。

## 后续优先级

| 优先级 | 能力 | 进入开发前的证据/验证 |
| --- | --- | --- |
| P1 | 文字/条码图层、内外面 | 字体嵌入、条码可读性、内外 UV 与镜像套准；不能只在 2D 显示正确 |
| P1 | 结构白样校准档案、装配说明 | 工厂参考样、纸厚/间隙规则；区分普通模板与已校准模板。工艺分层交付已实现，专色/印厂套准仍待验收 |
| P2 | 分部件及多结构异形排料 | NFP 预算/取消、丝向、咬口、刀线间距、全量不相交验证、剩余部件报告 |
| P2 | 后台纸张目录、采购价格与报价版本 | 供应商授权数据、地区/币种/税费、有效期；保存报价快照而非套无依据默认价 |
| P2 | Illustrator/AI 与工业 CAD 接入 | 格式许可、解析器、专色/色彩管理、几何精度与生产样验收 |

这些后续项尚未实现。现有十二结构也没有 FEFCO/ECMA 认证；图稿数量、模板变体和独立结构数分别统计，不用一种数量代替另一种能力。
