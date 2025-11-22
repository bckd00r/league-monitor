#include "shared/config.h"
#include "shared/logger.h"
#include <fstream>
#include <sstream>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace league_monitor {

Logger logger("Config");

Config& Config::getInstance() {
    static Config instance;
    return instance;
}

void Config::loadDefaults() {
    relayConfig_.port = 8080;
    relayConfig_.host = "0.0.0.0";
    
    controllerConfig_.relayServerHost = "localhost";
    controllerConfig_.relayServerPort = 8080;
    controllerConfig_.monitorInterval = 5000;
    controllerConfig_.killGameProcess = true;
    
    followerConfig_.relayServerHost = "localhost";
    followerConfig_.relayServerPort = 8080;
    followerConfig_.restartDelay = 30000;
}

bool Config::loadFromFile(const std::string& configPath) {
    std::ifstream file(configPath);
    if (!file.is_open()) {
        logger.warn("Failed to open config file: " + configPath + ", using defaults");
        logger.warn("Copy config.example.json to config.json and customize it");
        loadDefaults();
        return false;
    }
    
    try {
        json j;
        file >> j;
        
        // Parse relay config
        if (j.contains("relay")) {
            auto relay = j["relay"];
            if (relay.contains("port")) relayConfig_.port = relay["port"];
            if (relay.contains("host")) relayConfig_.host = relay["host"];
        }
        
        // Parse controller config
        if (j.contains("controller")) {
            auto controller = j["controller"];
            if (controller.contains("relayServerHost")) 
                controllerConfig_.relayServerHost = controller["relayServerHost"];
            if (controller.contains("relayServerPort")) 
                controllerConfig_.relayServerPort = controller["relayServerPort"];
            if (controller.contains("monitorInterval")) 
                controllerConfig_.monitorInterval = controller["monitorInterval"];
            if (controller.contains("killGameProcess")) 
                controllerConfig_.killGameProcess = controller["killGameProcess"];
        }
        
        // Parse follower config
        if (j.contains("follower")) {
            auto follower = j["follower"];
            if (follower.contains("relayServerHost")) 
                followerConfig_.relayServerHost = follower["relayServerHost"];
            if (follower.contains("relayServerPort")) 
                followerConfig_.relayServerPort = follower["relayServerPort"];
            if (follower.contains("restartDelay")) 
                followerConfig_.restartDelay = follower["restartDelay"];
        }
        
        return true;
    } catch (const std::exception& e) {
        logger.error("Failed to parse config.json: " + std::string(e.what()));
        loadDefaults();
        return false;
    }
}

} // namespace league_monitor

