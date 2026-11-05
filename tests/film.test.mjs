import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {planFilm,cameraFor,composeFilm} from '../skills/fixtape/lib/film.mjs';
import {fileHash,inspectVideo} from '../skills/fixtape/lib/media.mjs';
const exec=promisify(execFile);
const box={x:260,y:192,width:760,height:414};
function receipt(side, read='count') {
  const expected=read==='count'?(side==='before'?3:2):(side==='before'?'Old value':'Saved value');
  const observation={kind:'observation',target:'.result',anchor:'.card',read,expected,observed:expected,observedAfterHold:expected,caption:side==='before'?'The old result remains.':'The new result is visible.',outcome:side==='before'?'problem':'fixed',pass:true,bounds:{...box},startMs:10000,endMs:14200};
  return {schemaVersion:1,status:'passed',side,title:'Save the result',goal:'Keep the changed value.',presentation:'clean',pacing:{scale:1},viewport:{width:1280,height:800},scenario:{sha256:'a'.repeat(64)},actionCount:1,exportStatus:'complete',export:{duration:15},events:[
    {kind:'intro',startMs:0,endMs:3000},
    {kind:'step',target:'.card',caption:'Review the current result.',bounds:{...box},startMs:3200,endMs:5700},
    {kind:'step',target:'.save',caption:'Save the change.',bounds:{x:850,y:250,width:100,height:40},startMs:5800,endMs:9900,actionStartMs:8300,actionEndMs:9900,input:[{type:'pointerdown',withinTarget:true,atMs:9100}]},observation],observations:[structuredClone(observation)]};
}
const media={before:{width:1280,height:800,duration:15},after:{width:1280,height:800,duration:15}};
function pair(read){return [receipt('before',read),receipt('after',read)];}

test('planner supports count/text/value, a faster AFTER, all real inputs and fitted result bounds',()=>{
  for (const read of ['count','text','value']) {
    const [before,after]=pair(read), story=planFilm(before,after,media);
    assert.equal(story.sides[0].start,3.2);
    assert.equal(story.sides[1].start,8);
    assert.ok(Math.abs(story.sides[1].inputs[0]-1.1)<.001);
    assert.equal(story.sides[1].actions[0].start,.3000000000000007);
    assert.equal(story.sides[1].cues.at(-1).at,2);
    assert.ok(story.duration<25);
    for(const side of story.sides) assert.ok(side.duration-side.terminalAt>=4);
  }
  const framing=cameraFor(box),{scale,position}=framing.camera;
  for(const x of [box.x,box.x+box.width]) assert.ok(640+(x-640)*scale+position[0]>=24&&640+(x-640)*scale+position[0]<=1256);
  for(const y of [box.y,box.y+box.height]) assert.ok(460+(y-400)*scale+position[1]>=150&&460+(y-400)*scale+position[1]<=770);
});

test('multiple actions remain continuous and derived input types may differ between sides',()=>{
  const [before,after]=pair('value');
  for(const r of [before,after]) {
    r.events.splice(1,1,{kind:'step',target:'.field',caption:'Type the change.',bounds:{x:280,y:210,width:400,height:50},startMs:3200,endMs:5700,actionStartMs:4000,actionEndMs:5700,input:[{type:'input',withinTarget:true,atMs:4300}]});
    r.actionCount=2;
  }
  after.events[2].input.push({type:'input',withinTarget:true,atMs:9110});
  const story=planFilm(before,after,media);
  for(const s of story.sides) {assert.equal(s.actions.length,2);assert.equal(s.inputs.length,2);assert.equal(s.end,14.2);assert.ok(s.actions[1].start>s.actions[0].end);}
  assert.equal(story.sides[1].actions[1].inputTimes.length,2);
});

test('camera keeps the source over the stage when focusing near a viewport edge',()=>{
  for (const b of [{x:873,y:304,width:122,height:32},{x:30,y:30,width:80,height:30},{x:1150,y:720,width:90,height:40}]) {
    const {scale,position:[x,y]}=cameraFor(b).camera;
    assert.ok(-640*scale+x<=-616 && 640*scale+x>=616);
    assert.ok(-400*scale+y<=-310 && 400*scale+y>=310);
  }
});

