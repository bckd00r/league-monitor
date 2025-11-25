using LeagueMonitor.Configuration;
using LeagueMonitor.Core;
using LeagueMonitor.Network;

namespace LeagueMonitor.Services;

/// <summary>
/// Controller service - monitors League Client and broadcasts commands to followers
/// </summary>
public class ControllerService : IDisposable
{
    private readonly Logger _logger = new("Controller");
    private readonly ControllerConfig _config;
    private readonly RelayClient _relayClient;
    
    private CancellationTokenSource? _cancellationTokenSource;
    private ProcessWatcher? _clientWatcher;
    private ProcessWatcher? _gameWatcher;
    private ProcessWatcher? _leagueProcessWatcher;
    private ProcessWatcher? _vgcWatcher;
    private Task? _vgcCheckTask;
    private Task? _heartbeatTask;
    private Task? _gameRunningRestartTask;
    private CancellationTokenSource? _gameRunningRestartCts;
    private bool _lastVgcProcessStatus;
    private string _lastVgcServiceStatus = "";
    private bool _followerGameRunning;
    
    private bool _isRunning;
    private bool _isRestartingClient; // Flag: currently restarting client
    private bool _vgcRestartTriggered;
    private bool _immediateStartSent; // Flag: already sent immediate start
    private int _currentProcessCount;

    // Events
    public event Action<string>? OnSessionCreated;
    public event Action<bool>? OnConnectionStatusChanged;
    public event Action<int>? OnProcessCountChanged;
    public event Action<bool>? OnVgcProcessStatusChanged;
    public event Action<string>? OnVgcServiceStatusChanged;

    public bool IsRunning => _isRunning;
    public string? SessionToken => _relayClient.SessionToken;

    public ControllerService()
    {
        _config = AppConfig.Instance.Controller;
        _relayClient = new RelayClient(ClientRole.controller);
        
        SetupEventHandlers();
    }

    private void SetupEventHandlers()
    {
        _relayClient.OnConnected += () => OnConnectionStatusChanged?.Invoke(true);
        _relayClient.OnDisconnected += () => OnConnectionStatusChanged?.Invoke(false);
        
        _relayClient.OnSessionCreated += (token) =>
        {
            _logger.Success(new string('=', 60));
            _logger.Success($"SESSION TOKEN: {token}");
            _logger.Success("Share this token with follower clients to connect");
            _logger.Success(new string('=', 60));
            OnSessionCreated?.Invoke(token);
        };

        _relayClient.OnJoined += (token, info) =>
        {
            OnSessionCreated?.Invoke(token);
        };

        _relayClient.OnStatusRequest += async () =>
        {
            var isRunning = LeagueUtils.IsLeagueClientRunning();
            var processCount = ProcessManager.GetLeagueProcessCount();
            _logger.Info($"Status check: LeagueClient is {(isRunning ? "RUNNING" : "NOT RUNNING")}, Process count: {processCount}");
            return new ClientStatus { ClientRunning = isRunning, ProcessCount = processCount };
        };

        _relayClient.OnFollowerGameStatusChanged += (gameRunning) =>
        {
            HandleFollowerGameStatusChanged(gameRunning);
        };
    }

    /// <summary>
    /// Handle follower game status change
    /// </summary>
    private void HandleFollowerGameStatusChanged(bool gameRunning)
    {
        _followerGameRunning = gameRunning;

        if (gameRunning)
        {
            _logger.Warn("Follower game is RUNNING - starting periodic restart (every 5 minutes)");
            StartGameRunningRestartLoop();
        }
        else
        {
            _logger.Info("Follower game STOPPED - stopping periodic restart");
            StopGameRunningRestartLoop();
        }
    }

    /// <summary>
    /// Start periodic restart loop when follower game is running
    /// </summary>
    private void StartGameRunningRestartLoop()
    {
        // Cancel any existing loop
        StopGameRunningRestartLoop();

        _gameRunningRestartCts = new CancellationTokenSource();
        _gameRunningRestartTask = GameRunningRestartLoopAsync(_gameRunningRestartCts.Token);
    }

    /// <summary>
    /// Stop periodic restart loop
    /// </summary>
    private void StopGameRunningRestartLoop()
    {
        _gameRunningRestartCts?.Cancel();
        _gameRunningRestartCts?.Dispose();
        _gameRunningRestartCts = null;
    }

