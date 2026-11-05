import {makeProject, all, createRef, createSignal, easeInOutCubic, waitFor} from '@revideo/core';
import {makeScene2D, Video, Txt, Rect, Node, Path} from '@revideo/2d';
import story from './story.json';

const scene = makeScene2D('comparison', function* (view) {
  const stage = createRef<Rect>();
  const camera = createRef<Node>();
  const before = createRef<Video>();
  const after = createRef<Video>();
  const caption = createRef<Txt>();
  const label = createRef<Txt>();
  const ring = createRef<Rect>();
  const hue = createSignal('#ff9385');
  const initial=story.sides[0].cues[0];
  const initialScale=Math.min(1,initial.camera.scale);
  const clamp = (value:number, extent:number) => Math.max(-Math.max(0,extent),Math.min(Math.max(0,extent),value));
  const x = createSignal(initial.focus.x), y = createSignal(initial.focus.y), w = createSignal(initial.focus.width), h = createSignal(initial.focus.height);
  // One nonzero-winding path: outer clockwise rectangle, inner counterclockwise hole.
  // No overlapping translucent rectangles or antialiased horizontal seams.
  const mask = () => {
    const l=x()-w()/2, r=x()+w()/2, t=y()-h()/2, b=y()+h()/2, q=10;
    return `M -4096 -4096 H 4096 V 4096 H -4096 Z M ${l+q} ${t} Q ${l} ${t} ${l} ${t+q} V ${b-q} Q ${l} ${b} ${l+q} ${b} H ${r-q} Q ${r} ${b} ${r} ${b-q} V ${t+q} Q ${r} ${t} ${r-q} ${t} Z`;
  };
  yield view.add(<>
    <Rect width={1280} height={800} fill={'#15191c'}/>
    <Txt ref={label} text={'BEFORE'} x={-592} y={-363} offset={[-1,0]} fontFamily={'Arial'} fontWeight={700} fontSize={18} letterSpacing={2} fill={hue}/>
    <Txt text={story.title} x={592} y={-363} offset={[1,0]} fontFamily={'Arial'} fontSize={16} fill={'#aab1b5'}/>
    <Txt ref={caption} text={story.sides[0].cues[0].caption} x={0} y={-302} width={1184} textWrap={true} textAlign={'left'} fontFamily={'Arial'} fontWeight={600} fontSize={36} lineHeight={40} fill={'#f7f6f1'}/>
    <Rect ref={stage} y={60} width={1232} height={620} radius={14} clip={true} fill={'#15191c'}>
      <Node ref={camera} scale={initialScale} position={[clamp(-initial.focus.x*initialScale,640*initialScale-616),clamp(-initial.focus.y*initialScale,400*initialScale-310)]}>
        <Video ref={before} src={'/before.mp4'} time={story.sides[0].start} play={true} width={1280} height={800} volume={0}/>
        <Video ref={after} src={'/after.mp4'} time={story.sides[1].start} play={false} opacity={0} width={1280} height={800} volume={0}/>
        <Path data={mask} fill={'#08121b'} opacity={.40}/>
        <Rect ref={ring} x={x} y={y} width={w} height={h} radius={10} stroke={hue} lineWidth={3}/>
      </Node>
    </Rect>
  </>);
  function* cue(c:any) {
    yield* waitFor(c.at);
    caption().text(c.caption);
    yield caption();
    if (caption().height() > 88) throw new Error('Caption exceeds two readable lines. Shorten the scenario caption.');
    yield* all(x(c.focus.x,.85,easeInOutCubic), y(c.focus.y,.85,easeInOutCubic),
      w(c.focus.width,.85,easeInOutCubic), h(c.focus.height,.85,easeInOutCubic),
      camera().scale(c.camera.scale,.85,easeInOutCubic),
      camera().position(c.camera.position,.85,easeInOutCubic));
  }
  function* pulse(at:number) {
    yield* waitFor(at);
    yield* ring().lineWidth(5,.10).to(3,.26);
  }
  function* playSide(s:any) {
    yield* all(waitFor(s.duration), ...s.cues.map(cue), ...s.inputs.map(pulse));
  }
  yield* playSide(story.sides[0]);
  before().pause();
  yield* stage().opacity(0,story.transition,easeInOutCubic);
  before().opacity(0); after().opacity(1);
  hue('#bde178'); label().text('AFTER');
  const first = story.sides[1].cues[0];
  x(first.focus.x); y(first.focus.y); w(first.focus.width); h(first.focus.height);
  const entryScale = Math.min(1.18,first.camera.scale);
  camera().scale(entryScale);
  camera().position([clamp(-first.focus.x*entryScale,640*entryScale-616),clamp(-first.focus.y*entryScale,400*entryScale-310)]);
  after().play();
  yield* all(stage().opacity(1,.2,easeInOutCubic), playSide(story.sides[1]));
  after().pause();
});
export default makeProject({scenes:[scene],settings:{shared:{size:{x:1280,y:800},background:'#15191c'},rendering:{fps:30,resolutionScale:1,exporter:{name:'@revideo/core/ffmpeg',options:{format:'mp4'}}}}});
