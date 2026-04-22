param(
  [Parameter(Mandatory = $true)]
  [string]$Action,
  [string]$Handle,
  [string]$OutputPath,
  [string]$ImagePath,
  [string]$BrowserId,
  [string]$AppId,
  [string]$LaunchUrl,
  [string]$Text,
  [string]$Keys,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  [int]$Delta = 0,
  [int]$MaxDepth = 3,
  [int]$MaxNodes = 80
)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class User32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
"@

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
} catch {
  # OCR remains optional. The ocrImage action reports this explicitly when unavailable.
}

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_WHEEL = 0x0800

function ConvertTo-SafeId([string]$Value) {
  return (($Value.ToLowerInvariant() -replace '[^a-z0-9]+', '_').Trim('_'))
}

function Get-WindowTitle([IntPtr]$hWnd) {
  $builder = New-Object System.Text.StringBuilder 1024
  [void][User32]::GetWindowText($hWnd, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Convert-Rect([User32+RECT]$rect) {
  return @{
    x = $rect.Left
    y = $rect.Top
    width = ($rect.Right - $rect.Left)
    height = ($rect.Bottom - $rect.Top)
  }
}

function Get-WindowProcessInfo([IntPtr]$hWnd) {
  [uint32]$processId = 0
  [void][User32]::GetWindowThreadProcessId($hWnd, [ref]$processId)
  if ($processId -le 0) {
    return @{
      processId = $null
      processName = $null
      executablePath = $null
    }
  }

  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    return @{
      processId = [int]$processId
      processName = $process.ProcessName
      executablePath = try { $process.Path } catch { $null }
    }
  } catch {
    return @{
      processId = [int]$processId
      processName = $null
      executablePath = $null
    }
  }
}

function Get-KnownBrowsers {
  $entries = @(
    @{
      id = "edge"
      label = "Microsoft Edge"
      processName = "msedge"
      paths = @(
        "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
      )
    },
    @{
      id = "chrome"
      label = "Google Chrome"
      processName = "chrome"
      paths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
      )
    },
    @{
      id = "firefox"
      label = "Mozilla Firefox"
      processName = "firefox"
      paths = @(
        "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
        "$env:ProgramFiles(x86)\Mozilla Firefox\firefox.exe"
      )
    },
    @{
      id = "brave"
      label = "Brave"
      processName = "brave"
      paths = @(
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles(x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:LocalAppData\BraveSoftware\Brave-Browser\Application\brave.exe"
      )
    }
  )

  return $entries | ForEach-Object {
    $resolvedPath = $_.paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($resolvedPath) {
      @{
        id = $_.id
        label = $_.label
        processName = $_.processName
        executablePath = $resolvedPath
      }
    }
  } | Where-Object { $_ }
}

function Get-KnownApplications {
  $entries = @(
    @{
      id = "notepad"
      label = "Notepad"
      kind = "text_editor"
      processName = "notepad"
      paths = @("$env:WINDIR\System32\notepad.exe")
    },
    @{
      id = "calculator"
      label = "Calculator"
      kind = "utility"
      processName = "CalculatorApp"
      paths = @("$env:WINDIR\System32\calc.exe")
    },
    @{
      id = "paint"
      label = "Paint"
      kind = "image_editor"
      processName = "mspaint"
      paths = @("$env:WINDIR\System32\mspaint.exe")
    },
    @{
      id = "file_explorer"
      label = "File Explorer"
      kind = "file_manager"
      processName = "explorer"
      paths = @("$env:WINDIR\explorer.exe")
    },
    @{
      id = "powershell"
      label = "Windows PowerShell"
      kind = "terminal"
      processName = "powershell"
      paths = @("$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe")
    }
  )

  $known = $entries | ForEach-Object {
    $resolvedPath = $_.paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($resolvedPath) {
      @{
        id = $_.id
        label = $_.label
        kind = $_.kind
        processName = $_.processName
        executablePath = $resolvedPath
        launchType = "executable"
        source = "known_app"
      }
    }
  } | Where-Object { $_ }

  $shortcutRoots = @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:AppData\Microsoft\Windows\Start Menu\Programs"
  ) | Where-Object { $_ -and (Test-Path $_) }

  $shortcuts = @()
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcuts = $shortcutRoots |
      ForEach-Object { Get-ChildItem -Path $_ -Filter *.lnk -Recurse -ErrorAction SilentlyContinue } |
      Select-Object -First 120 |
      ForEach-Object {
        try {
          $shortcut = $shell.CreateShortcut($_.FullName)
          $label = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
          if ([string]::IsNullOrWhiteSpace($label)) { return }
          @{
            id = "shortcut_$(ConvertTo-SafeId $label)"
            label = $label
            kind = "application"
            processName = if ($shortcut.TargetPath) { [System.IO.Path]::GetFileNameWithoutExtension($shortcut.TargetPath) } else { $null }
            executablePath = if ($shortcut.TargetPath) { $shortcut.TargetPath } else { $null }
            shortcutPath = $_.FullName
            launchType = "shortcut"
            source = "start_menu"
          }
        } catch {
          $null
        }
      } | Where-Object { $_ }
  } catch {
    $shortcuts = @()
  }

  $browserApps = Get-KnownBrowsers | ForEach-Object {
    @{
      id = "browser_$($_.id)"
      label = $_.label
      kind = "browser"
      processName = $_.processName
      executablePath = $_.executablePath
      launchType = "executable"
      source = "known_browser"
    }
  }

  $all = @($known) + @($browserApps) + @($shortcuts)
  $seen = @{}
  $all | Where-Object {
    if (-not $_.id -or $seen.ContainsKey($_.id)) {
      return $false
    }
    $seen[$_.id] = $true
    return $true
  }
}

