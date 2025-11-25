using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LeagueMonitor.Core;

/// <summary>
/// Process information container
/// </summary>
public record ProcessInfo(int Pid, string Name);

/// <summary>
/// Process management using Windows API
/// </summary>
public static class ProcessManager
{
    private static readonly Logger _logger = new("ProcessManager");

    // Windows API imports for process termination
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    private const uint PROCESS_TERMINATE = 0x0001;
    private const uint PROCESS_QUERY_INFORMATION = 0x0400;

    /// <summary>
    /// Check if a process is running by name
    /// </summary>
    public static bool IsProcessRunning(string processName)
    {
        try
        {
            // Remove .exe extension if present
            var name = processName.Replace(".exe", "", StringComparison.OrdinalIgnoreCase);
            var processes = Process.GetProcessesByName(name);
            return processes.Length > 0;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to check process", ex);
            return false;
        }
    }

    /// <summary>
    /// Check if any of the given process names is running
    /// </summary>
    public static bool IsAnyProcessRunning(IEnumerable<string> processNames)
    {
        return processNames.Any(IsProcessRunning);
    }

    /// <summary>
    /// Get all PIDs for a process name
    /// </summary>
    public static List<int> GetProcessPids(string processName)
    {
        try
        {
            var name = processName.Replace(".exe", "", StringComparison.OrdinalIgnoreCase);
            var processes = Process.GetProcessesByName(name);
            return processes.Select(p => p.Id).ToList();
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to get process PIDs", ex);
            return [];
        }
    }

    /// <summary>
    /// Get process count by name pattern (for League processes)
    /// </summary>
    public static int GetLeagueProcessCount()
    {
        try
        {
            var leagueProcessNames = new[] { "LeagueClient", "LeagueClientUx", "LeagueClientUxRender" };
            int count = 0;

            foreach (var name in leagueProcessNames)
            {
                var processes = Process.GetProcessesByName(name);
                count += processes.Length;
            }

            return count;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to get League process count", ex);
            return 0;
        }
    }

    /// <summary>
    /// Kill a process by PID using Windows API
    /// </summary>
    public static bool KillProcess(int pid)
    {
        IntPtr handle = IntPtr.Zero;
        try
        {
            handle = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION, false, pid);
            if (handle == IntPtr.Zero)
            {
                _logger.Info($"Process {pid} already terminated or inaccessible");
                return true;
            }

            if (TerminateProcess(handle, 0))
            {
                _logger.Info($"Killed process with PID: {pid}");
                return true;
            }
            else
            {
                var error = Marshal.GetLastWin32Error();
                _logger.Warn($"Failed to kill process {pid}: Win32 error {error}");
                return false;
            }
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to kill process {pid}", ex);
            return false;
        }
        finally
        {
            if (handle != IntPtr.Zero)
            {
                CloseHandle(handle);
            }
        }
    }

    /// <summary>
    /// Kill all processes by name
    /// </summary>
    public static int KillProcessByName(string processName)
    {
        var pids = GetProcessPids(processName);
        int killedCount = 0;

        foreach (var pid in pids)
        {
            if (KillProcess(pid))
            {
                killedCount++;
            }
        }

        return killedCount;
    }

    /// <summary>
    /// Kill processes by multiple possible names
    /// </summary>
    public static int KillProcessByMultipleNames(IEnumerable<string> processNames)
    {
        int totalKilled = 0;
        foreach (var name in processNames)
        {
            totalKilled += KillProcessByName(name);
        }
        return totalKilled;
    }

    /// <summary>
    /// Wait for a process to appear
    /// </summary>
    public static async Task<bool> WaitForProcessAsync(string processName, int timeoutMs = 30000, CancellationToken ct = default)
    {
        var startTime = DateTime.Now;

        while ((DateTime.Now - startTime).TotalMilliseconds < timeoutMs)
        {
            if (ct.IsCancellationRequested)
                return false;

            if (IsProcessRunning(processName))
                return true;

            await Task.Delay(500, ct);
        }

        return false;
    }

    /// <summary>
    /// Wait for a process to close
    /// </summary>
    public static async Task<bool> WaitForProcessToCloseAsync(string processName, int timeoutMs = 120000, CancellationToken ct = default)
    {
        var startTime = DateTime.Now;
        var checkInterval = 2000;

        while ((DateTime.Now - startTime).TotalMilliseconds < timeoutMs)
        {
            if (ct.IsCancellationRequested)
                return false;

            if (!IsProcessRunning(processName))
            {
                var elapsed = (int)(DateTime.Now - startTime).TotalSeconds;
                _logger.Success($"Process {processName} closed after {elapsed} seconds");
                return true;
            }

            var elapsedSeconds = (int)(DateTime.Now - startTime).TotalSeconds;
            if (elapsedSeconds > 0 && elapsedSeconds % 10 == 0)
            {
                _logger.Info($"Process {processName} still running... ({elapsedSeconds}s elapsed)");
            }

            await Task.Delay(checkInterval, ct);
        }

        return false;
    }

    /// <summary>
    /// Launch an application
    /// </summary>
    public static bool LaunchApp(string appPath, string[] args)
    {
        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = appPath,
                Arguments = string.Join(" ", args),
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal
            };

            var process = Process.Start(startInfo);
            if (process != null)
            {
                _logger.Success($"Launched application: {appPath}");
                return true;
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.Error($"Failed to launch {appPath}", ex);
            return false;
        }
    }
}
