import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { readFile, writeFile, copyFile, mkdir, mkdtemp, rm, open, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileHash, inspectVideo, checkMediaTools, exists } from './media.mjs';

const exec = promisify(execFile);
const templateDir = fileURLToPath(new URL('./revideo/', import.meta.url));
const TRANSITION = .25;
const fail = message => { throw new Error(message); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const text = (value, label, limit=180) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) fail(`${label} must be nonempty text, at most ${limit} characters.`);
};
function bounds(b) {
  if (!b || !['x','y','width','height'].every(k=>finite(b[k])) || b.x<0 || b.y<0 || b.width<=0 || b.height<=0 || b.x+b.width>1280.1 || b.y+b.height>800.1) fail('Invalid or clipped target bounds in recording receipt.');
  return b;
}
function union(a,b) {
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
  return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};
}
export function cameraFor(b) {
  bounds(b);
  const width=Math.min(1280,b.width+24),height=Math.min(800,b.height+24);
  const scale=Math.min(1.7,1180/width,570/height);
  const x=Math.max(width/2,Math.min(1280-width/2,b.x+b.width/2))-640;
  const y=Math.max(height/2,Math.min(800-height/2,b.y+b.height/2))-400;
  const clamp = (value, extent) => Math.max(-Math.max(0, extent), Math.min(Math.max(0, extent), value));
  return {focus:{x,y,width,height},camera:{scale,position:[clamp(-x*scale,640*scale-616),clamp(-y*scale,400*scale-310)]}};
}
function validate(receipt, side, media) {
  if (receipt.status!=='passed' || receipt.exportStatus!=='complete' || receipt.pacing?.scale!==1 || receipt.presentation!=='clean') fail(`${side}: film requires passed, full-speed recordings with presentation:'clean'. Record both sides again in clean mode.`);
  if (receipt.side!==side || !same(receipt.viewport,{width:1280,height:800})) fail(`${side}: unsupported side or viewport; use 1280×800 recordings.`);
  text(receipt.title,'Title',100); text(receipt.goal,'Goal',220);
  if (!/^[a-f0-9]{64}$/.test(receipt.scenario?.sha256||'')) fail('Missing scenario SHA256 identity.');
  if (media.width!==1280 || media.height!==800 || !finite(media.duration) || media.duration<=0 || Math.abs(media.duration-receipt.export.duration)>.1) fail(`${side}: source media dimensions/duration do not match the receipt.`);
  if (!Array.isArray(receipt.events)) fail('Missing recording events.');
  const lag=receipt.videoLagMs??0;
  if (!finite(lag) || lag<0 || lag>3000) fail(`${side}: the video start lag (${lag} ms) is outside the supported range. Record again on a less loaded machine.`);
  const shift=t=>Math.max(0,t-lag);
  const raw=receipt.events.filter(e=>e.kind==='step'||e.kind==='observation');
  if (!same(raw.filter(e=>e.kind==='observation'),receipt.observations)) fail('A matching terminal observation is required.');
  const events=raw.map(e=>({...e,startMs:shift(e.startMs),endMs:shift(e.endMs),
    ...(e.actionStartMs!==undefined?{actionStartMs:shift(e.actionStartMs),actionEndMs:shift(e.actionEndMs)}:{}),
    ...(Array.isArray(e.input)?{input:e.input.map(i=>({...i,atMs:shift(i.atMs)}))}:{})}));
  const actions=[]; let previous=0;
  for (const e of events) {
    bounds(e.bounds); text(e.caption,'Caption'); text(e.target,'Target',500);
    if (![e.startMs,e.endMs].every(finite) || e.startMs<previous || e.endMs<e.startMs || e.endMs/1000>media.duration+.1) fail('Malformed, overlapping or out-of-media event times.');
    previous=e.endMs;
    if (e.kind==='step' && e.actionStartMs!==undefined) {
      if (![e.actionStartMs,e.actionEndMs].every(finite) || e.actionStartMs<e.startMs || e.actionEndMs<e.actionStartMs || e.actionEndMs>e.endMs || !Array.isArray(e.input) || !e.input.length) fail('A real action with valid input timing is required.');
      let at=e.actionStartMs;
      for (const input of e.input) {
        if (!['pointerdown','keydown','input'].includes(input.type) || input.withinTarget!==true || !finite(input.atMs) || input.atMs<at || input.atMs>e.actionEndMs) fail('Invalid real-input evidence or input outside its action.');
        at=input.atMs;
      }
      actions.push(e);
    } else if (e.kind==='step' && e.input?.length) fail('Input without an action boundary.');
    if (e.kind==='observation') {
      const validExpected=e.read==='count' ? Number.isInteger(e.expected)&&e.expected>=0 : ['text','value'].includes(e.read)&&typeof e.expected==='string';
      if (!validExpected || e.pass!==true || !same(e.expected,e.observed) || !same(e.expected,e.observedAfterHold) || e.outcome!==(side==='before'?'problem':'fixed')) fail('Failed or malformed product observation.');
    }
  }
  if (!actions.length || receipt.actionCount!==actions.length) fail('Every film needs at least one real action and a matching action count.');
  if (events.at(-1)?.kind!=='observation') fail('A matching terminal observation is required.');
  const terminal=events.at(-1);
  if (terminal.endMs-terminal.startMs<4000) fail('The terminal observation needs at least 4 seconds of verified source frames.');
  return {receipt,events,actions,terminal};
}

