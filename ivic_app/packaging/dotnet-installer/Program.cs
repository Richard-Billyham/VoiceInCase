using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

const string appName = "InVoice InCase";
const string exeName = "ivic-app.exe";
const string version = "2.1.0";

var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
var installDir = Path.Combine(localAppData, "Programs", appName);
var exePath = Path.Combine(installDir, exeName);
var uninstallPath = Path.Combine(installDir, "uninstall.cmd");
var shortcutPath = Path.Combine(appData, "Microsoft", "Windows", "Start Menu", "Programs", $"{appName}.lnk");

Directory.CreateDirectory(installDir);
ExtractEmbeddedExe(exePath);
File.WriteAllText(uninstallPath, BuildUninstallerScript(installDir, shortcutPath), System.Text.Encoding.ASCII);

CreateShortcut(shortcutPath, exePath, installDir);
WriteUninstallEntry(installDir, exePath, uninstallPath);
Process.Start(new ProcessStartInfo(exePath) { UseShellExecute = true });

static void ExtractEmbeddedExe(string targetPath)
{
    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("ivic-app.exe")
        ?? throw new InvalidOperationException("Installer payload ivic-app.exe is missing.");
    using var output = File.Create(targetPath);
    stream.CopyTo(output);
}

static void CreateShortcut(string shortcutPath, string exePath, string workingDirectory)
{
    var command = string.Join(" ", new[]
    {
        "$shell = New-Object -ComObject WScript.Shell;",
        $"$shortcut = $shell.CreateShortcut('{EscapePowerShell(shortcutPath)}');",
        $"$shortcut.TargetPath = '{EscapePowerShell(exePath)}';",
        $"$shortcut.WorkingDirectory = '{EscapePowerShell(workingDirectory)}';",
        "$shortcut.IconLocation = $shortcut.TargetPath;",
        "$shortcut.Save();",
    });
    RunHidden("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -Command \"{command}\"");
}

static void WriteUninstallEntry(string installDir, string exePath, string uninstallPath)
{
    using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\InVoiceInCase");
    key?.SetValue("DisplayName", appName);
    key?.SetValue("DisplayVersion", version);
    key?.SetValue("Publisher", "InVoice InCase Project");
    key?.SetValue("InstallLocation", installDir);
    key?.SetValue("DisplayIcon", exePath);
    key?.SetValue("UninstallString", $"\"{uninstallPath}\"");
}

static string BuildUninstallerScript(string installDir, string shortcutPath)
{
    return string.Join(Environment.NewLine, new[]
    {
        "@echo off",
        $"if exist \"{shortcutPath}\" del /F /Q \"{shortcutPath}\"",
        "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\InVoiceInCase\" /f >nul 2>nul",
        "cd /D \"%TEMP%\"",
        $"start \"\" /B cmd /C \"timeout /t 1 >nul & rmdir /S /Q \"\"{installDir}\"\"\"",
        "",
    });
}

static void RunHidden(string fileName, string arguments)
{
    using var process = Process.Start(new ProcessStartInfo(fileName, arguments)
    {
        CreateNoWindow = true,
        UseShellExecute = false,
        WindowStyle = ProcessWindowStyle.Hidden,
    });
    process?.WaitForExit();
}

static string EscapePowerShell(string value)
{
    return value.Replace("'", "''");
}
