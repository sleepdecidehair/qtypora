; Internal builds always install for the current user, without elevation.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Tests can use a private extension without touching the user's Markdown preferences.
!ifndef QTYPORA_MARKDOWN_EXTENSION
  !define QTYPORA_MARKDOWN_EXTENSION ".md"
!endif

!ifndef BUILD_UNINSTALLER
  Var /GLOBAL qtyporaIconPath
!endif

!macro customInstall
  Push $R0
  Push $R1
  ClearErrors
  FindFirst $R0 $R1 "$INSTDIR\resources\branding\icon-*.ico"
  ${If} ${Errors}
    Pop $R1
    Pop $R0
    Abort "QTypora branding icon is missing."
  ${EndIf}
  FindClose $R0
  StrCpy $qtyporaIconPath "$INSTDIR\resources\branding\$R1"
  Pop $R1
  Pop $R0

  ; Only update links already selected/retained by electron-builder.
  ${If} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$qtyporaIconPath" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
  ${If} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$qtyporaIconPath" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${EndIf}

  ; Supports both existing Applications\QTypora.exe choices and the Open With list.
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "QTypora"
  WriteRegExpandStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" '"$qtyporaIconPath",0'
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${QTYPORA_MARKDOWN_EXTENSION}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$appExe" "%1"'

  WriteRegStr HKCU "Software\Classes\${APP_ID}.Markdown" "" "QTypora Markdown"
  WriteRegStr HKCU "Software\Classes\${APP_ID}.Markdown\DefaultIcon" "" '"$qtyporaIconPath",0'
  WriteRegStr HKCU "Software\Classes\${APP_ID}.Markdown\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr HKCU "Software\Classes\${QTYPORA_MARKDOWN_EXTENSION}\OpenWithProgids" "${APP_ID}.Markdown" ""

  ; Never overwrite the extension default or Windows' protected UserChoice.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  Push $R0
  ReadRegStr $R0 HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
    DeleteRegKey HKCU "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
  ReadRegStr $R0 HKCU "Software\Classes\${APP_ID}.Markdown\shell\open\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
    DeleteRegKey HKCU "Software\Classes\${APP_ID}.Markdown"
    DeleteRegValue HKCU "Software\Classes\${QTYPORA_MARKDOWN_EXTENSION}\OpenWithProgids" "${APP_ID}.Markdown"
    ; Bundled NSIS 3.0.4.1 /ifempty did not preserve other sentinel values.
    ; Keep the shared extension keys; remove only our own candidate value.
  ${EndIf}
  Pop $R0
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
