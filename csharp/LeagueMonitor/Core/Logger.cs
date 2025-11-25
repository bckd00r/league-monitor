using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Threading;

namespace LeagueMonitor.Core;

/// <summary>
/// Log entry for display in UI
/// </summary>
public class LogEntry
{
    public DateTime Timestamp { get; set; }
    public string Level { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;

    public string FormattedMessage => $"[{Timestamp:HH:mm:ss}] [{Source}] [{Level}] {Message}";
}

/// <summary>
/// Thread-safe logger with UI binding support
/// </summary>
public class Logger
{
    private readonly string _source;
    private static readonly ObservableCollection<LogEntry> _logs = new();
    private static readonly object _lock = new();
    private static Dispatcher? _dispatcher;

    /// <summary>
    /// Observable collection of log entries for UI binding
    /// </summary>
    public static ObservableCollection<LogEntry> Logs => _logs;

    /// <summary>
    /// Event raised when a new log entry is added
    /// </summary>
    public static event Action<LogEntry>? OnLog;

    /// <summary>
    /// Maximum number of log entries to keep
    /// </summary>
    public static int MaxLogEntries { get; set; } = 1000;

    public Logger(string source)
    {
        _source = source;
    }

    /// <summary>
    /// Initialize dispatcher for UI thread access
    /// </summary>
    public static void Initialize(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher;
    }

    private void AddLog(string level, string message)
    {
        var entry = new LogEntry
        {
            Timestamp = DateTime.Now,
            Level = level,
            Source = _source,
            Message = message
        };

        // Debug output
        System.Diagnostics.Debug.WriteLine(entry.FormattedMessage);

        // Add to collection on UI thread
        if (_dispatcher != null)
        {
            _dispatcher.BeginInvoke(() =>
            {
                lock (_lock)
                {
                    _logs.Add(entry);
                    while (_logs.Count > MaxLogEntries)
                    {
                        _logs.RemoveAt(0);
                    }
                }
                OnLog?.Invoke(entry);
            });
        }
        else
        {
            lock (_lock)
            {
                _logs.Add(entry);
                while (_logs.Count > MaxLogEntries)
                {
                    _logs.RemoveAt(0);
                }
            }
            OnLog?.Invoke(entry);
        }
    }

    public void Info(string message) => AddLog("INFO", message);
    public void Warn(string message) => AddLog("WARN", message);
    public void Error(string message) => AddLog("ERROR", message);
    public void Error(string message, Exception ex) => AddLog("ERROR", $"{message}: {ex.Message}");
    public void Success(string message) => AddLog("SUCCESS", message);
    public void Debug(string message) => AddLog("DEBUG", message);

    /// <summary>
    /// Clear all log entries
    /// </summary>
    public static void Clear()
    {
        if (_dispatcher != null)
        {
            _dispatcher.BeginInvoke(() =>
            {
                lock (_lock)
                {
                    _logs.Clear();
                }
            });
        }
        else
        {
            lock (_lock)
            {
                _logs.Clear();
            }
        }
    }
}
