#define MyAppName "Street Spec Desktop"
#define MyAppVersion "0.0.1"
#define MyAppPublisher "Street Spec Team"
#define MyAppURL "https://streetspec.app"
#define MyAppExeName "Street Spec Desktop.exe"
#define MyAppAssocName MyAppName + " File"
#define MyAppAssocExt ".myp"
#define MyAppAssocKey StringChange(MyAppAssocName, " ", "") + MyAppAssocExt

; Enhanced installer configuration
#define MyAppSupportPhone ""
#define MyAppSupportURL "https://streetspec.app/support"
#define MyAppUpdatesURL "https://streetspec.app/updates"
#define MyAppReadmeFile "https://streetspec.app/readme"
#define MyAppContact "support@streetspec.app"

[Setup]
; NOTE: The value of AppId uniquely identifies this application. Do not use the same AppId value in installers for other applications.
; (To generate a new GUID, click Tools | Generate GUID inside the IDE.)
AppId={{2E8F4B5A-9D4C-4F2A-8B6E-1A2C3D4E5F6A}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppSupportURL}
AppUpdatesURL={#MyAppUpdatesURL}
AppContact={#MyAppContact}
DefaultDirName={autopf}\{#MyAppName}
ChangesAssociations=no
DisableProgramGroupPage=no
PrivilegesRequired=lowest
OutputDir=release
OutputBaseFilename=Street-Spec-Desktop-Setup-{#MyAppVersion}
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
WizardImageFile=assets\wizard.bmp
WizardSmallImageFile=assets\wizard-small.bmp
ShowLanguageDialog=no
AllowNoIcons=yes
AlwaysShowDirOnReadyPage=yes
AlwaysShowGroupOnReadyPage=yes
EnableDirDoesntExistWarning=yes
DirExistsWarning=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "desktopicon\user"; Description: "For the current user only"; GroupDescription: "{cm:AdditionalIcons}"; Flags: exclusive
Name: "desktopicon\common"; Description: "For all users"; GroupDescription: "{cm:AdditionalIcons}"; Flags: exclusive unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 6.1
Name: "associate"; Description: "Associate .ssp files with {#MyAppName}"; GroupDescription: "File Associations"; Flags: unchecked

[Files]
Source: "dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; NOTE: Don't use "Flags: ignoreversion" on any shared system files

[Registry]
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocExt}\OpenWithProgids"; ValueType: string; ValueName: "{#MyAppAssocKey}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocKey}"; ValueType: string; ValueName: ""; ValueData: "{#MyAppAssocName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocKey}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocKey}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; Comment: "Professional Street View measurement tool"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{app}\{#MyAppExeName}"; Comment: "Professional Street View measurement tool"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon\user; IconFilename: "{app}\{#MyAppExeName}"; Comment: "Professional Street View measurement tool"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\data"
Type: files; Name: "{app}\*.log"
Type: dirifempty; Name: "{app}"

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C ""taskkill /im ""{#MyAppExeName}"" /f /fi ""status eq running"""""; Flags: runhidden

[Messages]
SetupAppTitle=Setup - {#MyAppName}
SetupWindowTitle=Setup - {#MyAppName}
UninstallAppTitle=Uninstall - {#MyAppName}
UninstallAppFullTitle=%1 - {#MyAppName}
InformationTitle=Information
ConfirmUninstall=Are you sure you want to remove %1 and all of its components?
UninstallStatusLabel=Please wait while %1 is being removed from your computer.
UninstalledAll=%1 has been successfully removed from your computer.
UninstalledMost=%1 has been partially removed from your computer.%n%nSome elements could not be removed. You can remove them manually.
UninstalledAndNeedsRestart=%1 has been removed. You must restart your computer for the uninstallation to complete.
UninstallDataCorrupted=%1 contains corrupted data and cannot be uninstalled. You should reinstall %1.
