/*******************************************************************************
 * 创建:    2023年03月17日
 * 作者:    水煮肉片饭(27185709@qq.com)
 * 描述:    运动拖尾
 * 1、支持合批
 *    可以使用Atlas的图集帧作为拖尾贴图，不打断DrawCall
 * 2、支持世界坐标 与 节点坐标
 *    旧版拖尾只支持世界坐标，如果游戏中采用“反向移动地图”来实现视窗跟随，由于世界坐标并没有改变，会导致拖尾异常。
 *    新版拖尾支持世界坐标 和 本地坐标 两种模式切换，以上问题使用本地坐标就可以解决。
 * 3、避免内存波动
 *    原版拖尾通过不断创建渐隐顶点来模拟拖尾效果（类似于粒子系统）。
      新版拖尾的实现原理完全遵从拖尾的本质，顶点数是固定的，通过更新顶点位置来改变尾巴形状，内存更稳定。
 * 4、其他功能
 *    支持对拖尾形状做更灵活的设置，对贴图几乎没有要求，任何图片作为尾巴贴图都能有不错的效果。
*******************************************************************************/
const gfx = cc['gfx'];
class TrailData {
    x: number = 0;
    y: number = 0;
    dis: number = 0;
    cos: number = 0;
    sin: number = 0;
}
const { ccclass, property, playOnFocus, menu } = cc._decorator;
@ccclass
@playOnFocus
@menu('Comp/MotionTrail')
export default class MotionTrail extends cc.RenderComponent {
    @property({ type: cc.SpriteAtlas, editorOnly: true, readonly: true, displayName: CC_DEV && 'Atlas' })
    private atlas: cc.SpriteAtlas = null;
    @property
    private _spriteFrame: cc.SpriteFrame = null;
    @property({ type: cc.SpriteFrame, displayName: CC_DEV && 'SpriteFrame' })
    private get $spriteFrame() { return this._spriteFrame; }
    private set $spriteFrame(value: cc.SpriteFrame) {
        this._spriteFrame = value;
        this.$updateSpriteFrame();
    }
    @property
    private _active: boolean = true;
    @property({ displayName: CC_DEV && '是否激活', tooltip: CC_DEV && '设置拖尾可见性\n激活会重置拖尾位置' })
    get active() { return this._active; }
    set active(value: boolean) {
        this._active = value;
        this.enabled = value;
        this.$updateActive();
    }
    @property
    _isWorldXY: boolean = true;
    @property({ displayName: CC_DEV && '世界坐标', tooltip: CC_DEV && '顶点坐标是世界坐标还是本地坐标' })
    get $isWorldXY() { return this._isWorldXY; }
    set $isWorldXY(value: boolean) {
        this._isWorldXY = value;
        this.$updateXY();
    }
    @property({ displayName: CC_DEV && '偏移' })
    private offset: cc.Vec2 = cc.v2(0, 0);
    @property
    private _length: number = 20;
    @property({ type: cc.Integer, displayName: CC_DEV && '拖尾长度' })
    private get length() { return this._length; }
    private set length(value: number) {
        this._length = Math.max(value, 0);
        this.updateLength();
        this.updateWidth();
        this.$updateUV();
        this.$updateColor();
        this.resetPos();
    }
    @property
    private _headWidth: number = 100;
    @property({ displayName: CC_DEV && '头部宽度' })
    private get headWidth() { return this._headWidth; }
    private set headWidth(value: number) {
        this._headWidth = Math.max(value, 0);
        this.updateWidth();
    }
    @property
    private _tailWidth: number = 0;
    @property({ displayName: CC_DEV && '尾部宽度' })
    private get tailWidth() { return this._tailWidth; }
    private set tailWidth(value: number) {
        this._tailWidth = Math.max(value, 0);
        this.updateWidth();
    }
    @property
    private _headOpacity: number = 255;
    @property({ type: cc.Integer, min: 0, max: 255, slide: true, displayName: CC_DEV && '头部透明度' })
    private get headOpacity() { return this._headOpacity; }
    private set headOpacity(value: number) {
        this._headOpacity = value;
        this.$updateColor();
    }
    @property
    private _tailOpacity: number = 0;
    @property({ type: cc.Integer, min: 0, max: 255, slide: true, displayName: CC_DEV && '尾部透明度' })
    private get tailOpacity() { return this._tailOpacity; }
    private set tailOpacity(value: number) {
        this._tailOpacity = value;
        this.$updateColor();
    }
    private renderData = null;
    private meshID: number = 0;
    private capacity: number = 0;
    private verticesCount: number = 0;       //顶点数量
    private indicesCount: number = 0;        //三角形数量 * 3
    $flush: Function = null;                 //onFlushed中更新的顶点数据，需要调用flush才会被提交
    $xyOffset: number = 1e8;                 //顶点坐标数据，在顶点数组中的偏移
    $uvOffset: number = 1e8;                 //顶点uv数据，在顶点数组中的偏移
    $colorOffset: number = 1e8;              //顶点颜色数据，在顶点数组中的偏移
    $step: number = 0;                       //单个顶点数据的长度，例如：顶点格式“x,y,u,v,color” step = 5
    get $vDataLength() { return this.verticesCount * this.$step; }
    get $iDataLength() { return this.indicesCount; }
    private trailData: TrailData[] = [];
    private nodeOpacity: number = 255;

