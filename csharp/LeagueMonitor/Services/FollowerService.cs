using LeagueMonitor.Configuration;
using LeagueMonitor.Core;
using LeagueMonitor.Network;

namespace LeagueMonitor.Services;

/// <summary>
/// Follower service - receives commands from controller and manages local League Client
/// </summary>
public class FollowerService : IDisposable
{
    private readonly Logger _logger = new("Follower");
    private readonly FollowerConfig _config;
    private readonly RelayClient _relayClient;
    
    private CancellationTokenSource? _cancellationTokenSource;
    private ProcessWatcher? _gameWatcher;
    private ProcessWatcher? _clientWatcher;
    private Task? _heartbeatTask;
    
    private bool _isRunning;
    private bool _isStartingClient; // Flag: currently in process of starting client
    private bool _waitingForStatusToStart; // Flag: waiting for controller status to auto-start

    // Events
    public event Action<string>? OnSessionJoined;
    public event Action<bool>? OnConnectionStatusChanged;

    public bool IsRunning => _isRunning;
    public string? SessionToken => _relayClient.SessionToken;

    public FollowerService()
    {
        _config = AppConfig.Instance.Follower;
        _relayClient = new RelayClient(ClientRole.follower);
        
        SetupEventHandlers();
    }

    private void SetupEventHandlers()
    {
        _relayClient.OnConnected += () => OnConnectionStatusChanged?.Invoke(true);
        _relayClient.OnDisconnected += () => OnConnectionStatusChanged?.Invoke(false);

        _relayClient.OnJoined += (token, info) =>
        {
            OnSessionJoined?.Invoke(token);
        };

        _relayClient.OnImmediateStart += async () =>
        {
            await HandleImmediateStartAsync();
        };

        _relayClient.OnClientRestarted += async () =>
        {
            await HandleClientRestartedAsync();
        };

        _relayClient.OnStatusUpdate += async (status) =>
        {
            await HandleStatusUpdateAsync(status);
        };
    }

    /// <summary>
    /// Start follower service
    /// </summary>
    public async Task StartAsync(string? sessionToken = null, CancellationToken ct = default)
    {
        if (_isRunning) return;

        _logger.Info("Starting League Client Follower...");
        
        if (!string.IsNullOrEmpty(sessionToken))
        {
            _logger.Info($"Session token: {sessionToken}");
        }
        else
        {
            _logger.Info("No token provided - will attempt auto-join by IP address");
        }

        _cancellationTokenSource = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _isRunning = true;

        // Connect to relay server
        _ = _relayClient.ConnectAsync(sessionToken, _cancellationTokenSource.Token);

        // Wait for connection
        await Task.Delay(2000, ct);

        // Request initial status
        _ = RequestInitialStatusAsync();

        // Start event-driven process watchers
        StartProcessWatchers();
        
        // Start heartbeat
        _heartbeatTask = HeartbeatLoopAsync(_cancellationTokenSource.Token);

        _logger.Success("Follower is running with event-driven monitoring!");
        _logger.Info("Waiting for commands from controller...");
    }

    /// <summary>
    /// Stop follower service
    /// </summary>
    public async Task StopAsync()
    {
        if (!_isRunning) return;

        _logger.Info("Stopping follower...");
        _cancellationTokenSource?.Cancel();

        // Stop process watchers
        _gameWatcher?.Dispose();
        _clientWatcher?.Dispose();

        if (_heartbeatTask != null)
        {
            try { await _heartbeatTask; } catch { }
        }

        await _relayClient.DisconnectAsync();
        _isRunning = false;
        _logger.Info("Follower stopped");
    }

