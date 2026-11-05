import test from 'node:test';
import assert from 'node:assert/strict';
import {lavfiCapability,repairFormatReader} from '../skills/fixtape/lib/revideo/compat.mjs';

test('FFmpeg capability compatibility accepts two-column and device-column outputs',()=>{
  for (const line of [' D  lavfi           Libavfilter virtual input device',' D d lavfi           Libavfilter virtual input device']) {
    assert.deepEqual(lavfiCapability(line),{description:'Libavfilter virtual input device',canDemux:true,canMux:false});
  }
  assert.equal(lavfiCapability(' DE matroska Matroska'),null);
});
test('compatibility repairs only a verified missing capability and preserves errors',()=>{
  function Fluent(){};
  Fluent.prototype.availableFormats=function(callback){callback(null,{mp4:{canMux:true}});};
  repairFormatReader(Fluent,lavfiCapability(' D d lavfi Input'));
  new Fluent().availableFormats((error,formats)=>{assert.equal(error,null);assert.equal(formats.mp4.canMux,true);assert.equal(formats.lavfi.canDemux,true);});
  function Failed(){}; const failure=new Error('probe failed');
  Failed.prototype.availableFormats=function(callback){callback(failure);};
  repairFormatReader(Failed,lavfiCapability(' D d lavfi Input'));
  new Failed().availableFormats(error=>assert.equal(error,failure));
  assert.throws(()=>repairFormatReader(Fluent,null),/does not advertise/);
});
