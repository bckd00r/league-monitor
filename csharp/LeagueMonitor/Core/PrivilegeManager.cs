using System.Runtime.InteropServices;
using System.Security.Principal;

namespace LeagueMonitor.Core;

/// <summary>
/// Manages Windows privileges for elevated access
/// </summary>
public static class PrivilegeManager
{
    private static readonly Logger _logger = new("Privileges");

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool LookupPrivilegeValue(string? lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, uint BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    private const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint SE_PRIVILEGE_ENABLED = 0x00000002;

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID_AND_ATTRIBUTES
    {
        public LUID Luid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_PRIVILEGES
    {
        public uint PrivilegeCount;
        public LUID_AND_ATTRIBUTES Privileges;
    }

    // Privilege constants
    private const string SE_DEBUG_NAME = "SeDebugPrivilege";
    private const string SE_SHUTDOWN_NAME = "SeShutdownPrivilege";
    private const string SE_INCREASE_QUOTA_NAME = "SeIncreaseQuotaPrivilege";

    /// <summary>
    /// Check if running as administrator
    /// </summary>
    public static bool IsRunningAsAdmin()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Enable all required privileges for process management
    /// </summary>
    public static void EnableAllPrivileges()
    {
        _logger.Info("Enabling privileges...");

        if (!IsRunningAsAdmin())
        {
            _logger.Warn("Not running as administrator - some features may be limited");
        }

        // Enable SeDebugPrivilege - allows access to other processes
        if (EnablePrivilege(SE_DEBUG_NAME))
        {
            _logger.Success("SeDebugPrivilege enabled");
        }
        else
        {
            _logger.Warn("Failed to enable SeDebugPrivilege");
        }

        // Enable SeShutdownPrivilege - allows system shutdown/restart
        if (EnablePrivilege(SE_SHUTDOWN_NAME))
        {
            _logger.Success("SeShutdownPrivilege enabled");
        }

        // Enable SeIncreaseQuotaPrivilege - allows adjusting process quotas
        if (EnablePrivilege(SE_INCREASE_QUOTA_NAME))
        {
            _logger.Success("SeIncreaseQuotaPrivilege enabled");
        }

        _logger.Info($"Running as Administrator: {IsRunningAsAdmin()}");
    }

    /// <summary>
    /// Enable a specific privilege
    /// </summary>
    private static bool EnablePrivilege(string privilegeName)
    {
        IntPtr tokenHandle = IntPtr.Zero;

        try
        {
            if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out tokenHandle))
            {
                return false;
            }

            if (!LookupPrivilegeValue(null, privilegeName, out LUID luid))
            {
                return false;
            }

            var tokenPrivileges = new TOKEN_PRIVILEGES
            {
                PrivilegeCount = 1,
                Privileges = new LUID_AND_ATTRIBUTES
                {
                    Luid = luid,
                    Attributes = SE_PRIVILEGE_ENABLED
                }
            };

            if (!AdjustTokenPrivileges(tokenHandle, false, ref tokenPrivileges, 0, IntPtr.Zero, IntPtr.Zero))
            {
                return false;
            }

            // Check if the privilege was actually adjusted
            return Marshal.GetLastWin32Error() == 0;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (tokenHandle != IntPtr.Zero)
            {
                CloseHandle(tokenHandle);
            }
        }
    }
}
