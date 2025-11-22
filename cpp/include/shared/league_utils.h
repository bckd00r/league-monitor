#pragma once

#include <string>
#include <vector>
#include <memory>
#include "shared/types.h"

namespace league_monitor {

class Logger;

class LeagueUtils {
public:
    // Get League of Legends installation path
    static std::string getInstallPath();
    
    // Get Riot Client executable path
    static std::string getRiotClientPath();
    
    // Get League Client process name
    static std::string getLeagueClientProcessName();
    
    // Get Riot Client Services process name
    static std::string getRiotClientServicesProcessName();
    
    // Get League Game process names (all variations)
    static std::vector<std::string> getLeagueGameProcessNames();
    
    // Get primary League Game process name (for backward compatibility)
    static std::string getLeagueGameProcessName();
    
    // Launch League Client with arguments
    static bool launchLeagueClient(const std::vector<std::string>& args = {});

private:
    static std::unique_ptr<Logger> logger_;
    static Logger& getLogger();
};

} // namespace league_monitor

