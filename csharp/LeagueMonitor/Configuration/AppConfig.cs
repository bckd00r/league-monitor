using Microsoft.Extensions.Configuration;

namespace LeagueMonitor.Configuration;

/// <summary>
/// Relay server configuration
/// </summary>
public class RelayConfig
{
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 8080;
}

/// <summary>
/// Controller mode configuration
/// </summary>
public class ControllerConfig
{
    public int MonitorInterval { get; set; } = 5000;
    public bool KillGameProcess { get; set; } = true;
    public int RestartCooldown { get; set; } = 30000;
    public int ProcessCountThreshold { get; set; } = 8;
}

/// <summary>
/// Follower mode configuration
/// </summary>
public class FollowerConfig
{
    public int RestartDelay { get; set; } = 30000;
    public int StartCooldown { get; set; } = 30000;
    public int GameCheckInterval { get; set; } = 5000;
    public int GameRunningCheckInterval { get; set; } = 120000;
    public int GameRunningRestartCooldown { get; set; } = 600000;
}

/// <summary>
/// Application configuration manager
/// </summary>
public class AppConfig
{
    private static AppConfig? _instance;
    private static readonly object _lock = new();

    public RelayConfig Relay { get; private set; } = new();
    public ControllerConfig Controller { get; private set; } = new();
    public FollowerConfig Follower { get; private set; } = new();

    private AppConfig() { }

    /// <summary>
    /// Get singleton instance
    /// </summary>
    public static AppConfig Instance
    {
        get
        {
            if (_instance == null)
            {
                lock (_lock)
                {
                    _instance ??= new AppConfig();
                }
            }
            return _instance;
        }
    }

    /// <summary>
    /// Load configuration from appsettings.json
    /// </summary>
    public void Load()
    {
        try
        {
            var builder = new ConfigurationBuilder()
                .SetBasePath(AppDomain.CurrentDomain.BaseDirectory)
                .AddJsonFile("appsettings.json", optional: true, reloadOnChange: true);

            var configuration = builder.Build();

            configuration.GetSection("Relay").Bind(Relay);
            configuration.GetSection("Controller").Bind(Controller);
            configuration.GetSection("Follower").Bind(Follower);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to load config: {ex.Message}");
        }
    }

    /// <summary>
    /// Get WebSocket URL for relay server
    /// </summary>
    public string GetRelayUrl() => $"ws://{Relay.Host}:{Relay.Port}";
}