    protected _resetAssembler() {
        let assembler = this['_assembler'] = new Assembler2D();
        assembler['init'](this);
        assembler['updateRenderData'] = this.$onFlushed.bind(this);
        this.$flush = this['setVertsDirty'];
        let renderData = this.renderData = new cc['RenderData']();
        renderData.init(assembler);
        this.meshID = renderData.meshCount;
        this.$init();
    }

    protected $init() {
        this.$setVFmt();
        this.updateLength();
        this.updateWidth();
        this.node.on(cc.Node.EventType.COLOR_CHANGED, this.$updateColor, this);
        this.resetPos();
    }

    protected start() {
        this.$updateSpriteFrame();
        cc.director.once(cc.Director.EVENT_AFTER_DRAW, this.$updateColor, this);
    }
    //设置顶点格式
    protected $setVFmt(vfmt = new gfx.VertexFormat([
        { name: gfx.ATTR_POSITION, type: gfx.ATTR_TYPE_FLOAT32, num: 2 },
        { name: gfx.ATTR_UV0, type: gfx.ATTR_TYPE_FLOAT32, num: 2 },
        { name: gfx.ATTR_COLOR, type: gfx.ATTR_TYPE_UINT8, num: 4, normalize: true },
    ])) {
        let assembler = this['_assembler'];
        cc.sys.isNative && assembler['setVertexFormat'](vfmt);
        let fmtElement = vfmt._elements;
        for (let i = fmtElement.length - 1; i > -1; --i) {
            this.$step += fmtElement[i].bytes >> 2;
        }
        let fmtAttr = vfmt._attr2el;
        this.$xyOffset = fmtAttr[gfx.ATTR_POSITION].offset >> 2;
        this.$uvOffset = fmtAttr[gfx.ATTR_UV0].offset >> 2;
        this.$colorOffset = fmtAttr[gfx.ATTR_COLOR].offset >> 2;
    }
    //设置顶点个数和三角形个数
    protected $createBuffer(verticesCount: number, triangleCount: number = verticesCount - 2, capacityRatio: number = 2) {
        capacityRatio = Math.max(capacityRatio, 1.5);
        let renderData = this.renderData;
        this.verticesCount = Math.max(verticesCount, 0);
        this.indicesCount = Math.max(triangleCount * 3, 0);
        let isCreate = !renderData.vDatas[this.meshID];
        if (this.verticesCount > this.capacity) {                         //如果顶点个数超过容量，则扩容capacityRatio倍
            this.capacity = ~~Math.max(this.capacity * capacityRatio, this.verticesCount);
            isCreate = true;
        } else if (this.verticesCount < this.capacity / capacityRatio) {  //如果顶点个数小于容量的“1/capacityRatio”，则减容capacityRatio倍
            this.capacity = ~~Math.max(this.capacity / capacityRatio, this.verticesCount);
            isCreate = true;
        }
        if (isCreate) {
            let vertices = new Float32Array(this.verticesCount * this.$step);
            let indices = new Uint16Array(this.indicesCount);
            renderData.updateMesh(this.meshID, vertices, indices);
        }
        this.$updateIndice();
    }
    protected $getVData = (): Float32Array => this.renderData.vDatas[this.meshID];
    protected $getUintVData = (): Uint32Array => this.renderData.uintVDatas[this.meshID];
    protected $getIData = (): Uint16Array => this.renderData.iDatas[this.meshID];
    protected update() {
        cc.sys.isNative && this.$updateColor();
        this.$flush();
    }

