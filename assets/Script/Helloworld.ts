import MotionTrail from "./MotionTrail";

const { ccclass, property } = cc._decorator;

@ccclass
export default class Helloworld extends cc.Component {
    heroNode: cc.Node = null;
    start() {
        this.heroNode = this.node.getChildByName('Hero');
        this.heroNode.getComponent(MotionTrail).active = true;
        this.node.on(cc.Node.EventType.TOUCH_MOVE, (event: cc.Event.EventTouch) => {
            let pos = event.getDelta();
            this.heroNode.x += pos.x;
            this.heroNode.y += pos.y;
        });
    }
}
