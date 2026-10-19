import { expect, test } from "bun:test";
import { App } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ProductNodeContent } from "../src/components/canvas/nodes/product-node";
import { CanvasNodeActionContext } from "../src/components/canvas/canvas-node-action-context";
import { CanvasNodeGraphContext } from "../src/components/canvas/canvas-node-graph-context";
import { canvasThemes } from "../src/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

test("real product card renders named image inputs without the duplicate editor", () => {
    const product: CanvasNodeData = {id:"product",type:CanvasNodeType.Product,title:"测试商品",position:{x:0,y:0},width:460,height:660};
    const empty: CanvasNodeData = {...product,id:"empty",type:CanvasNodeType.Image,title:"空正面"};
    const reference: CanvasNodeData = {...empty,id:"reference",metadata:{content:"/reference.png"}};
    const edges = [{id:"front",fromNodeId:empty.id,toNodeId:product.id,toHandleId:"product-view:front"},{id:"ref",fromNodeId:reference.id,toNodeId:product.id,toHandleId:"visual-reference:3"}];
    const html = renderToStaticMarkup(<MemoryRouter><App><CanvasNodeActionContext.Provider value={{updateMetadata:()=>{}}}><CanvasNodeGraphContext.Provider value={{getInputNodes:()=>[empty,reference],getConnections:()=>edges}}><ProductNodeContent node={product} theme={canvasThemes.dark}/></CanvasNodeGraphContext.Provider></CanvasNodeActionContext.Provider></App></MemoryRouter>);
    for (const name of ["正面","侧面","背面","细节","包装"]) expect(html).toContain('aria-label="连接到' + name + '"');
    expect(html).toContain('aria-label="替换正面"');
    expect(html).toContain('aria-label="查看参考 1"');
    expect(html).toContain('data-ecommerce-input="visual-reference:3"');
    expect(html).toContain('data-ecommerce-input="visual-reference:0"');
    for (const removed of ["整组统一","按行业套路铺底","SKU","商品档案","材质"]) expect(html).not.toContain(removed);
});
