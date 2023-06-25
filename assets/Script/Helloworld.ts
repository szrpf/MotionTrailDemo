import MotionTrail from "./MotionTrail";

const {ccclass, property} = cc._decorator;

@ccclass
export default class Helloworld extends cc.Component {
    heroNode: cc.Node = null;
    touchX: number = 0;
    touchY: number = 0;
    start () {
        this.heroNode = this.node.getChildByName('Hero');
        this.node.on(cc.Node.EventType.TOUCH_START, (event) => {
            let pos = event.getLocation();
            this.touchX = pos.x - this.heroNode.x;
            this.touchY = pos.y - this.heroNode.y;
        });
        this.node.on(cc.Node.EventType.TOUCH_MOVE, (event) => {
            let pos = event.getLocation();
            this.heroNode.x = pos.x - this.touchX;
            this.heroNode.y = pos.y - this.touchY;
        });
        this.heroNode.getComponent(MotionTrail).active = true;
    }
}
