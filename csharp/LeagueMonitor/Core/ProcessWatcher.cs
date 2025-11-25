using System.Management;

namespace LeagueMonitor.Core;

/// <summary>
/// Event arguments for process events
/// </summary>
public class ProcessEventArgs : EventArgs
{
    public int ProcessId { get; set; }
    public string ProcessName { get; set; } = string.Empty;
}

/// <summary>
/// Watches for process start/stop events using WMI
/// Much faster than polling - provides instant notifications
/// </summary>
public class ProcessWatcher : IDisposable
{
    private readonly Logger _logger = new("ProcessWatcher");
    private ManagementEventWatcher? _startWatcher;
    private ManagementEventWatcher? _stopWatcher;
    private readonly string[] _processNames;
    private bool _isRunning;

    /// <summary>
    /// Fired when a watched process starts
    /// </summary>
    public event EventHandler<ProcessEventArgs>? ProcessStarted;

    /// <summary>
    /// Fired when a watched process stops
    /// </summary>
    public event EventHandler<ProcessEventArgs>? ProcessStopped;

    /// <summary>
    /// Create a new process watcher for specified process names
    /// </summary>
    /// <param name="processNames">Process names to watch (without .exe)</param>
    public ProcessWatcher(params string[] processNames)
    {
        _processNames = processNames;
    }

    /// <summary>
    /// Start watching for process events
    /// </summary>
    public void Start()
    {
        if (_isRunning) return;

        try
        {
            // Build WQL condition for process names
            var conditions = string.Join(" OR ", _processNames.Select(p => $"TargetInstance.Name = '{p}.exe'"));

            // Watch for process creation (0.5 second polling for faster detection)
            var startQuery = new WqlEventQuery(
                "__InstanceCreationEvent",
                TimeSpan.FromMilliseconds(500),
                $"TargetInstance ISA 'Win32_Process' AND ({conditions})"
            );

            _startWatcher = new ManagementEventWatcher(startQuery);
            _startWatcher.EventArrived += OnProcessStarted;
            _startWatcher.Start();

            // Watch for process termination (0.5 second polling for faster detection)
            var stopQuery = new WqlEventQuery(
                "__InstanceDeletionEvent",
                TimeSpan.FromMilliseconds(500),
                $"TargetInstance ISA 'Win32_Process' AND ({conditions})"
            );

            _stopWatcher = new ManagementEventWatcher(stopQuery);
            _stopWatcher.EventArrived += OnProcessStopped;
            _stopWatcher.Start();

            _isRunning = true;
            _logger.Info($"Started watching processes: {string.Join(", ", _processNames)}");
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to start process watcher", ex);
            throw;
        }
    }

    /// <summary>
    /// Stop watching for process events
    /// </summary>
    public void Stop()
    {
        if (!_isRunning) return;

        _startWatcher?.Stop();
        _stopWatcher?.Stop();
        _isRunning = false;
        _logger.Info("Stopped watching processes");
    }

    private void OnProcessStarted(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var targetInstance = (ManagementBaseObject)e.NewEvent["TargetInstance"];
            var processId = Convert.ToInt32(targetInstance["ProcessId"]);
            var processName = targetInstance["Name"]?.ToString()?.Replace(".exe", "") ?? "Unknown";

            ProcessStarted?.Invoke(this, new ProcessEventArgs { ProcessId = processId, ProcessName = processName });
        }
        catch (Exception ex)
        {
            _logger.Error("Error handling process start event", ex);
        }
    }

    private void OnProcessStopped(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var targetInstance = (ManagementBaseObject)e.NewEvent["TargetInstance"];
            var processId = Convert.ToInt32(targetInstance["ProcessId"]);
            var processName = targetInstance["Name"]?.ToString()?.Replace(".exe", "") ?? "Unknown";

            ProcessStopped?.Invoke(this, new ProcessEventArgs { ProcessId = processId, ProcessName = processName });
        }
        catch (Exception ex)
        {
            _logger.Error("Error handling process stop event", ex);
        }
    }

    public void Dispose()
    {
        Stop();
        _startWatcher?.Dispose();
        _stopWatcher?.Dispose();
    }
}