const invalid=[
  ['failed capture',r=>{r.status='failed';},/passed/],
  ['test speed',r=>{r.pacing.scale=.01;},/full-speed/],
  ['annotated',r=>{r.presentation='annotated';},/clean/],
  ['bad target',r=>{r.events[1].bounds.width=2000;},/bounds/],
  ['bad input',r=>{r.events[2].input[0].withinTarget=false;},/input/],
  ['input before action',r=>{r.events[2].input[0].atMs=8000;},/input/],
  ['unverified result',r=>{r.events[3].observedAfterHold=99;},/observation/],
  ['unsupported read',r=>{r.events[3].read='html';},/observation/],
  ['short verdict',r=>{r.events[3].endMs=12000;r.observations=structuredClone([r.events[3]]);},/4 seconds/],
  ['action mismatch',r=>{r.events[2].target='.other';},/sequences/],
  ['scenario mismatch',r=>{r.scenario.sha256='b'.repeat(64);},/identity/],
  ['title mismatch',r=>{r.title='Different';},/identity/],
];
for(const [name,mutate,pattern] of invalid) test(`rejects ${name}`,()=>{const [b,a]=pair();mutate(a);assert.throws(()=>planFilm(b,a,media),pattern);});

test('overlong comparisons fail with actionable guidance instead of dropping actions',()=>{
  const [b,a]=pair();
  for(const r of [b,a]) {
    for(const e of r.events.slice(2)){for(const k of ['startMs','endMs','actionStartMs','actionEndMs'])if(k in e)e[k]+=9000;if(e.input)for(const input of e.input)input.atMs+=9000;}
    r.observations=structuredClone([r.events.at(-1)]);r.export.duration=25;
  }
  assert.throws(()=>planFilm(b,a,{before:{...media.before,duration:25},after:{...media.after,duration:25}}),/25 seconds.*smaller scenario/);
});

test('actual Revideo render preserves source hashes, coherent spotlight and output boundaries',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'film-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [side,color] of [['before','blue'],['after','green']]) {
    const dir=path.join(root,side);await mkdir(dir);
    const file=path.join(dir,'reel.mp4');
    await exec('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=1280x800:r=30`,'-t','15','-c:v','libx264','-pix_fmt','yuv420p',file]);
    const r=receipt(side);r.export={...(await inspectVideo(file)),sha256:await fileHash(file)};
    r.events[1].bounds={x:1150,y:250,width:100,height:40};
    await writeFile(path.join(dir,'receipt.json'),JSON.stringify(r));
  }
  const beforeHash=await fileHash(path.join(root,'before/reel.mp4'));
  const result=await composeFilm(root);
  assert.equal(result.status,'complete');assert.equal(result.export.frameRate,'30/1');assert.equal(result.export.sampleAspectRatio,'1:1');assert.ok(result.export.bitrate>=192000);
  assert.equal(await fileHash(path.join(root,'before/reel.mp4')),beforeHash);
  assert.equal(await fileHash(path.join(root,'film.mp4')),result.export.sha256);
  assert.equal(JSON.parse(await readFile(path.join(root,'film.json'),'utf8')).sources.before.sha256,beforeHash);
  const opening=await exec('ffmpeg',['-v','error','-ss','0.1','-i',path.join(root,'film.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:4*1024*1024});
  const openingPixel=(x,y)=>[...opening.stdout.subarray((y*1280+x)*3,(y*1280+x)*3+3)];
  const left=openingPixel(40,650),right=openingPixel(1240,650);
  assert.ok(left[2]>100 && right[2]>100,'source covers both stage edges during the opening zoom');
  assert.ok(right.every((value,index)=>Math.abs(value-left[index])<9),'opening camera does not expose an uncovered edge');
  // The source is uniform: no horizontal opacity seams may extend outside the hole.
  const {stdout}=await exec('ffmpeg',['-v','error','-ss','9','-i',path.join(root,'film.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer',maxBuffer:4*1024*1024});
  const pixel=(x,y)=>[...stdout.subarray((y*1280+x)*3,(y*1280+x)*3+3)];
  const outside=pixel(80,400);for(const y of [240,300,500,650]) assert.ok(pixel(80,y).every((v,i)=>Math.abs(v-outside[i])<9));
  assert.ok(pixel(640,460)[2]>outside[2]+30,'spotlight preserves undimmed source');
  await assert.rejects(composeFilm(root),/overwrite/);
});
