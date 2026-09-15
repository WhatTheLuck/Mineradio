'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {VisualPresetStore}=require('../desktop/visual-preset-store');
const catalog=require('../public/vendor/source-visuals/catalog.json');
test('source presets retain ribbon and independent starfield calibration',()=>{
 const cyber=catalog.cyber.find(p=>p.name==='4').value;
 assert.equal(cyber.ribbon.ribbonLength,175);
 assert.equal(cyber.ribbon.audioMotionThreshold,2.24);
 const star=catalog.stars.find(p=>p.name==='Star').value.starfield;
 assert.equal(star.density,840);assert.equal(star.bassFrom,25);assert.equal(star.bassTo,400);
 assert.equal(catalog.space.length,16);
 for(const preset of catalog.space){assert.ok(preset.value.visual);assert.ok(preset.value.audio);}
});

test('external visual controls use sibling motion groups and magnetic fluid supports wheel scaling',()=>{
 const workspace=fs.readFileSync(path.join(__dirname,'..','public','js','modules','07-fx','09-console-workspace.js'),'utf8');
 const moduleSource=fs.readFileSync(path.join(__dirname,'..','public','js','modules','02-visual','16-cyber-space-presets.js'),'utf8');
 assert.doesNotMatch(workspace,/key: 'cyber', label: '赛博丝带'/);
 assert.doesNotMatch(workspace,/key: 'space', label: '星际磁流体'/);
 assert.match(workspace,/key: 'motion'[\s\S]*key: 'base'[\s\S]*key: 'cyber-ribbon'[\s\S]*key: 'space-fluid'/);
 assert.match(workspace,/external-cyber-controls/);
 assert.match(workspace,/external-space-controls/);
 assert.match(moduleSource,/addEventListener\('wheel'/);
 assert.match(moduleSource,/visual\.cameraDistance/);
});
test('external visual controls omit preview buttons and auto-load each latest saved preset',()=>{
 const moduleSource=fs.readFileSync(path.join(__dirname,'..','public','js','modules','02-visual','16-cyber-space-presets.js'),'utf8');
 assert.match(moduleSource,/丝带参数/);
 assert.match(moduleSource,/磁流体参数/);
 assert.match(moduleSource,/彩带预设/);
 assert.match(moduleSource,/保存当前参数的名称/);
 assert.doesNotMatch(moduleSource,/加载所选参数/);
 assert.doesNotMatch(moduleSource,/data-preview/);
 assert.match(moduleSource,/\[data-saved\]'.*onchange/);
 assert.match(moduleSource,/values\.space\.starfield=clone\(\(data\.stars\.find/);
 assert.match(moduleSource,/list\(kind,true\)/);
 assert.match(moduleSource,/select\.value=result\.items\[0\]\.name;await load\(kind\)/);
 assert.match(moduleSource,/已自动加载最新参数/);
});
test('external visual audio and drag bridges survive player lifecycle changes',()=>{
 const moduleSource=fs.readFileSync(path.join(__dirname,'..','public','js','modules','02-visual','16-cyber-space-presets.js'),'utf8');
 const graphSource=fs.readFileSync(path.join(__dirname,'..','public','js','modules','05-playback','08-audio-graph-controls.js'),'utf8');
 const pointerSource=fs.readFileSync(path.join(__dirname,'..','public','js','modules','02-visual','00-pointer-cover-particles.js'),'utf8');
 const cyberBridge=fs.readFileSync(path.join(__dirname,'..','public','vendor','source-visuals','cyber-bridge.js'),'utf8');
 const spaceBridge=fs.readFileSync(path.join(__dirname,'..','public','vendor','source-visuals','space-bridge.js'),'utf8');
 assert.match(moduleSource,/invalidateAudioSource/);
 assert.match(graphSource,/MineradioExternalVisuals\.invalidateAudioSource\(\)/);
 assert.match(pointerSource,/MineradioExternalVisuals\.rotate\(dx, dy\)/);
 assert.match(cyberBridge,/rotate: \(deltaX, deltaY\)/);
 assert.match(spaceBridge,/rotate\(deltaX,deltaY\)/);
});
test('visual files are isolated by kind, survive restart, sort latest first, and reject traversal',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mineradio-visual-'));
 try{
 const store=new VisualPresetStore(root);
 const first=store.save('cyber','first',{ribbon:{ribbonLength:175}});
 fs.utimesSync(path.join(store.folder('cyber'),first.name),new Date(1000),new Date(1000));
 const last=store.save('cyber','latest',{ribbon:{ribbonLength:250}});
 store.save('space','fluid',{visual:{sphereCount:20}});
 const restored=new VisualPresetStore(root);
 assert.equal(restored.list('cyber')[0].name,last.name);
 assert.equal(restored.read('cyber',last.name).ribbon.ribbonLength,250);
 assert.equal(restored.list('space').length,1);
 assert.throws(()=>store.read('cyber','../package.json'));
 assert.throws(()=>store.list('../'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
