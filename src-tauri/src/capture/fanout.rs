//! fanout; internal to the native capture subsystem.
use super::*;

#[cfg(not(test))]
#[derive(Debug)]
pub(crate) struct RtpFanout {
    pub(crate) running: Arc<AtomicBool>,
    pub(crate) video_targets: Arc<Mutex<HashSet<u16>>>,
    pub(crate) audio_targets: Arc<Mutex<HashSet<u16>>>,
    pub(crate) video_thread: Option<JoinHandle<()>>,
    pub(crate) audio_thread: Option<JoinHandle<()>>,
}

#[cfg(not(test))]
impl RtpFanout {
    pub(crate) fn start(video_src_port: u16, audio_src_port: Option<u16>) -> Result<Self, String> {
        let running = Arc::new(AtomicBool::new(true));
        let video_targets = Arc::new(Mutex::new(HashSet::new()));
        let audio_targets = Arc::new(Mutex::new(HashSet::new()));

        let video_socket = UdpSocket::bind(("127.0.0.1", video_src_port)).map_err(|e| {
            format!("Falha ao conectar socket fan-out de vídeo na porta {video_src_port}: {e}")
        })?;
        let video_thread = spawn_fanout_thread(
            "vídeo",
            video_socket,
            Arc::clone(&video_targets),
            Arc::clone(&running),
        )?;

        let audio_thread = if let Some(audio_port) = audio_src_port {
            let audio_socket = UdpSocket::bind(("127.0.0.1", audio_port)).map_err(|e| {
                format!("Falha ao conectar socket fan-out de áudio na porta {audio_port}: {e}")
            })?;
            Some(spawn_fanout_thread(
                "áudio",
                audio_socket,
                Arc::clone(&audio_targets),
                Arc::clone(&running),
            )?)
        } else {
            None
        };

        Ok(Self {
            running,
            video_targets,
            audio_targets,
            video_thread: Some(video_thread),
            audio_thread,
        })
    }

    pub(crate) fn add_video_target(&self, port: u16) {
        if let Ok(mut targets) = self.video_targets.lock() {
            targets.insert(port);
        }
    }

    pub(crate) fn remove_video_target(&self, port: u16) {
        if let Ok(mut targets) = self.video_targets.lock() {
            targets.remove(&port);
        }
    }

    pub(crate) fn add_audio_target(&self, port: u16) {
        if let Ok(mut targets) = self.audio_targets.lock() {
            targets.insert(port);
        }
    }

    pub(crate) fn remove_audio_target(&self, port: u16) {
        if let Ok(mut targets) = self.audio_targets.lock() {
            targets.remove(&port);
        }
    }
}

#[cfg(not(test))]
impl Drop for RtpFanout {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        if let Some(vt) = self.video_thread.take() {
            let _ = vt.join();
        }
        if let Some(at) = self.audio_thread.take() {
            let _ = at.join();
        }
    }
}

#[cfg(windows)]
pub(crate) fn set_socket_buffer_size(socket: &UdpSocket, size_bytes: i32) {
    use std::os::windows::io::AsRawSocket;
    unsafe extern "system" {
        fn setsockopt(s: usize, level: i32, optname: i32, optval: *const i8, optlen: i32) -> i32;
    }
    const SOL_SOCKET: i32 = 0xffff;
    const SO_RCVBUF: i32 = 0x1002;
    const SO_SNDBUF: i32 = 0x1001;
    let size = size_bytes;
    unsafe {
        let _ = setsockopt(
            socket.as_raw_socket() as usize,
            SOL_SOCKET,
            SO_RCVBUF,
            &size as *const _ as *const i8,
            std::mem::size_of::<i32>() as i32,
        );
        let _ = setsockopt(
            socket.as_raw_socket() as usize,
            SOL_SOCKET,
            SO_SNDBUF,
            &size as *const _ as *const i8,
            std::mem::size_of::<i32>() as i32,
        );
    }
}

#[cfg(windows)]
pub(crate) fn disable_connection_reset(socket: &UdpSocket) {
    use std::os::windows::io::AsRawSocket;
    unsafe extern "system" {
        fn WSAIoctl(
            s: usize,
            dwIoControlCode: u32,
            lpvInBuffer: *const std::ffi::c_void,
            cbInBuffer: u32,
            lpvOutBuffer: *mut std::ffi::c_void,
            cbOutBuffer: u32,
            lpcbBytesReturned: *mut u32,
            lpOverlapped: *mut std::ffi::c_void,
            lpCompletionRoutine: *mut std::ffi::c_void,
        ) -> i32;
    }
    const SIO_UDP_CONNRESET: u32 = 0x9800000C;
    let mut bytes_returned: u32 = 0;
    let flag: u32 = 0;
    unsafe {
        let _ = WSAIoctl(
            socket.as_raw_socket() as usize,
            SIO_UDP_CONNRESET,
            &flag as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
    }
}

#[cfg(not(test))]
pub(crate) fn spawn_fanout_thread(
    label: &'static str,
    socket: UdpSocket,
    targets: Arc<Mutex<HashSet<u16>>>,
    running: Arc<AtomicBool>,
) -> Result<JoinHandle<()>, String> {
    #[cfg(windows)]
    set_socket_buffer_size(&socket, 2 * 1024 * 1024);
    #[cfg(windows)]
    disable_connection_reset(&socket);
    socket
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|e| format!("Falha ao configurar timeout no socket fan-out de {label}: {e}"))?;
    let sender = UdpSocket::bind("127.0.0.1:0")
        .map_err(|e| format!("Falha ao criar socket transmissor fan-out de {label}: {e}"))?;
    #[cfg(windows)]
    set_socket_buffer_size(&sender, 2 * 1024 * 1024);
    #[cfg(windows)]
    disable_connection_reset(&sender);

    let handle = thread::spawn(move || {
        let mut buf = [0u8; 65535];
        let mut first_packet_logged = false;
        while running.load(Ordering::Relaxed) {
            match socket.recv_from(&mut buf) {
                Ok((len, src_addr)) => {
                    if !first_packet_logged {
                        first_packet_logged = true;
                        crate::system::write_debug_log(&format!(
                            "[Capture] Fanout {label} primeiro pacote RTP recebido de {src_addr} (tamanho: {len} bytes)"
                        ));
                    }
                    let ports: Vec<u16> = {
                        let Ok(guard) = targets.lock() else { continue };
                        guard.iter().copied().collect()
                    };
                    for port in ports {
                        let _ = sender.send_to(&buf[..len], ("127.0.0.1", port));
                    }
                }
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::TimedOut
                        || e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::ConnectionReset =>
                {
                    continue;
                }
                Err(ref e) => {
                    crate::system::write_debug_log(&format!(
                        "[Capture] Fanout {label} erro de recepção ignorado: {e}"
                    ));
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }
            }
        }
    });
    Ok(handle)
}

#[cfg(not(test))]
pub(crate) fn allocate_ephemeral_port() -> Result<u16, String> {
    let socket = UdpSocket::bind("127.0.0.1:0")
        .map_err(|e| format!("Falha ao alocar porta RTP efêmera: {e}"))?;
    let port = socket
        .local_addr()
        .map_err(|e| format!("Falha ao ler porta RTP efêmera: {e}"))?
        .port();
    drop(socket);
    Ok(port)
}
