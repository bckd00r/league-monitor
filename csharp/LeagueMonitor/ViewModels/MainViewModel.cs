using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LeagueMonitor.Configuration;
using LeagueMonitor.Core;
using LeagueMonitor.Services;

namespace LeagueMonitor.ViewModels;

/// <summary>
/// Application mode
/// </summary>
public enum AppMode
{
    Selection,
    Controller,
    Follower
}

/// <summary>
/// Main ViewModel for the application
/// </summary>
public partial class MainViewModel : ObservableObject, IDisposable
{
    private readonly Logger _logger = new("MainViewModel");
    
    private ControllerService? _controllerService;
    private FollowerService? _followerService;
    private CancellationTokenSource? _cancellationTokenSource;

    [ObservableProperty]
    private AppMode _currentMode = AppMode.Selection;

    [ObservableProperty]
    private bool _isRunning;

    [ObservableProperty]
    private bool _isConnected;

    [ObservableProperty]
    private string _sessionToken = string.Empty;

    [ObservableProperty]
    private string _followerToken = string.Empty;

    [ObservableProperty]
    private string _statusText = "Select a mode to start";

    [ObservableProperty]
    private int _processCount;

    [ObservableProperty]
    private bool _vgcProcessRunning;

    [ObservableProperty]
    private string _vgcServiceStatus = "Unknown";

    [ObservableProperty]
    private string _relayServerInfo = string.Empty;

    /// <summary>
    /// Observable log entries for UI binding
    /// </summary>
    public ObservableCollection<LogEntry> Logs => Logger.Logs;

    public MainViewModel()
    {
        AppConfig.Instance.Load();
        var config = AppConfig.Instance;
        RelayServerInfo = $"Relay: {config.Relay.Host}:{config.Relay.Port}";
    }

    /// <summary>
    /// Start as Controller
    /// </summary>
    [RelayCommand]
    private async Task StartAsControllerAsync()
    {
        CurrentMode = AppMode.Controller;
        StatusText = "Starting controller...";
        
        try
        {
            _cancellationTokenSource = new CancellationTokenSource();
            _controllerService = new ControllerService();

            _controllerService.OnSessionCreated += (token) =>
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    SessionToken = token;
                    StatusText = $"Controller running - Token: {token}";
                });
            };

            _controllerService.OnConnectionStatusChanged += (connected) =>
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    IsConnected = connected;
                    if (!connected)
                    {
                        StatusText = "Disconnected - Reconnecting...";
                    }
                });
            };

            _controllerService.OnProcessCountChanged += (count) =>
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    ProcessCount = count;
                });
            };

            _controllerService.OnVgcProcessStatusChanged += (running) =>
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    VgcProcessRunning = running;
                });
            };

            _controllerService.OnVgcServiceStatusChanged += (status) =>
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    VgcServiceStatus = status;
                });
            };

            await _controllerService.StartAsync(_cancellationTokenSource.Token);
            IsRunning = true;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to start controller", ex);
            StatusText = $"Error: {ex.Message}";
            CurrentMode = AppMode.Selection;
        }
    }

    /// <summary>
    /// Start as Follower
    /// </summary>
    [RelayCommand]
    private async Task StartAsFollowerAsync()
    {
        CurrentMode = AppMode.Follower;
        StatusText = "Starting follower...";

        try
        {
            _cancellationTokenSource = new CancellationTokenSource();
            _followerService = new FollowerService();

            _followerService.OnSessionJoined += (token) =>
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    SessionToken = token;
                    StatusText = $"Follower running - Session: {token}";
                });
            };

            _followerService.OnConnectionStatusChanged += (connected) =>
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    IsConnected = connected;
                    if (!connected)
                    {
                        StatusText = "Disconnected - Reconnecting...";
                    }
                });
            };

            // Use provided token or null for auto-join
            var token = string.IsNullOrWhiteSpace(FollowerToken) ? null : FollowerToken.Trim();
            await _followerService.StartAsync(token, _cancellationTokenSource.Token);
            IsRunning = true;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to start follower", ex);
            StatusText = $"Error: {ex.Message}";
            CurrentMode = AppMode.Selection;
        }
    }

    /// <summary>
    /// Stop current service and return to selection
    /// </summary>
    [RelayCommand]
    public async Task StopAsync()
    {
        StatusText = "Stopping...";
        _cancellationTokenSource?.Cancel();

        try
        {
            if (_controllerService != null)
            {
                await _controllerService.StopAsync();
                _controllerService.Dispose();
                _controllerService = null;
            }

            if (_followerService != null)
            {
                await _followerService.StopAsync();
                _followerService.Dispose();
                _followerService = null;
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Error stopping service", ex);
        }

        IsRunning = false;
        IsConnected = false;
        SessionToken = string.Empty;
        ProcessCount = 0;
        CurrentMode = AppMode.Selection;
        StatusText = "Select a mode to start";
    }

    /// <summary>
    /// Copy session token to clipboard
    /// </summary>
    [RelayCommand]
    private void CopyToken()
    {
        if (!string.IsNullOrEmpty(SessionToken))
        {
            Clipboard.SetText(SessionToken);
            _logger.Info("Session token copied to clipboard");
        }
    }

    /// <summary>
    /// Clear log entries
    /// </summary>
    [RelayCommand]
    private void ClearLogs()
    {
        Logger.Clear();
    }

    public void Dispose()
    {
        _cancellationTokenSource?.Cancel();
        _controllerService?.Dispose();
        _followerService?.Dispose();
    }
}
