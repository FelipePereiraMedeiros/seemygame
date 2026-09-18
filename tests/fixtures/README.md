# Fixture de replay

`replay-red-then-blue.webm` contém somente conteúdo sintético: oito frames
16×16 a 1 fps, primeiro vermelho e os outros sete azuis. VP8, todos keyframes,
um cluster por frame, sem áudio. Não contém captura do usuário.

Gerada com FFmpeg (libvpx):

```powershell
ffmpeg -hide_banner -loglevel error -n -f lavfi -i 'color=c=red:s=16x16:r=1:d=1' -f lavfi -i 'color=c=blue:s=16x16:r=1:d=7' -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0[v]' -map '[v]' -c:v libvpx -g 1 -cluster_time_limit 1 -live 1 tests/fixtures/replay-red-then-blue.webm
```

O teste confirma primeiro que a fixture inteira decodifica corretamente.
Depois entrega seus clusters ao callback real do ClipRecorder, avança o
relógio simulado e decodifica o Blob exportado. A cor vermelha identifica
conteúdo antigo que não deve reaparecer num replay recente.

Isso valida conteúdo exportado deste fixture, não todos os contêineres,
codecs, sincronização de áudio ou o MediaRecorder real de cada navegador.
