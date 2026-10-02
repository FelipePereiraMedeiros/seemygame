import { AdaptiveBitrateController } from '../abr.js';
import { updateSenderBitrate } from '../webrtc/sender.js';
/** Conservative browser cap adaptation. Browser congestion control and RTP pacing remain authoritative. */
export function createQualityController(pc,getSettings) {
 let stopped=false,lastChange=-Infinity,pending=Promise.resolve();
 const controller=new AdaptiveBitrateController({targetBitrateBps:getSettings().bitrateKbps*1000,onBitrateChange:bps=>{
  pending=pending.catch(()=>{}).then(async()=>{if(!stopped)await updateSenderBitrate(pc,bps);});
 }});
 return {
  process(sample) {
   if(stopped)return;
   const settings=getSettings(),target=settings.bitrateKbps*1000,now=sample.timestamp;
   controller.setTargetBitrate(target);
   const enabled=typeof document==='undefined'||document.getElementById('abr-toggle-btn')?.getAttribute('aria-pressed')!=='false';
   if(controller.isEnabled!==enabled)controller.setEnabled(enabled);
   if(!enabled||!Number.isFinite(now)||now-lastChange<3000)return;
   const before=controller.currentBitrateBps;
   controller.processSample({...sample,targetFps:settings.fps});
   if(before!==controller.currentBitrateBps)lastChange=now;
  },
  dispose(){stopped=true;return pending;}
 };
}

