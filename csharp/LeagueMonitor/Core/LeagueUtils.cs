using System.IO;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;
using Newtonsoft.Json.Linq;

namespace LeagueMonitor.Core;

/// <summary>
/// League of Legends installation utilities
/// </summary>
public static class LeagueUtils
{
    private static readonly Logger _logger = new("LeagueUtils");

    private static readonly string[] LeagueClientProcessNames = ["LeagueClient"];
    private static readonly string[] LeagueGameProcessNames = 
    [
        "League Of Legends",
        "League of Legends"
    ];
    private static readonly string[] RiotClientProcessNames = ["RiotClientServices"];

    /// <summary>
    /// Get League Client process name
    /// </summary>
    public static string GetLeagueClientProcessName() => "LeagueClient";

    /// <summary>
    /// Get Riot Client Services process name
    /// </summary>
    public static string GetRiotClientServicesProcessName() => "RiotClientServices";

    /// <summary>
    /// Get all possible League game process names
    /// </summary>
    public static string[] GetLeagueGameProcessNames() => LeagueGameProcessNames;

    /// <summary>
    /// Get League of Legends installation path from YAML settings
    /// </summary>
    public static string? GetInstallPath()
    {
        try
        {
            var programData = Environment.GetEnvironmentVariable("PROGRAMDATA") ?? @"C:\ProgramData";
            var yamlPath = Path.Combine(programData, "Riot Games", "Metadata", "league_of_legends.live", 
                "league_of_legends.live.product_settings.yaml");

            if (File.Exists(yamlPath))
            {
                var content = File.ReadAllText(yamlPath);
                var deserializer = new DeserializerBuilder()
                    .WithNamingConvention(UnderscoredNamingConvention.Instance)
                    .Build();

                var data = deserializer.Deserialize<Dictionary<string, object>>(content);
                if (data.TryGetValue("product_install_full_path", out var installPath))
                {
                    var path = installPath?.ToString();
                    if (!string.IsNullOrEmpty(path))
                    {
                        _logger.Info($"Found League installation via YAML: {path}");
                        return path;
                    }
                }
            }

            // Fallback to default path
            var defaultPath = @"C:\Riot Games\League of Legends";
            if (Directory.Exists(defaultPath))
            {
                _logger.Info($"Using default Windows path: {defaultPath}");
                return defaultPath;
            }

            _logger.Error("Could not find League of Legends installation");
            return null;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to get install path", ex);
            return null;
        }
    }

    /// <summary>
    /// Get Riot Client executable path from RiotClientInstalls.json
    /// </summary>
    public static string? GetRiotClientPath()
    {
        try
        {
            var programData = Environment.GetEnvironmentVariable("PROGRAMDATA") ?? @"C:\ProgramData";
            var installsPath = Path.Combine(programData, "Riot Games", "RiotClientInstalls.json");

            if (File.Exists(installsPath))
            {
                try
                {
                    var content = File.ReadAllText(installsPath);
                    // Clean content: remove BOM, trim whitespace
                    content = content.Trim().TrimStart('\uFEFF');
                    
                    // Handle trailing commas
                    content = System.Text.RegularExpressions.Regex.Replace(content, @",\s*}", "}");
                    content = System.Text.RegularExpressions.Regex.Replace(content, @",\s*]", "]");

                    var json = JObject.Parse(content);

                    // Try different paths
                    string?[] paths = [
                        json["rc_default"]?.ToString(),
                        json["rc_live"]?.ToString(),
                        json["rc_beta"]?.ToString()
                    ];

                    foreach (var path in paths)
                    {
                        if (!string.IsNullOrEmpty(path) && File.Exists(path))
                        {
                            _logger.Info($"Found Riot Client: {path}");
                            return path;
                        }
                    }
                }
                catch (Exception parseEx)
                {
                    _logger.Warn($"Failed to parse RiotClientInstalls.json: {parseEx.Message}");
                }
            }

            // Fallback
            var defaultPath = @"C:\Riot Games\Riot Client\RiotClientServices.exe";
            if (File.Exists(defaultPath))
            {
                return defaultPath;
            }

            _logger.Error("Could not find Riot Client");
            return null;
        }
        catch (Exception ex)
        {
            _logger.Error("Failed to get Riot Client path", ex);
            return null;
        }
    }

    /// <summary>
    /// Launch League Client via Riot Client
    /// </summary>
    public static bool LaunchLeagueClient(string[] additionalArgs = null!)
    {
        var clientPath = GetRiotClientPath();
        if (string.IsNullOrEmpty(clientPath))
        {
            _logger.Error("Cannot launch client: path not found");
            return false;
        }

        // Default args for launching League
        var args = new List<string>
        {
            "--launch-product=league_of_legends",
            "--launch-patchline=live"
        };

        if (additionalArgs != null)
        {
            args.AddRange(additionalArgs);
        }

        return ProcessManager.LaunchApp(clientPath, args.ToArray());
    }

    /// <summary>
    /// Check if League Client is running
    /// </summary>
    public static bool IsLeagueClientRunning()
    {
        return ProcessManager.IsProcessRunning(GetLeagueClientProcessName());
    }

    /// <summary>
    /// Check if League game is running
    /// </summary>
    public static bool IsLeagueGameRunning()
    {
        return ProcessManager.IsAnyProcessRunning(GetLeagueGameProcessNames());
    }

    /// <summary>
    /// Kill League Client and related processes
    /// </summary>
    public static void KillLeagueClient()
    {
        ProcessManager.KillProcessByName(GetLeagueClientProcessName());
        ProcessManager.KillProcessByName(GetRiotClientServicesProcessName());
    }

    /// <summary>
    /// Kill League game process
    /// </summary>
    public static int KillLeagueGame()
    {
        return ProcessManager.KillProcessByMultipleNames(GetLeagueGameProcessNames());
    }
}
