const fs=require('fs');
const path=require('path');
class VisualPresetStore {
  constructor(directory){this.directory=path.join(directory,'visual-presets');}
  folder(kind){if(!['cyber','space','emomusic'].includes(kind))throw new Error('无效的预设类型');return path.join(this.directory,kind);}
  list(kind){const dir=this.folder(kind);if(!fs.existsSync(dir))return [];return fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(name=>({name,modified:fs.statSync(path.join(dir,name)).mtimeMs})).sort((a,b)=>b.modified-a.modified||b.name.localeCompare(a.name));}
  read(kind,name){if(typeof name!=='string'||path.basename(name)!==name||!name.endsWith('.json'))throw new Error('无效的预设名称');return JSON.parse(fs.readFileSync(path.join(this.folder(kind),name),'utf8'));}
  save(kind,name,value){const folder=this.folder(kind);const label=String(name||'预设').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,64);const filename=Date.now()+'-'+label+'.json';const json=JSON.stringify(value,null,2);if(json.length>1024*1024)throw new Error('预设过大');fs.mkdirSync(folder,{recursive:true});const target=path.join(folder,filename);fs.writeFileSync(target+'.next',json);fs.renameSync(target+'.next',target);return {name:filename,directory:folder};}
}
module.exports={VisualPresetStore};
