// Raw window capture diagnostic; no WebRTC encoding, audio or replay.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startAssetServer} from './harness/server.mjs';
import {createMotionFixture} from './fixtures/motion.mjs';
import {ensureDefaultDesktop} from './desktop-affinity.mjs';
import {calibrateCaptureWindow} from './harness/capture-geometry.mjs';
ensureDefaultDesktop();
const root=fileURLToPath(new URL('../../',import.meta.url));
const id=new Date().toISOString().replace(/[:.]/g,'-'),out=path.join(root,'output/playwright','capture-geometry-'+id);
await mkdir(out,{recursive:true});
const report={status:'running',runs:[],scope:'Raw getDisplayMedia before any WebRTC encoder'};
const backgroundArgs=['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion'];
let server,sourceBrowser,captureBrowser;
try{
 for(const [width,height] of [[1280,720],[1920,1080]])for(const mode of ['legacy','physical']){
  const title=`SMG E2E Motion geometry ${id} ${width} ${mode}`;
  server=await startAssetServer({root,fixtures:{'/fixtures/motion.html':createMotionFixture(title,42,60,{width,height}),'/fixtures/capture.html':'<button id="capture">Capture</button><video muted autoplay></video>'}});
  sourceBrowser=await chromium.launch({channel:'chrome',headless:false,timeout:30000,args:[...backgroundArgs,`--window-size=${width},${height}`,'--window-position=30,30']});
  const sourceContext=await sourceBrowser.newContext({viewport:mode==='legacy'?{width,height}:null});
  const source=await sourceContext.newPage();await source.goto(server.origin+'/fixtures/motion.html');
  const cdp=await sourceContext.newCDPSession(source),window=await cdp.send('Browser.getWindowForTarget');
  const calibration=mode==='physical'?await calibrateCaptureWindow({source,title,width,height,root}):null;
  await source.bringToFront();
  const geometry=await source.evaluate(()=>({innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio,screen:{width:screen.width,height:screen.height},canvas:{width:document.querySelector('canvas').width,height:document.querySelector('canvas').height}}));
  captureBrowser=await chromium.launch({channel:'chrome',headless:false,timeout:30000,args:[...backgroundArgs,`--auto-select-desktop-capture-source=${title}`,'--enable-usermedia-screen-capturing','--allow-http-screen-capture','--autoplay-policy=no-user-gesture-required']});
  const context=await captureBrowser.newContext(),page=await context.newPage();await page.goto(server.origin+'/fixtures/capture.html');
  await page.evaluate(({width,height})=>{
   document.querySelector('#capture').onclick=async()=>{
    try{window.stream=await navigator.mediaDevices.getDisplayMedia({audio:false,video:{width:{ideal:width,max:width},height:{ideal:height,max:height},frameRate:{ideal:60,max:60}}});document.querySelector('video').srcObject=stream;}
    catch(e){window.captureError=e.message;}
   };
  },{width,height});
  await page.locator('#capture').click();await page.waitForFunction(()=>window.captureError||document.querySelector('video').videoWidth>0,null,{timeout:15000});
  await source.bringToFront();await page.waitForTimeout(2000);
  const capture=await page.evaluate(()=>{const t=window.stream?.getVideoTracks()[0],v=document.querySelector('video');return {error:window.captureError,settings:t?.getSettings(),capabilities:t?.getCapabilities(),rawVideo:{width:v.videoWidth,height:v.videoHeight}};});
  const row={width,height,mode,calibration,geometry,bounds:(await cdp.send('Browser.getWindowForTarget')).bounds,capture};report.runs.push(row);console.log(JSON.stringify(row));
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
  if(capture.error||(mode==='physical'&&(capture.rawVideo.width!==width||capture.rawVideo.height!==height)))throw new Error('Fresh raw capture did not match calibrated target');
  await page.evaluate(()=>window.stream?.getTracks().forEach(t=>t.stop()));
  await captureBrowser.close();captureBrowser=null;await sourceBrowser.close();sourceBrowser=null;await server.close();server=null;
 }
 report.status='passed';
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;}
finally{await captureBrowser?.close();await sourceBrowser?.close();await server?.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('Capture geometry '+report.status+': '+out);}
