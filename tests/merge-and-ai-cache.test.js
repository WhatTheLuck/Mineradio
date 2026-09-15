const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {BuiltInPlaylistLibrary}=require('../desktop/built-in-playlist-library');
const {SmartFavoritesStore}=require('../desktop/smart-favorites-store');
const core=require('../public/js/modules/00-state/12-smart-favorites-state');
const vm=require('vm');

test('changing a tag to required during pending analysis affects the next selection',async()=>{
 let resolveAnalysis,selected;
 const pending=new Promise(resolve=>{resolveAnalysis=resolve;});
 const tags=[{label:'爵士',value:'jazz',state:'neutral'}];
 const sandbox={
  window:{},document:{getElementById:()=>null},setTimeout,clearTimeout,
  playQueue:[{id:'rock',genre:['rock']},{id:'jazz',genre:['jazz']}],currentIdx:-1,playMode:'ai',playToggleBusy:false,
  smartFavoritesState:{tags,history:[]},SMART_FAVORITES_TOP_N:8,
  smartFavoritesAnalysisQueue:[],smartFavoritesAnalysisBusy:true,smartFavoritesAnalysisTimer:0,
  smartTrackKey:t=>t.id,scoreAiCandidate:core.scoreAiCandidate,
  smartAnalysisSignature:()=>JSON.stringify(tags.map(t=>t.value)),
  smartActiveTagContext:()=>({required:tags.filter(t=>t.state==='required').map(t=>t.value),preferred:[]}),
  queueSmartFavoriteAnalysis(){},runSmartFavoriteAnalysisBatch:()=>pending,
  forcePlaybackControlsInteractive(){},showToast(){},
 };
 vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/modules/05-playback/14a-ai-playback.js'),'utf8'),sandbox);
 sandbox.playSmartAiSelection=track=>{selected=track;return true;};
 const next=sandbox.playAiNextTrack(true);
 tags[0].state='required';sandbox.smartFavoritesAnalysisBusy=false;resolveAnalysis();
 assert.equal(await next,true);assert.equal(selected.id,'jazz');
});

test('merged folder is an ordinary persisted playlist retaining provider identity and annotations',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mineradio-merge-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const library=new BuiltInPlaylistLibrary({userDataPath:directory});
 const tracks=core.dedupeSmartFavoriteTracks([
  {provider:'netease',id:'ne1',name:'Blue',artist:'Artist',duration:180,genre:['jazz']},
  {provider:'qq',id:'qq1',mid:'qq1',name:'Blue',artist:'Artist',duration:181,manualTags:['study']},
  {provider:'spotify',id:'sp2',spotifyId:'sp2',name:'Other',artist:'Artist',genre:['rock']}
 ]);
 const result=await library.createMerged('跨平台',tracks);
 assert.equal(result.ok,true);
 const page=new BuiltInPlaylistLibrary({userDataPath:directory}).page(result.playlist.id,{limit:20});
 assert.equal(page.total,2);
 assert.ok(page.tracks.some(t=>t.provider==='spotify'&&t.spotifyId==='sp2'));
 const merged=page.tracks.find(t=>t.name==='Blue');
 assert.equal(merged.sourceVariants.length,2);
 assert.deepEqual(merged.manualTags,['study']);
 assert.deepEqual(merged.genre,['jazz']);
 await assert.rejects(()=>library.createMerged('空',[]));
 assert.equal(library.listSync().count,1);
});

test('LLM caches requested tag semantics across restarts and preserves concurrent user edits',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mineradio-llm-'));
 const oldFetch=global.fetch;let calls=0;
 t.after(()=>{global.fetch=oldFetch;fs.rmSync(directory,{recursive:true,force:true});});
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const store=new SmartFavoritesStore({userDataPath:directory,safeStorage});
 store.configureLlm({apiKey:'test-only',baseUrl:'https://example.invalid/v1',model:'test'});
 global.fetch=async(_url,options)=>{
  calls++;
  const payload=JSON.parse(options.body),user=JSON.parse(payload.messages[1].content);
  assert.ok(user.requestedTags.includes('午后小憩'));
  store.saveState({tags:[{label:'new user edit'}]});
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({results:user.tracks.map(t=>({key:t.key,genres:['jazz'],matches:['午后小憩','not-requested']}))})}}]})};
 };
 const tracks=[{key:'ne:1',title:'Take Five',artist:'Dave Brubeck'}];
 const one=await store.analyzeTracks(tracks,['jazz','午后小憩']);
 assert.equal(one.ok,true);assert.equal(one.results[0].cached,false);
 assert.deepEqual(one.results[0].analysis.matches,['午后小憩']);
 const restored=new SmartFavoritesStore({userDataPath:directory,safeStorage});
 const two=await restored.analyzeTracks(tracks,['午后小憩','jazz']);
 assert.equal(two.results[0].cached,true);assert.equal(calls,1);
 assert.equal(restored.publicState().state.tags[0].label,'new user edit');
 assert.equal(core.scoreAiCandidate({llmTags:two.results[0].analysis},{required:['午后小憩']}).eligible,true);
 await restored.analyzeTracks(tracks,['午后小憩','jazz','work']);
 assert.equal(calls,2,'new keyword invalidates semantic match cache');
});