    private async Task RequestInitialStatusAsync()
    {
        // Wait for session to be joined
        var retries = 0;
        while (_relayClient.SessionToken == null && retries < 10)
        {
            await Task.Delay(1000);
            retries++;
        }

        if (_relayClient.IsConnected && _relayClient.SessionToken != null)
        {
            _logger.Info("Requesting initial status from controller...");
            await _relayClient.RequestStatusAsync();
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

    /// <summary>
    /// Start WMI process watchers for instant event notifications
    /// </summary>
    private void StartProcessWatchers()
    {
        // Watch for game process - when it starts, kill LeagueClient; when it stops, check if we should start
        _gameWatcher = new ProcessWatcher("League of Legends", "League Of Legends");
        
        _gameWatcher.ProcessStarted += async (s, e) =>
        {
            _logger.Warn($"League game started (PID: {e.ProcessId})");
            
            // Kill LeagueClient if running (local only)
            if (LeagueUtils.IsLeagueClientRunning())
            {
                _logger.Info("Killing LeagueClient because game started...");
                LeagueUtils.KillLeagueClient();
                _logger.Success("LeagueClient closed");
            }
            
            // Notify controller that game is running
            if (_relayClient.IsConnected)
            {
                await _relayClient.SendGameStatusAsync(true);
            }
        };
        
        _gameWatcher.ProcessStopped += async (s, e) =>
        {
            _logger.Info($"League game stopped (PID: {e.ProcessId})");
            
            // Notify controller that game stopped
            if (_relayClient.IsConnected)
            {
                await _relayClient.SendGameStatusAsync(false);
            }
            
            // Check if we should start LeagueClient
            await CheckAndStartClientAsync();
        };
        
        _gameWatcher.Start();

        // Watch for LeagueClient - when it stops unexpectedly, check controller status
        _clientWatcher = new ProcessWatcher("LeagueClient");
        
        _clientWatcher.ProcessStopped += async (s, e) =>
        {
            _logger.Info($"LeagueClient stopped (PID: {e.ProcessId})");
            
            // Wait a moment then check if we should restart
            await Task.Delay(500);
            
            if (!LeagueUtils.IsLeagueClientRunning() && !LeagueUtils.IsLeagueGameRunning())
            {
                await CheckAndStartClientAsync();
            }
        };
        
        _clientWatcher.Start();
        
        _logger.Info("Event-driven process watchers started");
    }

    /// <summary>
    /// Check controller status and start client if appropriate
    /// </summary>
    private async Task CheckAndStartClientAsync()
    {
        if (_isStartingClient) return;
        if (LeagueUtils.IsLeagueGameRunning()) return;
        if (LeagueUtils.IsLeagueClientRunning()) return;
        if (!_relayClient.IsConnected || _relayClient.SessionToken == null) return;

        if (!_waitingForStatusToStart)
        {
            _logger.Info("Checking controller status...");
            _waitingForStatusToStart = true;
            await _relayClient.RequestStatusAsync();
        }
    }

    private async Task HandleStatusUpdateAsync(ClientStatus status)
    {
        _logger.Info($"Controller status received: LeagueClient is {(status.ClientRunning ? "RUNNING" : "NOT RUNNING")}, Process count: {status.ProcessCount}");

        // If we were waiting for status to start and controller has client running
        if (_waitingForStatusToStart)
        {
            _waitingForStatusToStart = false;

            if (status.ClientRunning)
            {
                // Controller has client running, check if we should start ours
                var isGameRunning = LeagueUtils.IsLeagueGameRunning();
                var isClientRunning = LeagueUtils.IsLeagueClientRunning();

                if (!isGameRunning && !isClientRunning && !_isStartingClient)
                {
                    _logger.Info("Controller has LeagueClient running. Starting LeagueClient on follower...");
                    await LaunchClientAsync();
                }
                else if (isGameRunning)
                {
                    _logger.Info("Controller has client running, but game is running on follower. Not starting LeagueClient.");
                }
                else if (isClientRunning)
                {
                    _logger.Info("Controller has client running, LeagueClient already running on follower.");
                }
                else if (_isStartingClient)
                {
                    _logger.Info("Controller has client running, but already starting client on follower.");
                }
            }
            else
            {
                _logger.Info("Controller LeagueClient is not running. Follower will not start LeagueClient.");
            }
        }
    }

    private async Task LaunchClientAsync()
    {
        if (_isStartingClient) return; // Already starting
        
        _isStartingClient = true;
        var clientProcessName = LeagueUtils.GetLeagueClientProcessName();

        try
        {
            _logger.Info("Launching LeagueClient...");
            var success = LeagueUtils.LaunchLeagueClient();

            if (success)
            {
                _logger.Success("LeagueClient launched successfully");

                _logger.Info("Waiting for LeagueClient process to appear...");
                var appeared = await ProcessManager.WaitForProcessAsync(clientProcessName, 15000);

                if (appeared)
                {
                    _logger.Success("LeagueClient process detected");
                }
                else
                {
                    _logger.Warn("LeagueClient process not detected after 15 seconds");
                }
            }
            else
            {
                _logger.Error("Failed to launch LeagueClient");
            }
        }
        finally
        {
            _isStartingClient = false;
        }
    }

    private async Task HandleImmediateStartAsync()
    {
        _logger.Info("IMMEDIATE START command received from controller!");

        // Check if already starting
        if (_isStartingClient)
        {
            _logger.Info("Already starting client, skipping.");
            return;
        }

        // Check if game is running
        if (LeagueUtils.IsLeagueGameRunning())
        {
            _logger.Info("League game is running, skipping LeagueClient launch");
            return;
        }

        // Kill existing client if running (restart scenario)
        if (LeagueUtils.IsLeagueClientRunning())
        {
            _logger.Info("LeagueClient is already running, killing and restarting...");
            LeagueUtils.KillLeagueClient();
            await Task.Delay(1000); // Brief wait for process to terminate
        }

        await LaunchClientAsync();
    }

    private async Task HandleClientRestartedAsync()
    {
        _logger.Info("CLIENT_RESTARTED command received from controller (VGC exit code 185)!");

        // Check if already starting
        if (_isStartingClient)
        {
            _logger.Info("Already starting client, skipping.");
            return;
        }

        // Check if game is running
        if (LeagueUtils.IsLeagueGameRunning())
        {
            _logger.Info("League game is running, skipping LeagueClient launch");
            return;
        }

        // Kill existing client if running
        if (LeagueUtils.IsLeagueClientRunning())
        {
            _logger.Info("LeagueClient is already running, killing and restarting...");
            LeagueUtils.KillLeagueClient();
            await Task.Delay(1000); // Brief wait for process to terminate
        }

        await LaunchClientAsync();
    }

    public void Dispose()
    {
        _cancellationTokenSource?.Cancel();
        _cancellationTokenSource?.Dispose();
        _relayClient.Dispose();
    }
}