    protected $onFlushed() {
        if (this.active === false) return;
        if (this.$spriteFrame === null) return;
        if (this.length === 0) return;
        if (this.nodeOpacity !== this.node.opacity) {
            this.nodeOpacity = this.node.opacity;
            this.$updateColor();
        }
        let data = this.trailData;
        for (let i = this.length - 1; i > 0; --i) {
            let cur = data[i], prev = data[i - 1];
            cur.x = prev.x;
            cur.y = prev.y;
            cur.sin = prev.sin;
            cur.cos = prev.cos;
        }
        if (this.$isWorldXY) {
            let m = this.node['_worldMatrix'].m;
            this.node['_updateWorldMatrix']();
            data[0].x = this.offset.x + m[12];
            data[0].y = this.offset.y + m[13];
        } else {
            data[0].x = this.offset.x + this.node.x;
            data[0].y = this.offset.y + this.node.y;
        }
        this.$updateXY();
    }

    protected $updateActive() {
        this.active && this.resetPos();
    }

    private $updateSpriteFrame() {
        let frame = this.$spriteFrame;
        let material = this.getMaterial(0) || cc.Material.getBuiltinMaterial('2d-sprite');
        material.define("USE_TEXTURE", true);
        material.setProperty("texture", frame ? frame.getTexture() : null);
        if (CC_EDITOR) {
            if (frame?.isValid && frame['_atlasUuid']) {
                cc.assetManager.loadAny(frame['_atlasUuid'], (err, asset: cc.SpriteAtlas) => {
                    this.atlas = asset;
                });
            } else {
                this.atlas = null;
            }
        }
        this.$updateUV();
    }

    protected $updateXY() {
        let vData = this.$getVData();
        let a = null, b = null;
        let ax = 0, ay = 0, bx = 0, by = 0;
        let id = 0;
        let step = this.$step;
        let tx = 0, ty = 0;
        if (!this.$isWorldXY) {
            tx = this.node.x;
            ty = this.node.y;
        }
        let data = this.trailData;
        for (let i = 0, len = this.length - 1; i < len; ++i) {
            a = data[i];
            b = data[i + 1];
            ax = a.x - tx;
            ay = a.y - ty;
            bx = b.x - tx;
            by = b.y - ty;
            if (i === 0) {
                let radian = Math.atan2(by - ay, bx - ax);
                a.sin = Math.sin(radian);
                a.cos = Math.cos(radian);
            }
            vData[id] = ax + a.dis * a.sin;
            vData[id + 1] = ay - a.dis * a.cos;
            id += step;
            vData[id] = ax - a.dis * a.sin;
            vData[id + 1] = ay + a.dis * a.cos;
            id += step;
        }
        vData[id] = bx + b.dis * a.sin;
        vData[id + 1] = by - b.dis * a.cos;
        id += step;
        vData[id] = bx - b.dis * a.sin;
        vData[id + 1] = by + b.dis * a.cos;
    }

    private $updateUV() {
        if (this.$spriteFrame === null) return;
        let vData = this.$getVData();
        let step = this.$step;
        let uvStep = 1 / (this.trailData.length - 1);
        for (let i = this.$uvOffset, id = 0, len = this.$vDataLength; i < len; i += step, ++id) {
            vData[i] = id & 1;
            vData[i + 1] = 1 - uvStep * (id >> 1);
        }
        this.$fitUV();
    }

