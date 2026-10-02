//! Safe scalar statistics only. Never serialize ICE candidates, addresses or SDP.
use super::*;

const FIELDS: &[&str] = &[
    "codec-id", "transport-id", "local-id", "remote-id", "selected-candidate-pair-id",
    "mime-type", "sdp-fmtp-line", "kind", "ssrc", "state", "nominated",
    "bytes-sent", "bytes-received", "packets-sent", "packets-received", "packets-lost",
    "frames-encoded", "frames-decoded", "frames-per-second", "frame-width", "frame-height",
    "total-encode-time", "total-decode-time", "jitter", "jitter-buffer-delay",
    "jitter-buffer-emitted-count", "current-round-trip-time", "round-trip-time",
    "fraction-lost", "available-outgoing-bitrate", "nack-count", "pli-count",
];

fn camel(key: &str) -> String {
    let mut upper = false;
    key.chars().filter_map(|c| {
        if c == '-' { upper = true; None } else if upper { upper = false; Some(c.to_ascii_uppercase()) } else { Some(c) }
    }).collect()
}

pub(crate) fn normalize(report: &gst::StructureRef) -> serde_json::Value {
    let mut result = serde_json::Map::new();
    if let Ok(id) = report.get::<String>("id") { result.insert("id".into(), id.into()); }
    if let Ok(kind) = report.get::<gst_webrtc::WebRTCStatsType>("type") {
        let name = match kind {
            gst_webrtc::WebRTCStatsType::Codec => "codec",
            gst_webrtc::WebRTCStatsType::InboundRtp => "inbound-rtp",
            gst_webrtc::WebRTCStatsType::OutboundRtp => "outbound-rtp",
            gst_webrtc::WebRTCStatsType::RemoteInboundRtp => "remote-inbound-rtp",
            gst_webrtc::WebRTCStatsType::CandidatePair => "candidate-pair",
            gst_webrtc::WebRTCStatsType::Transport => "transport",
            _ => "other",
        };
        result.insert("type".into(), name.into());
    }
    for &key in FIELDS {
        let value = if let Ok(v) = report.get::<f64>(key) { serde_json::Number::from_f64(v).map(serde_json::Value::Number) }
        else if let Ok(v) = report.get::<u64>(key) { Some(v.into()) }
        else if let Ok(v) = report.get::<u32>(key) { Some(v.into()) }
        else if let Ok(v) = report.get::<i64>(key) { Some(v.into()) }
        else if let Ok(v) = report.get::<i32>(key) { Some(v.into()) }
        else if let Ok(v) = report.get::<bool>(key) { Some(v.into()) }
        else if let Ok(v) = report.get::<String>(key) { Some(v.into()) }
        else { None };
        if let Some(value) = value { result.insert(camel(key), value); }
    }
    result.into()
}

pub(crate) fn collect(webrtc: &gst::Element) -> Result<Vec<serde_json::Value>, String> {
    let promise = gst::Promise::new();
    webrtc.emit_by_name::<()>("get-stats", &[&None::<gst::Pad>, &promise]);
    wait_promise(&promise, "telemetria WebRTC")?;
    let reply = promise.get_reply().ok_or("Telemetria nativa sem resposta")?;
    Ok(reply.iter().filter_map(|(_, value)| value.get::<gst::Structure>().ok()).map(|s| normalize(&s)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stats_export_is_allowlisted_and_preserves_units() {
        let runtime = GStreamerRuntime::discover().expect("runtime empacotado de teste");
        initialize_gstreamer(&runtime).unwrap();
        let report = gst::Structure::builder("outbound")
            .field("id", "rtp-1").field("type", gst_webrtc::WebRTCStatsType::OutboundRtp)
            .field("bytes-sent", 4000u64).field("round-trip-time", 0.025f64)
            .field("ip", "secret").field("candidate", "secret").build();
        let output = normalize(&report);
        assert_eq!(output["type"], "outbound-rtp");
        assert_eq!(output["bytesSent"], 4000);
        assert_eq!(output["roundTripTime"], 0.025);
        assert!(output.get("ip").is_none());
        assert!(output.get("candidate").is_none());
    }
}
