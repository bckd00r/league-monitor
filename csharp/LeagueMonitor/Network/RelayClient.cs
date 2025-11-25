using System.Net.WebSockets;
using System.Text;
using LeagueMonitor.Configuration;
using LeagueMonitor.Core;
using Newtonsoft.Json;

namespace LeagueMonitor.Network;

/// <summary>
/// WebSocket client for relay server communication
/// </summary>
public class RelayClient : IDisposable
{
    private readonly Logger _logger;
    private readonly ClientRole _role;
    private readonly string _serverUrl;
    
    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _cancellationTokenSource;
    private Task? _receiveTask;
    
    private string? _sessionToken;
    private bool _isConnected;
    private readonly int _reconnectInterval = 5000;

    // Events
    public event Action? OnConnected;
    public event Action? OnDisconnected;
    public event Action<string>? OnSessionCreated;
    public event Action<string, SessionInfo?>? OnJoined;
    public event Action? OnImmediateStart;
    public event Action? OnClientRestarted;
    public event Action<ClientStatus>? OnStatusUpdate;
    public event Func<Task<ClientStatus>>? OnStatusRequest;
    public event Action<bool>? OnFollowerGameStatusChanged; // Controller receives this
    public event Action<string>? OnError;

    public bool IsConnected => _isConnected;
    public string? SessionToken => _sessionToken;

    public RelayClient(ClientRole role)
    {
        _role = role;
        _logger = new Logger($"RelayClient-{role}");
        _serverUrl = AppConfig.Instance.GetRelayUrl();
    }

    /// <summary>
    /// Connect to relay server
    /// </summary>
    public async Task ConnectAsync(string? sessionToken = null, CancellationToken ct = default)
    {
        _sessionToken = sessionToken;
        _cancellationTokenSource = CancellationTokenSource.CreateLinkedTokenSource(ct);

        await ConnectInternalAsync();
    }

    private async Task ConnectInternalAsync()
    {
        while (!_cancellationTokenSource!.Token.IsCancellationRequested)
        {
            try
            {
                _logger.Info($"Connecting to relay server at {_serverUrl}...");
                
                _webSocket?.Dispose();
                _webSocket = new ClientWebSocket();

                await _webSocket.ConnectAsync(new Uri(_serverUrl), _cancellationTokenSource.Token);

                _isConnected = true;
                _logger.Success("Connected to relay server");
                OnConnected?.Invoke();

                // Start receive loop
                _receiveTask = ReceiveLoopAsync();

                // If token provided, join session; otherwise create/auto-join
                if (!string.IsNullOrEmpty(_sessionToken))
                {
                    await JoinSessionAsync(_sessionToken);
                }
                else if (_role == ClientRole.controller)
                {
                    _logger.Info("No token provided, attempting auto-join by IP...");
                    await JoinSessionAsync(null);
                }
                else
                {
                    _logger.Info("No token provided, attempting auto-join by IP...");
                    await JoinSessionAsync(null);
                }

                // Wait for receive task to complete (disconnection)
                await _receiveTask;
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.Error("Connection error", ex);
            }

            _isConnected = false;
            OnDisconnected?.Invoke();

            if (!_cancellationTokenSource.Token.IsCancellationRequested)
            {
                _logger.Info($"Reconnecting in {_reconnectInterval / 1000} seconds...");
                await Task.Delay(_reconnectInterval, _cancellationTokenSource.Token);
            }
        }
    }

    private async Task ReceiveLoopAsync()
    {
        var buffer = new byte[8192];

        try
        {
            while (_webSocket?.State == WebSocketState.Open && !_cancellationTokenSource!.Token.IsCancellationRequested)
            {
                var result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), _cancellationTokenSource.Token);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.Warn("Server closed connection");
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    await HandleMessageAsync(message);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException ex)
        {
            _logger.Error("WebSocket error", ex);
        }
        catch (Exception ex)
        {
            _logger.Error("Receive error", ex);
        }

