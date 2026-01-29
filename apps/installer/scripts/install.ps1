# ===========================================
# PairUX Desktop App Installer for Windows
# ===========================================
# Usage: irm https://installer.pairux.com/install.ps1 | iex
# Or: Invoke-WebRequest -Uri https://installer.pairux.com/install.ps1 -UseBasicParsing | Invoke-Expression
# ===========================================

#Requires -Version 5.1

$ErrorActionPreference = 'Stop'

# Configuration
$GitHubRepo = 'profullstack/pairux.com'
$InstallerUrl = if ($env:PAIRUX_INSTALLER_URL) { $env:PAIRUX_INSTALLER_URL } else { 'https://installer.pairux.com' }
$InstallDir = if ($env:PAIRUX_INSTALL_DIR) { $env:PAIRUX_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'PairUX' }
$BinDir = if ($env:PAIRUX_BIN_DIR) { $env:PAIRUX_BIN_DIR } else { Join-Path $InstallDir 'bin' }

# Colors
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = 'White'
    )
    Write-Host $Message -ForegroundColor $Color
}

function Write-Info { Write-ColorOutput "[INFO] $args" 'Cyan' }
function Write-Success { Write-ColorOutput "[SUCCESS] $args" 'Green' }
function Write-Warning { Write-ColorOutput "[WARN] $args" 'Yellow' }
function Write-Error { Write-ColorOutput "[ERROR] $args" 'Red'; exit 1 }

# Print banner
function Show-Banner {
    Write-Host ''
    Write-ColorOutput '  ____       _      _   ___  __' 'Blue'
    Write-ColorOutput ' |  _ \ __ _(_)_ __| | | \ \/ /' 'Blue'
    Write-ColorOutput ' | |_) / _` | | ''__| | | |\  / ' 'Blue'
    Write-ColorOutput ' |  __/ (_| | | |  | |_| |/  \ ' 'Blue'
    Write-ColorOutput ' |_|   \__,_|_|_|   \___//_/\_\' 'Blue'
    Write-Host ''
    Write-Host '  Desktop App Installer for Windows'
    Write-Host ''
}

# Detect architecture
function Get-Platform {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture

    switch ($arch) {
        'X64' { return 'windows-x64' }
        'Arm64' { return 'windows-arm64' }
        default { Write-Error "Unsupported architecture: $arch" }
    }
}

# Get latest version from GitHub releases
function Get-LatestVersion {
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$GitHubRepo/releases/latest" -UseBasicParsing
        $version = $release.tag_name -replace '^v', ''
        return $version
    }
    catch {
        # Fallback to installer service
        try {
            $version = Invoke-RestMethod -Uri "$InstallerUrl/api/version" -UseBasicParsing
            return $version.Trim()
        }
        catch {
            Write-Error "Failed to fetch latest version. Check your internet connection. Error: $_"
        }
    }
}

# Get download URL for platform
function Get-DownloadUrl {
    param(
        [string]$Platform,
        [string]$Version
    )

    # Windows uses NSIS installer
    $filename = "PairUX.Setup.$Version.exe"
    return "https://github.com/$GitHubRepo/releases/download/v$Version/$filename"
}

# Download file
function Get-Download {
    param(
        [string]$Url,
        [string]$OutFile
    )

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
    }
    catch {
        Write-Error "Failed to download from $Url. Error: $_"
    }
}

