import {MagneticVisualizer} from './space/src/visualizer.js';
import {Starfield} from './space/src/starfield.js';
import {AudioInput} from './space/src/audio.js';
const fluid=new MagneticVisualizer(document.getElementById('fluid'));
const stars=new Starfield(document.getElementById('stars'));
const input=new AudioInput(()=>{},()=>{});
window.sourceVisual={
  set(section,key,value) { (section==='visual'?fluid:section==='audio'?input:stars).setParameter(key,value); },
  rotate(deltaX,deltaY) {
    const p=fluid.getParameters();
    fluid.setParameter('angleY',Math.max(-45,Math.min(45,(Number(p.angleY)||0)-deltaX*0.12)));
    fluid.setParameter('angleX',Math.max(-45,Math.min(45,(Number(p.angleX)||0)-deltaY*0.12)));
  },
  pointer(type,event) { if(type==='leave')fluid.onPointerLeave(event);else if(type==='down')fluid.onPointerDown(event);else fluid.onPointerMove(event); },
  apply(value) {
    for(const [key,v] of Object.entries(value.visual||{})) fluid.setParameter(key,v);
    for(const [key,v] of Object.entries(value.starfield||{})) stars.setParameter(key,v);
    for(const [key,v] of Object.entries(value.audio||{})) input.setParameter(key,v);
  },
  snapshot:()=>({visual:fluid.getParameters(),audio:input.getParameters(),starfield:stars.getParameters()}),
  audio(frame) {
    const data=frame.frequencyData||[];
    const sampleBand=(from,to)=>{
      const lo=Math.max(0,Math.floor(from*frame.fftSize/frame.sampleRate));
      const hi=Math.min(data.length,Math.ceil(to*frame.fftSize/frame.sampleRate));
      let sum=0;for(let i=lo;i<hi;i++)sum+=data[i]||0;
      return frame.playing?sum/Math.max(1,hi-lo)/255:0;
    };
    const p=input.getParameters(),split=p.bassFrom+(p.bassTo-p.bassFrom)*.34;
    const maxHz=Math.min(20000,frame.sampleRate/2);
    const spectrum=Array.from({length:16},(_,i)=>sampleBand(20*Math.pow(maxHz/20,i/16),20*Math.pow(maxHz/20,(i+1)/16)));
    const metrics={bass:sampleBand(p.bassFrom,split)*.62+sampleBand(split,p.bassTo)*.38,mid:sampleBand(p.midFrom,p.midTo),level:frame.level||0,hasAudio:!!frame.playing&&((frame.level||0)>p.signalThreshold||spectrum.some(v=>v>p.signalThreshold*4.8)),spectrum,sampleBand};
    fluid.setMetrics(metrics);stars.setAudioMetrics(metrics);
  }
};
parent.dispatchEvent(new CustomEvent('source-visual-ready',{detail:'space'}));
