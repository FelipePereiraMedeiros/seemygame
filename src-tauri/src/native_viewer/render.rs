//! render; internal to the native native_viewer subsystem.
use super::*;

pub(crate) fn handle_incoming_stream_pad(
    pipeline: &gst::Pipeline,
    pad: &gst::Pad,
    window_handle: Option<usize>,
) -> Result<(), String> {
    let caps = pad
        .current_caps()
        .or_else(|| Some(pad.query_caps(None)))
        .ok_or_else(|| "Pad recebido sem caps definidas".to_string())?;
    let structure = caps
        .structure(0)
        .ok_or_else(|| "Estrutura de caps inválida no pad recebido".to_string())?;
    let media = structure.get::<&str>("media").unwrap_or_default();

    if media == "video" {
        #[cfg(not(test))]
        crate::system::write_debug_log(
            "[NativeViewer] Conectando branch de vídeo Direct3D 11 nativo com Zero-Copy...",
        );

        let depay = gst::ElementFactory::make("rtph264depay")
            .build()
            .map_err(|e| format!("Falha ao criar rtph264depay: {e}"))?;
        let parse = gst::ElementFactory::make("h264parse")
            .build()
            .map_err(|e| format!("Falha ao criar h264parse: {e}"))?;

        // Tenta selecionar decodificador Direct3D 11 de hardware na GPU; se indisponível, usa fallback CPU
        let decoder = gst::ElementFactory::make("d3d11h264dec")
            .build()
            .or_else(|_| gst::ElementFactory::make("openh264dec").build())
            .map_err(|e| format!("Falha ao instanciar decodificador H.264: {e}"))?;

        let queue = gst::ElementFactory::make("queue")
            .build()
            .map_err(|e| format!("Falha ao criar queue de vídeo: {e}"))?;
        queue.set_property("max-size-buffers", 1u32);
        queue.set_property_from_str("leaky", "downstream");

        // Sink de vídeo: d3d11videosink para renderização direta em SwapChain DXGI do Windows
        let sink = gst::ElementFactory::make("d3d11videosink")
            .build()
            .or_else(|_| gst::ElementFactory::make("autovideosink").build())
            .map_err(|e| format!("Falha ao instanciar sink de vídeo nativo: {e}"))?;

        sink.set_property("sync", false);

        // Se houver um HWND nativo especificado, acopla o sink à janela Win32
        if let Some(hwnd) = window_handle {
            if let Ok(overlay) = sink.clone().dynamic_cast::<gstreamer_video::VideoOverlay>() {
                unsafe {
                    overlay.set_window_handle(hwnd);
                }
            }
        }

        pipeline
            .add_many([&depay, &parse, &decoder, &queue, &sink])
            .map_err(|e| format!("Falha ao adicionar elementos de vídeo ao pipeline: {e}"))?;

        depay.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        parse.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        decoder
            .sync_state_with_parent()
            .map_err(|e| format!("{e}"))?;
        queue.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        sink.sync_state_with_parent().map_err(|e| format!("{e}"))?;

        gst::Element::link_many([&depay, &parse, &decoder, &queue, &sink])
            .map_err(|e| format!("Falha ao interligar elementos de vídeo: {e}"))?;

        let sink_pad = depay
            .static_pad("sink")
            .ok_or_else(|| "rtph264depay sem sink pad".to_string())?;
        pad.link(&sink_pad)
            .map_err(|e| format!("Falha ao ligar pad de vídeo ao depayloader: {e}"))?;
    } else if media == "audio" {
        #[cfg(not(test))]
        crate::system::write_debug_log(
            "[NativeViewer] Conectando branch de áudio WASAPI nativo com modo low-latency...",
        );

        let depay = gst::ElementFactory::make("rtpopusdepay")
            .build()
            .map_err(|e| format!("Falha ao criar rtpopusdepay: {e}"))?;
        let decoder = gst::ElementFactory::make("opusdec")
            .build()
            .map_err(|e| format!("Falha ao criar opusdec: {e}"))?;
        let convert = gst::ElementFactory::make("audioconvert")
            .build()
            .map_err(|e| format!("Falha ao criar audioconvert: {e}"))?;
        let resample = gst::ElementFactory::make("audioresample")
            .build()
            .map_err(|e| format!("Falha ao criar audioresample: {e}"))?;

        let sink = gst::ElementFactory::make("wasapisink")
            .build()
            .or_else(|_| gst::ElementFactory::make("autoaudiosink").build())
            .map_err(|e| format!("Falha ao criar sink de áudio: {e}"))?;

        sink.set_property("sync", false);
        if sink.has_property("low-latency") {
            sink.set_property("low-latency", true);
        }
        if sink.has_property("use-audioclient3") {
            sink.set_property("use-audioclient3", true);
        }

        pipeline
            .add_many([&depay, &decoder, &convert, &resample, &sink])
            .map_err(|e| format!("Falha ao adicionar elementos de áudio ao pipeline: {e}"))?;

        depay.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        decoder
            .sync_state_with_parent()
            .map_err(|e| format!("{e}"))?;
        convert
            .sync_state_with_parent()
            .map_err(|e| format!("{e}"))?;
        resample
            .sync_state_with_parent()
            .map_err(|e| format!("{e}"))?;
        sink.sync_state_with_parent().map_err(|e| format!("{e}"))?;

        gst::Element::link_many([&depay, &decoder, &convert, &resample, &sink])
            .map_err(|e| format!("Falha ao interligar elementos de áudio: {e}"))?;

        let sink_pad = depay
            .static_pad("sink")
            .ok_or_else(|| "rtpopusdepay sem sink pad".to_string())?;
        pad.link(&sink_pad)
            .map_err(|e| format!("Falha ao ligar pad de áudio ao depayloader: {e}"))?;
    }

    Ok(())
}
