#pragma once

#include <string>
#include <cstdint>

namespace league_monitor {

// Message types matching TypeScript enum
enum class MessageType {
    CLIENT_RESTARTED,
    HEARTBEAT,
    ACK,
    JOIN,
    CREATE_SESSION,
    STATUS_UPDATE,
    STATUS_REQUEST,
    IMMEDIATE_START,
    GAME_RUNNING_RESTART_REQUEST,
    CLIENT_RESTARTED_MSG
};

// Role types
enum class Role {
    CONTROLLER,
    FOLLOWER
};

// Configuration structures
struct RelayConfig {
    uint16_t port = 8080;
    std::string host = "0.0.0.0";
};

struct ControllerConfig {
    std::string relayServerHost = "localhost";
    uint16_t relayServerPort = 8080;
    uint32_t monitorInterval = 5000;
    bool killGameProcess = true;
};

struct FollowerConfig {
    std::string relayServerHost = "localhost";
    uint16_t relayServerPort = 8080;
    uint32_t restartDelay = 30000;
};

struct ProcessInfo {
    uint32_t pid = 0;
    std::string name;
};

struct LeagueInstallation {
    std::string clientPath;
    std::string gamePath;
    std::string installPath;
};

// JSON message structure
struct Message {
    std::string type;
    int64_t timestamp = 0;
    std::string data;
    std::string sessionToken;
    Role role = Role::FOLLOWER;
    bool clientRunning = false;
    uint32_t processCount = 0;
};

} // namespace league_monitor

