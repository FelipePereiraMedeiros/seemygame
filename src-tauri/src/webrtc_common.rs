//! Shared, bounded GStreamer promise lifetime.
use gstreamer as gst;
use std::{thread, time::Duration};

pub(crate) fn wait_promise(
    promise: &gst::Promise,
    operation: &str,
) -> Result<Option<gst::Structure>, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let promise_for_wait = promise.clone();
    let worker = thread::spawn(move || {
        let result = match promise_for_wait.wait() {
            gst::PromiseResult::Replied => Ok(promise_for_wait.get_reply().map(ToOwned::to_owned)),
            gst::PromiseResult::Interrupted => Err("interrupted".to_string()),
            gst::PromiseResult::Expired => Err("expired".to_string()),
            result => Err(format!("{result:?}")),
        };
        let _ = sender.send(result);
    });

    match receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(reply)) => {
            let _ = worker.join();
            Ok(reply)
        }
        Ok(Err(reason)) => {
            let _ = worker.join();
            Err(format!("webrtcbin falhou ao {operation}: {reason}"))
        }
        Err(_) => {
            // Expirar a promise acorda o waiter e evita uma thread bloqueada
            // caso o elemento nunca responda.
            promise.expire();
            let _ = worker.join();
            Err(format!(
                "Tempo limite ao {operation} na ponte WebRTC nativa"
            ))
        }
    }
}