    protected $updateColor() {
        let uintVData = this.$getUintVData();
        let trailLen = this.length;
        let headOpa = this.headOpacity;
        let opaDelt = (headOpa - this.tailOpacity) / (trailLen - 1);
        let opaRatio = this.node.opacity / 255;
        let rgb = (this.node.color.b << 16) | (this.node.color.g << 8) | this.node.color.r;
        for (let i = 0, id = this.$colorOffset, step = this.$step; i < trailLen; ++i) {
            let color = (((headOpa - opaDelt * i) * opaRatio) << 24) | rgb;
            uintVData[id] = color;
            id += step;
            uintVData[id] = color;
            id += step;
        }
    }

    protected $updateIndice() {
        let iData = this.$getIData();
        for (let i = 0, id = 0, len = this.$iDataLength; i < len; ++id) {
            iData[i++] = id;
            iData[i++] = id + 1;
            iData[i++] = id + 2;
        }
    }

    private updateLength() {
        let trailLen = this.length;
        this.trailData = [];
        for (let i = 0; i < trailLen; ++i) {
            this.trailData[i] = new TrailData();
        }
        this.$createBuffer(trailLen << 1);
    }

    private updateWidth() {
        let data = this.trailData;
        let trailLen = this.length;
        let headHalfW = this.headWidth * 0.5;
        let disDelt = (headHalfW - this.tailWidth * 0.5) / (trailLen - 1);
        for (let i = 0; i < trailLen; ++i) {
            data[i].dis = headHalfW - disDelt * i;
        }
    }

    private resetPos() {
        let data = this.trailData;
        let tx = this.offset.x;
        let ty = this.offset.y;
        if (this.$isWorldXY) {
            let m = this.node['_worldMatrix'].m;
            this.node['_updateWorldMatrix']();
            tx += m[12];
            ty += m[13];
        } else {
            tx += this.node.x;
            ty += this.node.y;
        }
        for (let i = this.length - 1; i > -1; --i) {
            data[i].x = tx;
            data[i].y = ty;
        }
        let vData = this.$getVData();
        let step = this.$step;
        for (let i = 0, len = this.$vDataLength; i < len; i += step) {
            vData[i] = tx;
            vData[i + 1] = ty;
        }
    }
    //自动适配UV，修改顶点uv数据后需主动调用该函数
    protected $fitUV() {
        if (this.$spriteFrame === null) return;
        let step = this.$step;
        let atlasW = this.$spriteFrame.getTexture().width;
        let atlasH = this.$spriteFrame.getTexture().height;
        let frameRect = this.$spriteFrame.getRect();
        let vData = this.$getVData();
        if (this.$spriteFrame['_rotated']) {
            for (let i = this.$uvOffset, id = 0, len = this.$vDataLength; i < len; i += step, ++id) {
                let tmp = vData[i];
                vData[i] = ((1 - vData[i + 1]) * frameRect.height + frameRect.x) / atlasW;
                vData[i + 1] = (tmp * frameRect.width + frameRect.y) / atlasH;
            }
        } else {
            for (let i = this.$uvOffset, id = 0, len = this.$vDataLength; i < len; i += step, ++id) {
                vData[i] = (vData[i] * frameRect.width + frameRect.x) / atlasW;
                vData[i + 1] = (vData[i + 1] * frameRect.height + frameRect.y) / atlasH;
            }
        }
    }

    protected onDestroy() {
        this.node.targetOff(this);
    }
}

class Assembler2D extends cc['Assembler'] {
    protected fillBuffers(comp) {
        let vData = comp.renderData.vDatas[comp.meshID];
        let iData = comp.renderData.iDatas[comp.meshID];
        let buffer = cc.renderer['_handle']._meshBuffer;
        let offsetInfo = buffer.request(comp.verticesCount, comp.indicesCount);
        let vertexOffset = offsetInfo.byteOffset >> 2;
        let vbuf = buffer._vData;
        if (vData.length + vertexOffset > vbuf.length) {
            vbuf.set(vData.subarray(0, vbuf.length - vertexOffset), vertexOffset);
        } else {
            vbuf.set(vData, vertexOffset);
        }
        let ibuf = buffer._iData;
        let indiceOffset = offsetInfo.indiceOffset;
        let vertexId = offsetInfo.vertexOffset;
        for (let i = 0, l = iData.length; i < l; i++) {
            ibuf[indiceOffset++] = vertexId + iData[i];
        }
    }
}