; GStreamer is linked by the Rust application and Windows resolves those DLLs
; before Rust main() can add the bundled runtime directory to PATH. Keep the
; transitive loader dependencies beside the application executable. The rest
; of the runtime (plugins, manifests and data) remains under native-media and is
; discovered by GStreamerRuntime at runtime.
!macro NSIS_HOOK_POSTINSTALL
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\gstreamer-1.0-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\gobject-2.0-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\glib-2.0-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\gio-2.0-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\gmodule-2.0-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\intl-8.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\ffi-7.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\pcre2-8-0.dll" "$INSTDIR"
  CopyFiles /SILENT "$INSTDIR\native-media\gstreamer\bin\z-1.dll" "$INSTDIR"

  ; ViGEmBus Virtual Gamepad driver check
  ClearErrors
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\ViGEmBus" "ImagePath"
  ${If} ${Errors}
    DetailPrint "ViGEmBus driver nao detectado. Pode ser instalado diretamente pelo SeeMyGame com 1 clique."
  ${Else}
    DetailPrint "ViGEmBus driver detectado com sucesso."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\gstreamer-1.0-0.dll"
  Delete "$INSTDIR\gobject-2.0-0.dll"
  Delete "$INSTDIR\glib-2.0-0.dll"
  Delete "$INSTDIR\gio-2.0-0.dll"
  Delete "$INSTDIR\gmodule-2.0-0.dll"
  Delete "$INSTDIR\intl-8.dll"
  Delete "$INSTDIR\ffi-7.dll"
  Delete "$INSTDIR\pcre2-8-0.dll"
  Delete "$INSTDIR\z-1.dll"
!macroend