# Install PairUX
function Install-PairUX {
    param(
        [string]$Platform,
        [string]$Version
    )

    $tempDir = Join-Path $env:TEMP "pairux-install-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        Write-Info "Downloading PairUX $Version for $Platform..."

        $downloadUrl = Get-DownloadUrl -Platform $Platform -Version $Version
        $installerPath = Join-Path $tempDir 'PairUX-Setup.exe'

        Get-Download -Url $downloadUrl -OutFile $installerPath

        Write-Info 'Running installer...'

        # Run the NSIS installer silently
        $process = Start-Process -FilePath $installerPath -ArgumentList '/S', "/D=$InstallDir" -Wait -PassThru

        if ($process.ExitCode -ne 0) {
            Write-Error "Installer failed with exit code: $($process.ExitCode)"
        }

        Write-Success "PairUX $Version installed successfully!"
    }
    finally {
        # Cleanup
        if (Test-Path $tempDir) {
            Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# Add to PATH
function Add-ToPath {
    $currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')

    if ($currentPath -notlike "*$BinDir*") {
        Write-Info "Adding $BinDir to PATH..."

        $newPath = "$currentPath;$BinDir"
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')

        # Update current session
        $env:Path = "$env:Path;$BinDir"

        Write-Warning 'PATH updated. You may need to restart your terminal for changes to take effect.'
    }
}

# Create desktop shortcut
function New-DesktopShortcut {
    $exePath = Join-Path $InstallDir 'pairux.exe'

    if (-not (Test-Path $exePath)) {
        return
    }

    $desktopPath = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktopPath 'PairUX.lnk'

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $exePath
        $shortcut.WorkingDirectory = $InstallDir
        $shortcut.Description = 'PairUX Desktop App'
        $shortcut.Save()

        Write-Info 'Desktop shortcut created.'
    }
    catch {
        Write-Warning "Could not create desktop shortcut: $_"
    }
}

# Create Start Menu shortcut
function New-StartMenuShortcut {
    $exePath = Join-Path $InstallDir 'pairux.exe'

    if (-not (Test-Path $exePath)) {
        return
    }

    $startMenuPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $shortcutPath = Join-Path $startMenuPath 'PairUX.lnk'

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $exePath
        $shortcut.WorkingDirectory = $InstallDir
        $shortcut.Description = 'PairUX Desktop App'
        $shortcut.Save()

        Write-Info 'Start Menu shortcut created.'
    }
    catch {
        Write-Warning "Could not create Start Menu shortcut: $_"
    }
}

# Install ffmpeg binary for RTMP streaming support
function Install-FFmpeg {
    param(
        [string]$Version
    )

    $ffmpegBinDir = Join-Path $InstallDir 'bin'
    $ffmpegPath = Join-Path $ffmpegBinDir 'ffmpeg.exe'
    $ffmpegUrl = "https://github.com/$GitHubRepo/releases/download/v$Version/ffmpeg-win-x64.exe.gz"

    Write-Info 'Installing ffmpeg for streaming support...'

    $tempFile = Join-Path $env:TEMP "ffmpeg-$(Get-Random).gz"

    try {
        $ProgressPreference = 'Continue'
        Invoke-WebRequest -Uri $ffmpegUrl -OutFile $tempFile -UseBasicParsing

        New-Item -ItemType Directory -Path $ffmpegBinDir -Force | Out-Null

        # Decompress gzip
        $inStream = [System.IO.File]::OpenRead($tempFile)
        $gzipStream = New-Object System.IO.Compression.GZipStream($inStream, [System.IO.Compression.CompressionMode]::Decompress)
        $outStream = [System.IO.File]::Create($ffmpegPath)
        $gzipStream.CopyTo($outStream)
        $outStream.Close()
        $gzipStream.Close()
        $inStream.Close()

        Write-Success 'ffmpeg installed'
    }
    catch {
        Write-Warning "Could not install ffmpeg: $_"
        Write-Warning 'Streaming features will use system ffmpeg if available'
    }
    finally {
        if (Test-Path $tempFile) {
            Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
        }
    }
}

# Main
function Main {
    Show-Banner

    Write-Info 'Detecting platform...'
    $platform = Get-Platform
    Write-Info "Platform: $platform"

    Write-Info 'Fetching latest version...'
    $version = Get-LatestVersion
    Write-Info "Latest version: $version"

    Install-PairUX -Platform $platform -Version $version
    Install-FFmpeg -Version $version
    Add-ToPath
    New-DesktopShortcut
    New-StartMenuShortcut

    Write-Host ''
    Write-Success 'Installation complete!'
    Write-Host ''
    Write-Host "  Run 'pairux --help' to get started"
    Write-Host '  Or visit https://pairux.com/docs for documentation'
    Write-Host ''
}

# Run main
Main
