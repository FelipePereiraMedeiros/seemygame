// Explicit diagnostic benchmark, not part of normal unit runs. Reuses production conversion/encode.
#[test]
#[ignore = "hardware cadence benchmark; run alone with --ignored --nocapture"]
fn benchmark_native_encoder_cadence() {
    use gstreamer::prelude::*;
    use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
    use std::time::Instant;
    let _gpu_lock = TEST_GPU_MUTEX.lock().unwrap();
    let runtime = GStreamerRuntime::discover().expect("GStreamer runtime required");
    runtime.prepare_process_environment();
    gstreamer::init().unwrap();
    let caps = runtime.probe();
    let seconds = env::var("SMG_PROBE_SECONDS").ok().and_then(|s|s.parse::<u64>().ok()).unwrap_or(4).clamp(3,30);
    let width = env::var("SMG_PROBE_WIDTH").ok().and_then(|s|s.parse::<u32>().ok()).unwrap_or(1280).clamp(320,1920)&!1;
    let height = env::var("SMG_PROBE_HEIGHT").ok().and_then(|s|s.parse::<u32>().ok()).unwrap_or(720).clamp(240,1080)&!1;
    let mut delivered = 0;
    for (backend,available) in [(H264EncoderBackend::Nvenc,caps.nvenc_h264_available),(H264EncoderBackend::MediaFoundation,caps.h264_available),(H264EncoderBackend::Cpu,caps.x264_available)] {
        for fps in [60u32,120] {
            if !available {
                println!("SMG_CADENCE {}",serde_json::json!({"backend":backend.as_str(),"fps":fps,"status":"unsupported"}));
                continue;
            }
            let mut test_source = source("window");test_source.width=width;test_source.height=height;
            let config = MediaWorkerConfig { h264_encoder:backend,fps,width:Some(width),height:Some(height),bitrate_kbps:9000,..Default::default() };
            let args = build_pipeline(&test_source,&config,5000,None).unwrap();
            let begin = args.iter().position(|s|s.starts_with("video/x-raw(")).unwrap();
            let end = args.iter().position(|s|s=="udpsink").unwrap()-1;
            let mut chain = Vec::new();let mut queues=0;
            for arg in &args[begin..end] {
                chain.push(arg.clone());
                let name=match arg.as_str() {
                    "videorate"=>Some("probe-rate"),"d3d11convert"=>Some("probe-convert"),
                    "nvd3d11h264enc"|"mfh264enc"|"x264enc"=>Some("probe-encoder"),
                    "queue"=>{queues+=1;Some(if queues==1{"probe-input-queue"}else{"probe-encode-queue"})},_=>None
                };
                if let Some(name)=name {chain.push(format!("name={name}"));}
            }
            let description=format!("videotestsrc is-live=true pattern=ball num-buffers={} ! video/x-raw,format=BGRA,width={width},height={height},framerate={fps}/1 ! d3d11upload name=probe-upload ! {} ! fakesink sync=false",fps as u64*seconds,chain.join(" "));
            let pipeline=gstreamer::parse::launch(&description).unwrap().downcast::<gstreamer::Pipeline>().unwrap();
            let counters=Arc::new([AtomicU64::new(0),AtomicU64::new(0),AtomicU64::new(0),AtomicU64::new(0),AtomicU64::new(0)]);
            let encode_times=attach_probe_encoder_timing(&pipeline,"probe-encoder");
            for (index,(name,pad_name)) in [("probe-upload","src"),("probe-rate","src"),("probe-convert","src"),("probe-encoder","sink"),("probe-encoder","src")].iter().enumerate() {
                let count=counters.clone();
                pipeline.by_name(name).unwrap().static_pad(pad_name).unwrap().add_probe(gstreamer::PadProbeType::BUFFER,move|_,info|{
                    if let Some(buffer)=info.buffer() {
                        if buffer.pts().is_some() {
                            count[index].fetch_add(1,Ordering::Relaxed);
                        }
                    }
                    gstreamer::PadProbeReturn::Ok
                });
            }
            let result=(||->Result<serde_json::Value,String>{
                pipeline.set_state(gstreamer::State::Playing).map_err(|e|format!("{e:?}"))?;
                std::thread::sleep(Duration::from_secs(1));
                let baseline=counters.each_ref().map(|c|c.load(Ordering::Relaxed));
                encode_times.lock().unwrap().samples_ms.clear();
                let started=Instant::now();
                let bus=pipeline.bus().unwrap();
                let mut max_queue_ms=0.0f64;
                let message=loop {
                    if let Some(message)=bus.timed_pop_filtered(gstreamer::ClockTime::from_mseconds(200),&[gstreamer::MessageType::Eos,gstreamer::MessageType::Error]) {break message;}
                    for name in ["probe-input-queue","probe-encode-queue"] {max_queue_ms=max_queue_ms.max(pipeline.by_name(name).unwrap().property::<u64>("current-level-time") as f64/1e6);}
                    if started.elapsed().as_secs()>seconds+10 {return Err("pipeline timeout".into());}
                };
                if let gstreamer::MessageView::Error(error)=message.view(){return Err(format!("{}: {:?}",error.error(),error.debug()));}
                let elapsed=started.elapsed().as_secs_f64();
                let rates=counters.each_ref().map(|c|c.load(Ordering::Relaxed)).into_iter().zip(baseline).map(|(a,b)|(a-b) as f64/elapsed).collect::<Vec<_>>();
                if rates[4]<=0.0 { return Err("no timestamped encoded frames".into()); }
                let mut times=encode_times.lock().unwrap().samples_ms.clone();times.sort_by(f64::total_cmp);
                let p=|q:f64| if times.is_empty(){None}else{Some(times[((times.len() as f64*q).ceil() as usize).saturating_sub(1)])};
                let rate=pipeline.by_name("probe-rate").unwrap();
                Ok(serde_json::json!({"status":"delivered","backend":backend.as_str(),"fps":fps,"width":width,"height":height,"steadySeconds":elapsed,
                    "uploadedFps":rates[0],"ratedFps":rates[1],"convertedFps":rates[2],"encoderInputFps":rates[3],"encodedFps":rates[4],
                    "videorateDrop":rate.property::<u64>("drop"),"videorateDuplicate":rate.property::<u64>("duplicate"),"maxObservedQueueMs":max_queue_ms,
                    "encoderSegmentWallP50Ms":p(0.5),"encoderSegmentWallP95Ms":p(0.95),"encoderTimingSamples":times.len(),
                    "cadenceTargetMet":rates[4]>=fps as f64*0.9,
                    "conditions":"short synthetic moving ball + GPU upload; no WGC, network, audio, replay or physical presentation; pad timing is wall time, not GPU-only duration"}))
            })();
            let _=pipeline.set_state(gstreamer::State::Null);
            match result {Ok(row)=>{delivered+=1;println!("SMG_CADENCE {row}");},Err(error)=>println!("SMG_CADENCE {}",serde_json::json!({"status":"failed","backend":backend.as_str(),"fps":fps,"error":error}))}
        }
    }
    assert!(delivered>0,"no encoder delivered frames");
}