        _isConnected = false;
    }

    private async Task HandleMessageAsync(string messageJson)
    {
        try
        {
            var message = JsonConvert.DeserializeObject<RelayMessage>(messageJson);
            if (message == null) return;

            switch (message.Type)
            {
                case "CONNECTED":
                    _logger.Info($"Client ID: {message.ClientId}");
                    break;

                case "SESSION_CREATED":
                    _sessionToken = message.Token;
                    _logger.Success($"Session created: {message.Token}");
                    OnSessionCreated?.Invoke(message.Token!);
                    
                    // Auto-join own session
                    await JoinSessionAsync(message.Token);
                    break;

                case "JOINED":
                    _sessionToken = message.SessionToken;
                    _logger.Success($"Joined session as {message.Role}");
                    
                    if (message.AutoJoined == true)
                    {
                        _logger.Success("Auto-joined session by IP address");
                    }
                    
                    _logger.Info($"Session: {message.SessionToken}");
                    
                    if (message.SessionInfo != null)
                    {
                        _logger.Info($"Controller: {(message.SessionInfo.HasController ? "Yes" : "No")}");
                        _logger.Info($"Followers: {message.SessionInfo.FollowerCount}");
                    }
                    
                    OnJoined?.Invoke(message.SessionToken!, message.SessionInfo);
                    break;

                case "IMMEDIATE_START":
                    _logger.Info("Received immediate start command from controller!");
                    OnImmediateStart?.Invoke();
                    break;

                case "IMMEDIATE_START_BROADCASTED":
                    _logger.Success($"Immediate start command sent to {message.SentTo} follower(s)");
                    break;

                case "CLIENT_RESTARTED":
                    _logger.Info("Received CLIENT_RESTARTED message from controller!");
                    OnClientRestarted?.Invoke();
                    break;

                case "RESTART_BROADCASTED":
                    _logger.Success($"Restart command sent to {message.SentTo} follower(s)");
                    break;

                case "GAME_STATUS":
                    _logger.Info($"Received game status from follower: {(message.GameRunning == true ? "RUNNING" : "STOPPED")}");
                    OnFollowerGameStatusChanged?.Invoke(message.GameRunning == true);
                    break;

                case "GAME_STATUS_RECEIVED":
                    _logger.Success("Game status sent to controller");
                    break;

                case "STATUS_UPDATE":
                    _logger.Info("Received status update from controller");
                    if (message.Status != null)
                    {
                        _logger.Info($"Controller client is {(message.Status.ClientRunning ? "RUNNING" : "NOT RUNNING")}");
                        if (message.Status.ProcessCount > 0)
                        {
                            _logger.Info($"Controller process count: {message.Status.ProcessCount}");
                        }
                        OnStatusUpdate?.Invoke(message.Status);
                    }
                    break;

                case "STATUS_REQUEST":
                    _logger.Info("Controller status requested");
                    if (OnStatusRequest != null)
                    {
                        var status = await OnStatusRequest.Invoke();
                        await SendStatusAsync(status.ClientRunning, status.ProcessCount);
                    }
                    break;

                case "HEARTBEAT_ACK":
                    // Silent
                    break;

                case "ERROR":
                    _logger.Error($"Server error: {message.Message}");
                    OnError?.Invoke(message.Message ?? "Unknown error");
                    
                    // Handle session not found
                    if (message.Message?.Contains("Session not found") == true ||
                        message.Message?.Contains("No session found") == true)
                    {
                        if (_role == ClientRole.follower && string.IsNullOrEmpty(_sessionToken))
                        {
                            _logger.Info("Controller not found yet, will retry auto-join...");
                            await Task.Delay(5000);
                            await JoinSessionAsync(null);
                        }
                    }
                    break;

                default:
                    _logger.Info($"Received: {message.Type}");
                    break;
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to handle message", ex);
        }
    }

    private async Task SendAsync(string message)
    {
        if (_webSocket?.State != WebSocketState.Open)
        {
            _logger.Warn("Cannot send: not connected");
            return;
        }

        try
        {
            var bytes = Encoding.UTF8.GetBytes(message);
            await _webSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, 
                _cancellationTokenSource?.Token ?? CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to send message", ex);
        }
    }

    private async Task JoinSessionAsync(string? token)
    {
        await SendAsync(MessageBuilder.Join(token, _role));
    }

    /// <summary>
    /// Send heartbeat to keep connection alive
    /// </summary>
    public async Task SendHeartbeatAsync()
    {
        await SendAsync(MessageBuilder.Heartbeat());
    }

    /// <summary>
    /// Broadcast immediate start command (controller only)
    /// </summary>
    public async Task BroadcastImmediateStartAsync()
    {
        if (!_isConnected)
        {
            _logger.Warn("Not connected, cannot broadcast immediate start");
            return;
        }
        await SendAsync(MessageBuilder.ImmediateStart());
    }

    /// <summary>
    /// Broadcast restart command (controller only)
    /// </summary>
    public async Task BroadcastRestartAsync()
    {
        if (!_isConnected)
        {
            _logger.Warn("Not connected, cannot broadcast restart");
            return;
        }
        await SendAsync(MessageBuilder.Restart());
    }

    /// <summary>
    /// Send status update (controller only)
    /// </summary>
    public async Task SendStatusAsync(bool clientRunning, int processCount)
    {
        if (!_isConnected)
        {
            _logger.Warn("Not connected, cannot send status");
            return;
        }
        await SendAsync(MessageBuilder.StatusUpdate(clientRunning, processCount));
    }

    /// <summary>
    /// Request status from controller (follower only)
    /// </summary>
    public async Task RequestStatusAsync()
    {
        if (!_isConnected)
        {
            _logger.Warn("Not connected, cannot request status");
            return;
        }
        await SendAsync(MessageBuilder.StatusRequest());
    }

    /// <summary>
    /// Send game status to controller (follower only)
    /// </summary>
    public async Task SendGameStatusAsync(bool gameRunning)
    {
        if (!_isConnected)
        {
            _logger.Warn("Not connected, cannot send game status");
            return;
        }

        if (_role != ClientRole.follower)
        {
            _logger.Warn("Only followers can send game status");
            return;
        }

        _logger.Info($"Sending game status: {(gameRunning ? "RUNNING" : "STOPPED")}");
        await SendAsync(MessageBuilder.GameStatus(gameRunning));
    }

    /// <summary>
    /// Disconnect from relay server
    /// </summary>
    public async Task DisconnectAsync()
    {
        _cancellationTokenSource?.Cancel();

        if (_webSocket?.State == WebSocketState.Open)
        {
            try
            {
                await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disconnecting", CancellationToken.None);
            }
            catch { }
        }

        _isConnected = false;
    }

    public void Dispose()
    {
        _cancellationTokenSource?.Cancel();
        _cancellationTokenSource?.Dispose();
        _webSocket?.Dispose();
    }
}
