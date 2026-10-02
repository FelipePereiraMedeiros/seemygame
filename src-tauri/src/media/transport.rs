//! transport; internal to the native media subsystem.
use super::*;

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

pub(crate) fn allocate_loopback_port() -> Result<(u16, UdpSocket), String> {
    let socket = UdpSocket::bind("127.0.0.1:0")
        .map_err(|error| format!("Não foi possível reservar porta RTP local: {error}"))?;
    #[cfg(windows)]
    set_socket_buffer_size(&socket, 2 * 1024 * 1024);
    let port = socket
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Não foi possível ler porta RTP local: {error}"))?;
    Ok((port, socket))
}
