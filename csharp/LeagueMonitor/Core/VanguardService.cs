using System.ServiceProcess;
using System.Runtime.InteropServices;

namespace LeagueMonitor.Core;

/// <summary>
/// Vanguard (VGC) service monitoring and management
/// </summary>
public static class VanguardService
{
    private static readonly Logger _logger = new("VanguardService");
    private const string VGC_SERVICE_NAME = "vgc";
    private const string NETLIMITER_SERVICE_NAME = "nlsvc";
    private const int EXIT_CODE_185 = 185; // 0xB9 - Vanguard error code

    // Windows API for querying service status
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern IntPtr OpenSCManager(string? machineName, string? databaseName, uint dwAccess);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern IntPtr OpenService(IntPtr hSCManager, string lpServiceName, uint dwDesiredAccess);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool QueryServiceStatusEx(IntPtr hService, int InfoLevel, IntPtr lpBuffer, uint cbBufSize, out uint pcbBytesNeeded);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool CloseServiceHandle(IntPtr hSCObject);

    private const uint SC_MANAGER_CONNECT = 0x0001;
    private const uint SERVICE_QUERY_STATUS = 0x0004;
    private const int SC_STATUS_PROCESS_INFO = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct SERVICE_STATUS_PROCESS
    {
        public uint dwServiceType;
        public uint dwCurrentState;
        public uint dwControlsAccepted;
        public uint dwWin32ExitCode;
        public uint dwServiceSpecificExitCode;
        public uint dwCheckPoint;
        public uint dwWaitHint;
        public uint dwProcessId;
        public uint dwServiceFlags;
    }

    /// <summary>
    /// Check if VGC service exit code is 185 (0xB9)
    /// </summary>
    public static bool CheckVgcServiceExitCode185()
    {
        IntPtr scManager = IntPtr.Zero;
        IntPtr service = IntPtr.Zero;

        try
        {
            scManager = OpenSCManager(null, null, SC_MANAGER_CONNECT);
            if (scManager == IntPtr.Zero)
            {
                _logger.Warn("Failed to open service manager");
                return false;
            }

            service = OpenService(scManager, VGC_SERVICE_NAME, SERVICE_QUERY_STATUS);
            if (service == IntPtr.Zero)
            {
                // Service might not exist
                return false;
            }

            int size = Marshal.SizeOf<SERVICE_STATUS_PROCESS>();
            IntPtr buffer = Marshal.AllocHGlobal(size);

            try
            {
                if (QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, buffer, (uint)size, out _))
                {
                    var status = Marshal.PtrToStructure<SERVICE_STATUS_PROCESS>(buffer);
                    
                    // Check Win32ExitCode for service error
                    // When VGC has error 185, it shows as SERVICE_EXIT_CODE: 185
                    if (status.dwServiceSpecificExitCode == EXIT_CODE_185)
                    {
                        _logger.Warn($"VGC service exit code is {EXIT_CODE_185} (0xB9) - service error detected");
                        return true;
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to query VGC service", ex);
            return false;
        }
        finally
        {
            if (service != IntPtr.Zero)
                CloseServiceHandle(service);
            if (scManager != IntPtr.Zero)
                CloseServiceHandle(scManager);
        }
    }

    /// <summary>
    /// Check if VGC process is running
    /// </summary>
    public static bool IsVgcProcessRunning()
    {
        return ProcessManager.IsProcessRunning("vgc.exe");
    }

    /// <summary>
    /// Kill VGC process
    /// </summary>
    public static bool KillVgcProcess()
    {
        try
        {
            _logger.Info("Terminating VGC process...");
            var killed = ProcessManager.KillProcessByName("vgc.exe");
            
            if (killed > 0)
            {
                _logger.Info("VGC process terminated");
                return true;
            }
            else
            {
                _logger.Info("VGC process not found (may already be terminated)");
                return true; // Consider it success if not running
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to kill VGC process", ex);
            return false;
        }
    }

    /// <summary>
    /// Wait for VGC process to close
    /// </summary>
    public static async Task<bool> WaitForVgcProcessToCloseAsync(int timeoutMs = 120000, CancellationToken ct = default)
    {
        return await ProcessManager.WaitForProcessToCloseAsync("vgc.exe", timeoutMs, ct);
    }

    /// <summary>
    /// Stop NetLimiter service (nlsvc)
    /// </summary>
    public static bool StopNetLimiterService()
    {
        try
        {
            using var sc = new ServiceController(NETLIMITER_SERVICE_NAME);
            
            if (sc.Status == ServiceControllerStatus.Stopped)
            {
                _logger.Info("NetLimiter service is already stopped");
                return true;
            }

            _logger.Info("Stopping NetLimiter service...");
            sc.Stop();
            sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
            _logger.Success("NetLimiter service stopped successfully");
            return true;
        }
        catch (InvalidOperationException ex) when (ex.InnerException is System.ComponentModel.Win32Exception w32 && w32.NativeErrorCode == 1060)
        {
            _logger.Warn("NetLimiter service not found");
            return false;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to stop NetLimiter service", ex);
            return false;
        }
    }

    /// <summary>
    /// Start NetLimiter service (nlsvc)
    /// </summary>
    public static bool StartNetLimiterService()
    {
        try
        {
            using var sc = new ServiceController(NETLIMITER_SERVICE_NAME);
            
            if (sc.Status == ServiceControllerStatus.Running)
            {
                _logger.Info("NetLimiter service is already running");
                return true;
            }

            _logger.Info("Starting NetLimiter service...");
            sc.Start();
            sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            _logger.Success("NetLimiter service started successfully");
            return true;
        }
        catch (InvalidOperationException ex) when (ex.InnerException is System.ComponentModel.Win32Exception w32 && w32.NativeErrorCode == 1060)
        {
            _logger.Warn("NetLimiter service not found");
            return false;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to start NetLimiter service", ex);
            return false;
        }
    }

    /// <summary>
    /// Get NetLimiter service status as string
    /// </summary>
    public static string GetNetLimiterServiceStatus()
    {
        try
        {
            using var sc = new ServiceController(NETLIMITER_SERVICE_NAME);
            return sc.Status switch
            {
                ServiceControllerStatus.Running => "Running",
                ServiceControllerStatus.Stopped => "Stopped",
                ServiceControllerStatus.StartPending => "Starting",
                ServiceControllerStatus.StopPending => "Stopping",
                ServiceControllerStatus.Paused => "Paused",
                ServiceControllerStatus.ContinuePending => "Resuming",
                ServiceControllerStatus.PausePending => "Pausing",
                _ => "Unknown"
            };
        }
        catch
        {
            return "Not Found";
        }
    }

    /// <summary>
    /// Get VGC service status as string
    /// </summary>
    public static string GetVgcServiceStatus()
    {
        try
        {
            using var sc = new ServiceController(VGC_SERVICE_NAME);
            var status = sc.Status switch
            {
                ServiceControllerStatus.Running => "Running",
                ServiceControllerStatus.Stopped => "Stopped",
                ServiceControllerStatus.StartPending => "Starting",
                ServiceControllerStatus.StopPending => "Stopping",
                ServiceControllerStatus.Paused => "Paused",
                ServiceControllerStatus.ContinuePending => "Resuming",
                ServiceControllerStatus.PausePending => "Pausing",
                _ => "Unknown"
            };

            // Check for exit code 185
            if (CheckVgcServiceExitCode185())
            {
                return $"{status} (Error 185)";
            }

            return status;
        }
        catch
        {
            return "Not Found";
        }
    }
}