export function planFilm(beforeReceipt, afterReceipt, media) {
  const sides=['before','after'].map((side,i)=>validate(i?afterReceipt:beforeReceipt,side,media[side]));
  if (beforeReceipt.title!==afterReceipt.title || beforeReceipt.goal!==afterReceipt.goal || beforeReceipt.scenario.sha256!==afterReceipt.scenario.sha256) fail('Before/after title, goal or scenario identity differs.');
  const signature=s=>s.actions.map(e=>({target:e.target,caption:e.caption}));
  if (!same(signature(sides[0]),signature(sides[1]))) fail('Before/after action sequences differ. Use the same actions and captions on both sides.');
  const planned=sides.map((s,index)=>{
    const first=s.actions[0],firstInput=first.input[0].atMs/1000;
    // AFTER skips repeated setup, but retains every actual action and~1.1s anticipation.
    const start=index ? Math.max(s.events[0].startMs/1000,Math.min(first.actionStartMs/1000,firstInput-1.1)) : s.events[0].startMs/1000;
    const end=s.terminal.endMs/1000;
    const retained=s.events.filter(e=>e.endMs/1000>=start);
    const cues=[]; let lastAction=null;
    for (const event of retained) {
      if (event.kind==='step' && event.actionStartMs!==undefined) lastAction=event;
      const b=event.kind==='observation'&&lastAction ? union(event.bounds,lastAction.bounds) : event.bounds;
      cues.push({kind:event.kind,caption:event.caption,at:Math.max(0,event.startMs/1000-start),...cameraFor(b)});
    }
    return {side:index?'after':'before',start,end,duration:end-start,cues,
      inputs:s.actions.map(e=>e.input[0].atMs/1000-start),
      actions:s.actions.map(e=>({target:e.target,caption:e.caption,start:e.actionStartMs/1000-start,end:e.actionEndMs/1000-start,inputTimes:e.input.map(i=>i.atMs/1000-start)})),
      terminalAt:s.terminal.startMs/1000-start};
  });
  const duration=planned.reduce((sum,s)=>sum+s.duration,TRANSITION);
  if (duration>25) fail(`This story needs ${duration.toFixed(1)} seconds (before ${planned[0].duration.toFixed(1)} s, after ${planned[1].duration.toFixed(1)} s); the film limit is 25 seconds. Author one smaller scenario or split it into separate comparisons. No actions were dropped or accelerated.`);
  return {title:beforeReceipt.title,goal:beforeReceipt.goal,transition:TRANSITION,duration,sides:planned};
}

async function contained(root, file) {
  const actual=await realpath(file);
  if (!actual.startsWith(root+path.sep)) fail('Recording input escapes its directory through a symlink.');
  return actual;
}