function Get-VisibleWindows {
  $windows = New-Object System.Collections.Generic.List[Object]
  $callback = [User32+EnumWindowsProc]{
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if (-not [User32]::IsWindowVisible($hWnd)) {
      return $true
    }
    $title = Get-WindowTitle $hWnd
    if ([string]::IsNullOrWhiteSpace($title)) {
      return $true
    }
    $rect = New-Object User32+RECT
    [void][User32]::GetWindowRect($hWnd, [ref]$rect)
    $processInfo = Get-WindowProcessInfo $hWnd
    $windows.Add(@{
      id = $hWnd.ToInt64().ToString()
      title = $title
      bounds = Convert-Rect $rect
      processId = $processInfo.processId
      processName = $processInfo.processName
      executablePath = $processInfo.executablePath
    })
    return $true
  }
  [void][User32]::EnumWindows($callback, [IntPtr]::Zero)
  return $windows
}

function Get-WindowByHandle([string]$WindowHandle) {
  $all = Get-VisibleWindows
  return $all | Where-Object { $_.id -eq $WindowHandle } | Select-Object -First 1
}

function Save-Capture([int]$Left, [int]$Top, [int]$CaptureWidth, [int]$CaptureHeight, [string]$Path) {
  $bitmap = New-Object System.Drawing.Bitmap $CaptureWidth, $CaptureHeight
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($Left, $Top, 0, 0, $bitmap.Size)
  $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function Save-ScreenCapture([string]$Path) {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  Save-Capture -Left $bounds.Left -Top $bounds.Top -CaptureWidth $bounds.Width -CaptureHeight $bounds.Height -Path $Path
  return @{
    virtualScreen = @{
      x = $bounds.Left
      y = $bounds.Top
      width = $bounds.Width
      height = $bounds.Height
    }
    outputPath = $Path
  }
}

function Await-WinRtOperation($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  if (-not $method) {
    throw "Windows Runtime async bridge is unavailable."
  }
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

function Invoke-ImageOcr([string]$Path) {
  if (-not $Path -or -not (Test-Path $Path)) {
    throw "ImagePath is required and must exist."
  }
  try {
    [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
    [Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) {
      return @{
        available = $false
        engine = "windows_media_ocr"
        reason = "Windows OCR engine is unavailable for the current user profile languages."
        text = ""
        lines = @()
        words = @()
      }
    }

    $file = Await-WinRtOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRtOperation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRtOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRtOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-WinRtOperation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    $words = @()
    foreach ($line in $result.Lines) {
      $lineWords = @()
      foreach ($word in $line.Words) {
        $wordItem = @{
          text = $word.Text
          bounds = @{
            x = [int]$word.BoundingRect.X
            y = [int]$word.BoundingRect.Y
            width = [int]$word.BoundingRect.Width
            height = [int]$word.BoundingRect.Height
          }
        }
        $lineWords += $wordItem
        $words += $wordItem
      }
      $lines += @{
        text = $line.Text
        words = $lineWords
      }
    }
    return @{
      available = $true
      engine = "windows_media_ocr"
      language = if ($engine.RecognizerLanguage) { $engine.RecognizerLanguage.LanguageTag } else { $null }
      text = $result.Text
      lineCount = $lines.Count
      wordCount = $words.Count
      lines = $lines
      words = $words
    }
  } catch {
    return @{
      available = $false
      engine = "windows_media_ocr"
      reason = $_.Exception.Message
      text = ""
      lines = @()
      words = @()
    }
  }
}

function Start-BrowserLaunch([string]$RequestedBrowserId, [string]$RequestedUrl) {
  if (-not $RequestedBrowserId) {
    throw "BrowserId is required"
  }
  $browser = Get-KnownBrowsers | Where-Object { $_.id -eq $RequestedBrowserId } | Select-Object -First 1
  if (-not $browser) {
    throw "Supported browser not found: $RequestedBrowserId"
  }

  $argumentList = @()
  switch ($browser.id) {
    "edge" { $argumentList += "--new-window" }
    "chrome" { $argumentList += "--new-window" }
    "brave" { $argumentList += "--new-window" }
    "firefox" { $argumentList += "-new-window" }
  }
  if ($RequestedUrl) {
    $argumentList += $RequestedUrl
  }

  $process = Start-Process -FilePath $browser.executablePath -ArgumentList $argumentList -PassThru
  Start-Sleep -Milliseconds 500

  @{
    launchedAt = [DateTime]::UtcNow.ToString("o")
    browser = $browser
    processId = $process.Id
    launchUrl = if ($RequestedUrl) { $RequestedUrl } else { $null }
  }
}

function Start-GeneralApplication([string]$RequestedAppId) {
  if (-not $RequestedAppId) {
    throw "AppId is required"
  }
  $app = Get-KnownApplications | Where-Object { $_.id -eq $RequestedAppId } | Select-Object -First 1
  if (-not $app) {
    throw "Application not found: $RequestedAppId"
  }
  if ($app.launchType -eq "shortcut" -and $app.shortcutPath) {
    $process = Start-Process -FilePath $app.shortcutPath -PassThru
  } elseif ($app.executablePath) {
    $process = Start-Process -FilePath $app.executablePath -PassThru
  } else {
    throw "Application has no launchable path: $RequestedAppId"
  }
  Start-Sleep -Milliseconds 500
  @{
    launchedAt = [DateTime]::UtcNow.ToString("o")
    application = $app
    processId = if ($process) { $process.Id } else { $null }
  }
}

function Escape-SendKeysText([string]$Value) {
  if ($null -eq $Value) { return "" }
  return ($Value -replace '([+^%~()\[\]{}])', '{$1}')
}

function Convert-Hotkey([string]$Value) {
  $parts = ($Value.ToLowerInvariant() -split '\+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $prefix = ""
  $key = $null
  foreach ($part in $parts) {
    switch ($part) {
      "ctrl" { $prefix += "^"; continue }
      "control" { $prefix += "^"; continue }
      "alt" { $prefix += "%"; continue }
      "shift" { $prefix += "+"; continue }
      default { $key = $part }
    }
  }
  if (-not $key) { throw "Hotkey requires a key" }
  return "$prefix$key"
}

function Focus-IfHandle([string]$WindowHandle) {
  if ($WindowHandle) {
    [void][User32]::SetForegroundWindow([IntPtr]::new([int64]$WindowHandle))
    Start-Sleep -Milliseconds 120
  }
}

function Convert-AutomationElement([System.Windows.Automation.AutomationElement]$Element, [int]$Depth, [int]$MaxDepth, [ref]$Remaining) {
  if ($null -eq $Element -or $Remaining.Value -le 0) {
    return $null
  }
  $Remaining.Value = $Remaining.Value - 1
  $properties = $Element.Current
  $node = @{
    name = $properties.Name
    automationId = $properties.AutomationId
    className = $properties.ClassName
    controlType = if ($properties.ControlType) { $properties.ControlType.ProgrammaticName } else { $null }
    isEnabled = $properties.IsEnabled
    isOffscreen = $properties.IsOffscreen
    bounds = @{
      x = [int]$properties.BoundingRectangle.X
      y = [int]$properties.BoundingRectangle.Y
      width = [int]$properties.BoundingRectangle.Width
      height = [int]$properties.BoundingRectangle.Height
    }
    children = @()
  }
  if ($Depth -ge $MaxDepth) {
    return $node
  }
  try {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($Element)
    while ($null -ne $child -and $Remaining.Value -gt 0) {
      $childNode = Convert-AutomationElement -Element $child -Depth ($Depth + 1) -MaxDepth $MaxDepth -Remaining $Remaining
      if ($null -ne $childNode) {
        $node.children += $childNode
      }
      $child = $walker.GetNextSibling($child)
    }
  } catch {
    $node.children = @()
  }
  return $node
}

function Get-AccessibilityTree([string]$WindowHandle, [int]$Depth, [int]$NodeLimit) {
  if (-not $WindowHandle) { throw "Handle is required" }
  $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([int64]$WindowHandle))
  if ($null -eq $element) {
    return @{
      available = $false
      reason = "No automation element was available for the window."
      tree = $null
    }
  }
  $remaining = $NodeLimit
  $tree = Convert-AutomationElement -Element $element -Depth 0 -MaxDepth $Depth -Remaining ([ref]$remaining)
  return @{
    available = $true
    reason = $null
    maxDepth = $Depth
    maxNodes = $NodeLimit
    nodesReturned = ($NodeLimit - $remaining)
    tree = $tree
  }
}

switch ($Action) {
  "listBrowsers" {
    Get-KnownBrowsers | ConvertTo-Json -Depth 5
  }
  "listApplications" {
    Get-KnownApplications | ConvertTo-Json -Depth 6
  }
  "list" {
    Get-VisibleWindows | ConvertTo-Json -Depth 5
  }
  "active" {
    $activeHandle = [User32]::GetForegroundWindow().ToInt64().ToString()
    $window = Get-WindowByHandle $activeHandle
    $window | ConvertTo-Json -Depth 5
  }
  "focus" {
    if (-not $Handle) { throw "Handle is required" }
    [void][User32]::SetForegroundWindow([IntPtr]::new([int64]$Handle))
    Start-Sleep -Milliseconds 120
    $window = Get-WindowByHandle $Handle
    $window | ConvertTo-Json -Depth 5
  }
  "launchBrowser" {
    Start-BrowserLaunch -RequestedBrowserId $BrowserId -RequestedUrl $LaunchUrl | ConvertTo-Json -Depth 5
  }
  "launchApplication" {
    Start-GeneralApplication -RequestedAppId $AppId | ConvertTo-Json -Depth 6
  }
  "typeText" {
    Focus-IfHandle $Handle
    [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText $Text))
    @{ typedAt = [DateTime]::UtcNow.ToString("o"); textLength = if ($Text) { $Text.Length } else { 0 }; targetHandle = $Handle } | ConvertTo-Json -Depth 5
  }
  "sendHotkey" {
    Focus-IfHandle $Handle
    [System.Windows.Forms.SendKeys]::SendWait((Convert-Hotkey $Keys))
    @{ sentAt = [DateTime]::UtcNow.ToString("o"); keys = $Keys; targetHandle = $Handle } | ConvertTo-Json -Depth 5
  }
  "clickPoint" {
    Focus-IfHandle $Handle
    [void][User32]::SetCursorPos($X, $Y)
    [User32]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    [User32]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    @{ clickedAt = [DateTime]::UtcNow.ToString("o"); x = $X; y = $Y; targetHandle = $Handle } | ConvertTo-Json -Depth 5
  }
  "scroll" {
    Focus-IfHandle $Handle
    [User32]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, [uint32]$Delta, [UIntPtr]::Zero)
    @{ scrolledAt = [DateTime]::UtcNow.ToString("o"); delta = $Delta; targetHandle = $Handle } | ConvertTo-Json -Depth 5
  }
  "captureWindow" {
    if (-not $Handle -or -not $OutputPath) { throw "Handle and OutputPath are required" }
    $window = Get-WindowByHandle $Handle
    if (-not $window) { throw "Window not found" }
    Save-Capture -Left $window.bounds.x -Top $window.bounds.y -CaptureWidth $window.bounds.width -CaptureHeight $window.bounds.height -Path $OutputPath
    @{
      window = $window
      outputPath = $OutputPath
    } | ConvertTo-Json -Depth 5
  }
  "captureRegion" {
    if (-not $OutputPath) { throw "OutputPath is required" }
    Save-Capture -Left $X -Top $Y -CaptureWidth $Width -CaptureHeight $Height -Path $OutputPath
    @{
      region = @{
        x = $X
        y = $Y
        width = $Width
        height = $Height
      }
      outputPath = $OutputPath
    } | ConvertTo-Json -Depth 5
  }
  "captureScreen" {
    if (-not $OutputPath) { throw "OutputPath is required" }
    Save-ScreenCapture -Path $OutputPath | ConvertTo-Json -Depth 5
  }
  "ocrImage" {
    Invoke-ImageOcr -Path $ImagePath | ConvertTo-Json -Depth 8
  }
  "inspect" {
    if (-not $Handle) { throw "Handle is required" }
    $window = Get-WindowByHandle $Handle
    if (-not $window) { throw "Window not found" }
    $accessibility = try { Get-AccessibilityTree -WindowHandle $Handle -Depth $MaxDepth -NodeLimit $MaxNodes } catch { @{ available = $false; reason = $_.Exception.Message; tree = $null } }
    @{
      window = $window
      observation = @{
        title = $window.title
        bounds = $window.bounds
        accessibility = $accessibility
      }
    } | ConvertTo-Json -Depth 5
  }
  "accessibilityTree" {
    Get-AccessibilityTree -WindowHandle $Handle -Depth $MaxDepth -NodeLimit $MaxNodes | ConvertTo-Json -Depth 8
  }
  default {
    throw "Unsupported action: $Action"
  }
}
