#pragma once

#include "shared/types.h"
#include <string>
#include <memory>

namespace league_monitor {

class Config {
public:
    static Config& getInstance();
    
    bool loadFromFile(const std::string& configPath = "config.json");
    void loadDefaults();
    
    RelayConfig getRelayConfig() const { return relayConfig_; }
    ControllerConfig getControllerConfig() const { return controllerConfig_; }
    FollowerConfig getFollowerConfig() const { return followerConfig_; }

private:
    Config() = default;
    Config(const Config&) = delete;
    Config& operator=(const Config&) = delete;
    
    RelayConfig relayConfig_;
    ControllerConfig controllerConfig_;
    FollowerConfig followerConfig_;
};

} // namespace league_monitor