export async function composeFilm(recordingDir,{maxBytes=10_000_000}={}) {
  if (!finite(maxBytes)||maxBytes<=0) fail('Film size limit must be positive.');
  const directory=await realpath(recordingDir);
  for (const file of ['film.mp4','film.jpg','film.json']) if (await exists(path.join(directory,file))) fail('Refusing to overwrite an existing film. Choose a new recording directory.');
  const marker=await open(path.join(directory,'film.json'),'wx'); await marker.close();
  let temporary;
  try {
    const receipts={},media={},sources={};
    for (const side of ['before','after']) {
      const receiptPath=await contained(directory,path.join(directory,side,'receipt.json'));
      const videoPath=await contained(directory,path.join(directory,side,'reel.mp4'));
      receipts[side]=JSON.parse(await readFile(receiptPath,'utf8'));
      const sha256=await fileHash(videoPath);
      if (sha256!==receipts[side].export?.sha256) fail(`${side}: MP4 SHA256 does not match its receipt.`);
      media[side]=await inspectVideo(videoPath);
      sources[side]={file:`${side}/reel.mp4`,sha256,receiptSha256:await fileHash(receiptPath)};
    }
    const story=planFilm(receipts.before,receipts.after,media);
    await checkMediaTools();
    temporary=await mkdtemp(path.join(os.tmpdir(),'fixtape-film-'));
    await mkdir(path.join(temporary,'public'));
    await copyFile(path.join(templateDir,'project.tsx'),path.join(temporary,'project.tsx'));
    await writeFile(path.join(temporary,'story.json'),JSON.stringify(story));
    await writeFile(path.join(temporary,'tsconfig.json'),JSON.stringify({compilerOptions:{jsx:'react-jsx',jsxImportSource:'@revideo/2d'}}));
    for (const side of ['before','after']) await copyFile(path.join(directory,side,'reel.mp4'),path.join(temporary,'public',`${side}.mp4`));
    await exec(process.execPath,[path.join(templateDir,'render.mjs')],{cwd:temporary,maxBuffer:2*1024*1024,timeout:180_000});
    const encoded=path.join(temporary,'film.mp4');
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-n','-i',path.join(temporary,'rendered','rendered.mp4'),'-map','0:v:0','-an','-vf','setsar=1','-c:v','libx264','-preset','medium','-b:v','2M','-minrate','2M','-maxrate','2M','-bufsize','4M','-x264-params','nal-hrd=cbr:force-cfr=1','-pix_fmt','yuv420p','-movflags','+faststart',encoded]);
    const info=await inspectVideo(encoded);
    const {stdout: streamJson}=await exec('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate,sample_aspect_ratio,bit_rate','-of','json',encoded]);
    const stream=JSON.parse(streamJson).streams[0];
    if (stream.r_frame_rate!=='30/1'||stream.sample_aspect_ratio!=='1:1'||Number(stream.bit_rate)<192000) fail('Encoded film frame rate, square pixels or measured bitrate failed verification.');
    info.bitrate=Number(stream.bit_rate);
    if (info.codec!=='h264'||info.width!==1280||info.height!==800||info.pixelFormat!=='yuv420p'||info.duration>25.04||Math.abs(info.duration-story.duration)>.08) fail('Encoded film dimensions or duration differ from the planned story.');
    if (info.bytes>maxBytes) fail(`Film is ${(info.bytes/1e6).toFixed(1)} MB, above the ${maxBytes/1e6} MB limit. Use a smaller scenario or increase --max-mb.`);
    const poster=path.join(temporary,'film.jpg');
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-n','-ss',String(Math.max(0,info.duration-2)),'-i',encoded,'-frames:v','1','-q:v','2',poster]);
    for (const side of ['before','after']) {
      if (await fileHash(path.join(directory,side,'reel.mp4'))!==sources[side].sha256 || await fileHash(path.join(directory,side,'receipt.json'))!==sources[side].receiptSha256) fail('Recording sources changed during composition.');
      sources[side].sourceIntervalSeconds={start:story.sides.find(s=>s.side===side).start,end:story.sides.find(s=>s.side===side).end};
    }
    const receipt={schemaVersion:1,status:'complete',title:story.title,goal:story.goal,
      export:{file:'film.mp4',poster:'film.jpg',...info,frameRate:'30/1',sampleAspectRatio:'1:1',sha256:await fileHash(encoded)},sources,
      composition:{renderer:'Revideo 0.11.0',playbackSpeed:1,transitionSeconds:TRANSITION,captionFontPx:36,sides:story.sides},
      timingNote:'Receipt timestamps are approximate video offsets. The original source intervals play continuously at 1x; camera and input pulses follow those measured offsets. Review the saved player for visual timing.'};
    await copyFile(encoded,path.join(directory,'film.mp4'),constants.COPYFILE_EXCL);
    await copyFile(poster,path.join(directory,'film.jpg'),constants.COPYFILE_EXCL);
    await writeFile(path.join(directory,'film.json'),JSON.stringify(receipt,null,2)+'\n');
    return receipt;
  } catch (error) {
    await writeFile(path.join(directory,'film.json'),JSON.stringify({schemaVersion:1,status:'failed',error:error.message.split('\n')[0].replaceAll(directory,'<recording>').replaceAll(templateDir,'<runtime>/').replaceAll(temporary||'\0','<render>')},null,2)+'\n');
    throw error;
  } finally { if (temporary) await rm(temporary,{recursive:true,force:true}); }
}
