using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace LeagueMonitor.Network;

/// <summary>
/// Message types for relay server communication
/// </summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum MessageType
{
    // Connection
    CONNECTED,
    
    // Session management
    CREATE_SESSION,
    SESSION_CREATED,
    JOIN,
    JOINED,
    
    // Commands
    RESTART,
    CLIENT_RESTARTED,
    RESTART_BROADCASTED,
    IMMEDIATE_START,
    IMMEDIATE_START_BROADCASTED,
    
    // Status
    STATUS_REQUEST,
    STATUS_UPDATE,
    STATUS_BROADCASTED,
    
    // Game status (follower -> controller)
    GAME_STATUS,
    GAME_STATUS_RECEIVED,
    
    // Heartbeat
    HEARTBEAT,
    HEARTBEAT_ACK,
    
    // Error
    ERROR
}

/// <summary>
/// Client role in session
/// </summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum ClientRole
{
    controller,
    follower
}

/// <summary>
/// Base message structure
/// </summary>
public class RelayMessage
{
    [JsonProperty("type")]
    public string Type { get; set; } = string.Empty;

    [JsonProperty("timestamp")]
    public long? Timestamp { get; set; }

    [JsonProperty("clientId")]
    public string? ClientId { get; set; }

    [JsonProperty("message")]
    public string? Message { get; set; }

    [JsonProperty("sessionToken")]
    public string? SessionToken { get; set; }

    [JsonProperty("token")]
    public string? Token { get; set; }

    [JsonProperty("role")]
    public string? Role { get; set; }

    [JsonProperty("status")]
    public ClientStatus? Status { get; set; }

    [JsonProperty("sessionInfo")]
    public SessionInfo? SessionInfo { get; set; }

    [JsonProperty("sentTo")]
    public int? SentTo { get; set; }

    [JsonProperty("autoJoined")]
    public bool? AutoJoined { get; set; }

    [JsonProperty("gameRunning")]
    public bool? GameRunning { get; set; }
}

/// <summary>
/// Client status information
/// </summary>
public class ClientStatus
{
    [JsonProperty("clientRunning")]
    public bool ClientRunning { get; set; }

    [JsonProperty("processCount")]
    public int ProcessCount { get; set; }
}

/// <summary>
/// Session information
/// </summary>
public class SessionInfo
{
    [JsonProperty("token")]
    public string Token { get; set; } = string.Empty;

    [JsonProperty("createdAt")]
    public long CreatedAt { get; set; }

    [JsonProperty("hasController")]
    public bool HasController { get; set; }

    [JsonProperty("followerCount")]
    public int FollowerCount { get; set; }
}

/// <summary>
/// Message builder for creating outgoing messages
/// </summary>
public static class MessageBuilder
{
    public static string CreateSession()
    {
        return JsonConvert.SerializeObject(new { type = "CREATE_SESSION" });
    }

    public static string Join(string? sessionToken, ClientRole role)
    {
        return JsonConvert.SerializeObject(new
        {
            type = "JOIN",
            sessionToken,
            role = role.ToString()
        });
    }

    public static string Heartbeat()
    {
        return JsonConvert.SerializeObject(new { type = "HEARTBEAT" });
    }

    public static string Restart()
    {
        return JsonConvert.SerializeObject(new { type = "RESTART" });
    }

    public static string ImmediateStart()
    {
        return JsonConvert.SerializeObject(new { type = "IMMEDIATE_START" });
    }

    public static string StatusUpdate(bool clientRunning, int processCount)
    {
        return JsonConvert.SerializeObject(new
        {
            type = "STATUS_UPDATE",
            status = new { clientRunning, processCount }
        });
    }

    public static string StatusRequest()
    {
        return JsonConvert.SerializeObject(new { type = "STATUS_REQUEST" });
    }

    public static string GameStatus(bool gameRunning)
    {
        return JsonConvert.SerializeObject(new { type = "GAME_STATUS", gameRunning });
    }
}