    /// <summary>
    /// Periodic restart loop - restarts VGC and LeagueClient every 5 minutes
    /// </summary>
    private async Task GameRunningRestartLoopAsync(CancellationToken ct)
    {
        // Initial restart immediately
        await RestartVgcAndClientAsync();

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Wait 5 minutes
                await Task.Delay(TimeSpan.FromMinutes(5), ct);

                if (!_followerGameRunning) break;

                _logger.Info("5 minutes passed, restarting VGC and LeagueClient...");
                await RestartVgcAndClientAsync();
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.Error("Game running restart loop error", ex);
            }
        }
    }

    /// <summary>
    /// Restart VGC and LeagueClient
    /// </summary>
    private async Task RestartVgcAndClientAsync()
    {
        _logger.Info("Killing VGC process...");
        VanguardService.KillVgcProcess();
        await VanguardService.WaitForVgcProcessToCloseAsync(10000);

        if (LeagueUtils.IsLeagueClientRunning())
        {
            _logger.Info("Killing LeagueClient...");
            LeagueUtils.KillLeagueClient();
            await ProcessManager.WaitForProcessToCloseAsync("LeagueClient", 10000);
        }

        _logger.Info("Restarting LeagueClient...");
        var success = LeagueUtils.LaunchLeagueClient();
        
        if (success)
        {
            _logger.Success("LeagueClient restarted");
            await ProcessManager.WaitForProcessAsync("LeagueClient", 15000);
        }
        else
        {
            _logger.Error("Failed to restart LeagueClient");
        }
    }

    /// <summary>
    /// Start controller service
    /// </summary>
    public async Task StartAsync(CancellationToken ct = default)
    {
        if (_isRunning) return;

        _logger.Info("Starting League Client Controller...");
        _cancellationTokenSource = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _isRunning = true;

        // Connect to relay server
        _ = _relayClient.ConnectAsync(null, _cancellationTokenSource.Token);

        // Wait for connection
        await Task.Delay(2000, ct);

        // Initial check - ensure LeagueClient is running
        await EnsureClientRunningAsync(_cancellationTokenSource.Token);

        // Start event-driven process watchers
        StartProcessWatchers();
        
        // Start VGC service check (still needs periodic check as it's a service)
        _vgcCheckTask = VgcCheckLoopAsync(_cancellationTokenSource.Token);
        
        // Start heartbeat
        _heartbeatTask = HeartbeatLoopAsync(_cancellationTokenSource.Token);

        _logger.Success("Controller is running with event-driven monitoring!");
    }

    /// <summary>
    /// Stop controller service
    /// </summary>
    public async Task StopAsync()
    {
        if (!_isRunning) return;

        _logger.Info("Stopping controller...");
        _cancellationTokenSource?.Cancel();

        // Stop process watchers
        _clientWatcher?.Dispose();
        _gameWatcher?.Dispose();
        _leagueProcessWatcher?.Dispose();
        _vgcWatcher?.Dispose();
        
        // Stop game running restart loop
        StopGameRunningRestartLoop();

        if (_vgcCheckTask != null)
        {
            try { await _vgcCheckTask; } catch { }
        }

        if (_heartbeatTask != null)
        {
            try { await _heartbeatTask; } catch { }
        }

        await _relayClient.DisconnectAsync();
        _isRunning = false;
        _logger.Info("Controller stopped");
    }

    /// <summary>
    /// Start WMI process watchers for instant event notifications
    /// </summary>
    private void StartProcessWatchers()
    {
        // Watch LeagueClient process
        _clientWatcher = new ProcessWatcher("LeagueClient");
        _clientWatcher.ProcessStarted += (s, e) =>
        {
            UpdateProcessCount();
        };
        _clientWatcher.ProcessStopped += async (s, e) =>
        {
            UpdateProcessCount();
            await OnLeagueClientStoppedAsync();
        };
        _clientWatcher.Start();

        // Watch LeagueClientUx process (indicates client is fully loaded)
        _leagueProcessWatcher = new ProcessWatcher("LeagueClientUx", "LeagueClientUxRender");
        _leagueProcessWatcher.ProcessStarted += (s, e) =>
        {
            UpdateProcessCount();
            CheckAndSendImmediateStart();
        };
        _leagueProcessWatcher.ProcessStopped += (s, e) =>
        {
            UpdateProcessCount();
            _immediateStartSent = false; // Reset so we can send again next time
        };
        _leagueProcessWatcher.Start();

        // Watch League game process (to kill it immediately)
        if (_config.KillGameProcess)
        {
            _gameWatcher = new ProcessWatcher("League of Legends", "League Of Legends");
            _gameWatcher.ProcessStarted += (s, e) =>
            {
                _logger.Warn($"League game detected (PID: {e.ProcessId}), killing immediately...");
                ProcessManager.KillProcess(e.ProcessId);
                _logger.Success("Game process killed");
            };
            _gameWatcher.Start();
        }

        // Watch VGC process
        _vgcWatcher = new ProcessWatcher("vgc");
        _vgcWatcher.ProcessStarted += (s, e) =>
        {
            UpdateVgcStatus();
        };
        _vgcWatcher.ProcessStopped += (s, e) =>
        {
            UpdateVgcStatus();
        };
        _vgcWatcher.Start();

        _logger.Info("Event-driven process watchers started");
        
        // Initial status check
        UpdateProcessCount();
        UpdateVgcStatus();
        CheckAndSendImmediateStart();
    }

    /// <summary>
    /// Update VGC process and service status
    /// </summary>
    private void UpdateVgcStatus()
    {
        // Check VGC process
        var vgcRunning = ProcessManager.IsProcessRunning("vgc");
        if (vgcRunning != _lastVgcProcessStatus)
        {
            _lastVgcProcessStatus = vgcRunning;
            OnVgcProcessStatusChanged?.Invoke(vgcRunning);
        }

        // Check VGC service status
        var serviceStatus = VanguardService.GetVgcServiceStatus();
        if (serviceStatus != _lastVgcServiceStatus)
        {
            _lastVgcServiceStatus = serviceStatus;
            OnVgcServiceStatusChanged?.Invoke(serviceStatus);
        }
    }

    /// <summary>
    /// Update current process count and notify UI
    /// </summary>
    private void UpdateProcessCount()
    {
        var count = ProcessManager.GetLeagueProcessCount();
        if (count != _currentProcessCount)
        {
            _currentProcessCount = count;
            _logger.Info($"Process count: {count}");
            OnProcessCountChanged?.Invoke(count);
        }
    }

    /// <summary>
    /// Check if process count threshold reached and send IMMEDIATE_START
    /// </summary>
    private async void CheckAndSendImmediateStart()
    {
        var count = ProcessManager.GetLeagueProcessCount();
        _currentProcessCount = count;
        OnProcessCountChanged?.Invoke(count);

        if (count >= _config.ProcessCountThreshold && !_immediateStartSent)
        {
            _logger.Success($"Process count {count} >= {_config.ProcessCountThreshold}! Sending IMMEDIATE_START...");
            _immediateStartSent = true;
            await _relayClient.BroadcastImmediateStartAsync();
        }
    }

    /// <summary>
    /// Handle LeagueClient process stopped event
    /// </summary>
    private async Task OnLeagueClientStoppedAsync()
    {
        // Wait a moment to ensure process is fully terminated
        await Task.Delay(500);

        // Check if it's really stopped (not just a child process)
        if (LeagueUtils.IsLeagueClientRunning())
        {
            _logger.Info("LeagueClient still running (was a child process)");
            return;
        }

        await EnsureClientRunningAsync(CancellationToken.None);
    }

    /// <summary>
    /// Ensure LeagueClient is running, restart if not
    /// </summary>
    private async Task EnsureClientRunningAsync(CancellationToken ct)
    {
        if (_isRestartingClient) return;
        if (LeagueUtils.IsLeagueClientRunning()) return;

        _isRestartingClient = true;

        try
        {
            _logger.Warn("LeagueClient is not running, restarting...");

            // Kill VGC process before restart
            _logger.Info("Terminating VGC process before restarting League Client...");
            VanguardService.KillVgcProcess();

            var success = LeagueUtils.LaunchLeagueClient();
            if (success)
            {
                _logger.Success("LeagueClient restarted successfully");

                _logger.Info("Waiting for LeagueClient process to appear...");
                await ProcessManager.WaitForProcessAsync("LeagueClient", 15000, ct);

                // Don't notify here - wait for process count to reach threshold
                // IMMEDIATE_START will be sent automatically when 8+ processes detected
                _logger.Info("Waiting for process count to reach threshold before notifying followers...");
            }
            else
            {
                _logger.Error("Failed to restart LeagueClient");
            }
        }
        finally
        {
            _isRestartingClient = false;
        }
    }

    /// <summary>
    /// VGC service check loop (services can't be watched via WMI the same way)
    /// </summary>
    private async Task VgcCheckLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(5000, ct); // Check VGC every 5 seconds

                // Update VGC status for UI
                UpdateVgcStatus();

                var exitCode185 = VanguardService.CheckVgcServiceExitCode185();

                if (exitCode185 && !_vgcRestartTriggered)
                {
                    _vgcRestartTriggered = true;
                    _logger.Warn("VGC service exit code 185 detected!");
                    
                    await VanguardService.WaitForVgcProcessToCloseAsync(120000, ct);
                    
                    // Kill and restart
                    if (LeagueUtils.IsLeagueClientRunning())
                    {
                        LeagueUtils.KillLeagueClient();
                    }
                    
                    await EnsureClientRunningAsync(ct);
                }
                else if (!exitCode185)
                {
                    _vgcRestartTriggered = false;
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.Error("VGC check error", ex);
            }
        }
    }

    private async Task HeartbeatLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(30000, ct);
                
                if (_relayClient.IsConnected)
                {
                    await _relayClient.SendHeartbeatAsync();
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.Error("Heartbeat error", ex);
            }
        }
    }

    private async Task NotifyFollowersAsync()
    {
        if (!_relayClient.IsConnected)
        {
            _logger.Warn("Not connected to relay server, cannot notify followers");
            return;
        }

        _logger.Info("Notifying followers that LeagueClient restarted...");
        await _relayClient.BroadcastRestartAsync();
        _logger.Success("Followers notified");
    }

    public void Dispose()
    {
        _cancellationTokenSource?.Cancel();
        _cancellationTokenSource?.Dispose();
        _relayClient.Dispose();
    }
}
