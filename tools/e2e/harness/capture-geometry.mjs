import {chromium} from 'playwright';
import {startAssetServer} from './server.mjs';
const backgroundArgs=['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion'];
export function verifyDeliveredResolution(observations,width,height){
 const dimensions=observations.filter(t=>t.phase==='steady').map(t=>t.webInbound).filter(t=>t?.width&&t?.height);
 if(!dimensions.length||dimensions.some(t=>t.width!==width||t.height!==height))throw new Error(`Matched resolution failed: expected ${width}x${height}, observed ${[...new Set(dimensions.map(t=>`${t.width}x${t.height}`))].join(',')||'no steady frames'}`);
 return {passed:true,width,height,samples:dimensions.length};
}
export function windowCorrection(bounds,raw,target,pixelRatio=1){
 if(![bounds.width,bounds.height,raw.width,raw.height,target.width,target.height,pixelRatio].every(n=>Number.isFinite(n)&&n>0))throw new Error('Invalid capture window geometry');
 const width=Math.round(bounds.width+(target.width-raw.width)/pixelRatio),height=Math.round(bounds.height+(target.height-raw.height)/pixelRatio);
 if(width<320||height<240||width>8000||height>5000)throw new Error('Capture window correction exceeds bounds');
 return {width,height};
}
export async function calibrateCaptureWindow({source,title,width,height,root,channel='chrome'}){
 let browser,server;
 const attempts=[];
 try{
  server=await startAssetServer({root,fixtures:{'/fixtures/calibrate.html':'<title>SMG Capture Calibration</title><button id="capture">Capture</button><video muted autoplay></video>'}});
  browser=await chromium.launch({channel,headless:false,timeout:30000,args:[...backgroundArgs,`--auto-select-desktop-capture-source=${title}`,'--enable-usermedia-screen-capturing','--allow-http-screen-capture','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext(),page=await context.newPage();await page.goto(server.origin+'/fixtures/calibrate.html');
  await page.evaluate(({width,height})=>{
   document.getElementById('capture').onclick=async()=>{
    try{window.calibrationStream=await navigator.mediaDevices.getDisplayMedia({audio:false,video:{width:{ideal:width,max:width},height:{ideal:height,max:height},frameRate:{ideal:60,max:60}}});document.querySelector('video').srcObject=window.calibrationStream;}
    catch(e){window.calibrationError=e.message;}
   };
  },{width,height});
  await page.locator('#capture').click();await page.waitForFunction(()=>window.calibrationError||document.querySelector('video').videoWidth>0,null,{timeout:15000});
  const cdp=await source.context().newCDPSession(source);
  for(let i=0;i<4;i++){
   await source.bringToFront();await page.waitForTimeout(650);
   const capture=await page.evaluate(()=>{const v=document.querySelector('video'),t=window.calibrationStream?.getVideoTracks()[0];return {error:window.calibrationError,width:v.videoWidth,height:v.videoHeight,settings:t?.getSettings()};});
   if(capture.error)throw new Error(capture.error);
   const window=await cdp.send('Browser.getWindowForTarget');
   attempts.push({bounds:window.bounds,capture});
   if(capture.width===width&&capture.height===height)return {matched:true,attempts,geometry:await source.evaluate(()=>({innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio}))};
   const corrected=windowCorrection(window.bounds,capture,{width,height},capture.settings?.screenPixelRatio||1);
   await cdp.send('Browser.setWindowBounds',{windowId:window.windowId,bounds:{windowState:'normal',...corrected}});
  }
  throw new Error('Could not calibrate raw window capture to '+width+'x'+height+': '+JSON.stringify(attempts));
 }finally{if(browser?.isConnected())await browser.close();await server?.close();}
}
