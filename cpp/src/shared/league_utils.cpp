#include "shared/league_utils.h"
#include "shared/logger.h"
#include "shared/process_utils.h"
#include <filesystem>
#include <fstream>
#include <yaml-cpp/yaml.h>
#include <nlohmann/json.hpp>

#ifdef _WIN32
#include <windows.h>
#include <shlobj.h>
#include <codecvt>
#else
#include <unistd.h>
#include <pwd.h>
#endif

namespace fs = std::filesystem;
namespace league_monitor {

static std::unique_ptr<Logger> logger_ = nullptr;

Logger& LeagueUtils::getLogger() {
    if (!logger_) {
        logger_ = std::make_unique<Logger>("LeagueUtils");
    }
    return *logger_;
}

std::string LeagueUtils::getInstallPath() {
#ifdef _WIN32
    // Windows: Try YAML file first
    char programData[MAX_PATH];
    if (SHGetFolderPathA(NULL, CSIDL_COMMON_APPDATA, NULL, SHGFP_TYPE_CURRENT, programData) == S_OK) {
        std::string yamlPath = std::string(programData) + "\\Riot Games\\Metadata\\league_of_legends.live\\league_of_legends.live.product_settings.yaml";
        
        if (fs::exists(yamlPath)) {
            try {
                YAML::Node config = YAML::LoadFile(yamlPath);
                if (config["product_install_full_path"]) {
                    std::string installPath = config["product_install_full_path"].as<std::string>();
                    getLogger().info("Found League installation via YAML: " + installPath);
                    return installPath;
                }
            } catch (...) {
                // Continue to fallback
            }
        }
    }
    
    // Fallback to default Windows path
    std::string defaultPath = "C:\\Riot Games\\League of Legends";
    if (fs::exists(defaultPath)) {
        getLogger().info("Using default Windows path: " + defaultPath);
        return defaultPath;
    }
#else
    // macOS: Try YAML file first
    std::string yamlPath = "/Users/Shared/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml";
    
    if (fs::exists(yamlPath)) {
        try {
            YAML::Node config = YAML::LoadFile(yamlPath);
            if (config["product_install_full_path"]) {
                std::string installPath = config["product_install_full_path"].as<std::string>();
                std::string fullPath = installPath + "/Contents/LoL";
                getLogger().info("Found League installation via YAML: " + fullPath);
                return fullPath;
            }
        } catch (...) {
            // Continue to fallback
        }
    }
    
    // Fallback to default macOS path
    std::string defaultPath = "/Applications/League of Legends.app/Contents/LoL";
    if (fs::exists(defaultPath)) {
        getLogger().info("Using default macOS path: " + defaultPath);
        return defaultPath;
    }
#endif
    
    getLogger().error("Could not find League of Legends installation");
    return "";
}

std::string LeagueUtils::getRiotClientPath() {
#ifdef _WIN32
    // Windows: Check RiotClientInstalls.json
    char programData[MAX_PATH];
    if (SHGetFolderPathA(NULL, CSIDL_COMMON_APPDATA, NULL, SHGFP_TYPE_CURRENT, programData) == S_OK) {
        std::string installsPath = std::string(programData) + "\\Riot Games\\RiotClientInstalls.json";
        
        if (fs::exists(installsPath)) {
            try {
                std::ifstream file(installsPath);
                nlohmann::json j;
                file >> j;
                
                if (j.contains("rc_default") && !j["rc_default"].is_null()) {
                    std::string path = j["rc_default"].get<std::string>();
                    if (fs::exists(path)) {
                        getLogger().info("Found Riot Client via RiotClientInstalls.json: " + path);
                        return path;
                    }
                }
            } catch (...) {
                // Continue to fallback
            }
        }
    }
    
    // Fallback to default Windows path
    std::string defaultPath = "C:\\Riot Games\\Riot Client\\RiotClientServices.exe";
    if (fs::exists(defaultPath)) {
        return defaultPath;
    }
#else
    // macOS: RiotClientServices is inside the app bundle
    std::string appPath = "/Applications/Riot Client.app";
    if (fs::exists(appPath)) {
        return appPath;
    }
#endif
    
    getLogger().error("Could not find Riot Client");
    return "";
}

std::string LeagueUtils::getLeagueClientProcessName() {
    return "LeagueClient";
}

std::string LeagueUtils::getRiotClientServicesProcessName() {
    return "RiotClientServices";
}

std::vector<std::string> LeagueUtils::getLeagueGameProcessNames() {
#ifdef _WIN32
    return {
        "League Of Legends.exe",
        "League Of Legends",
        "League of Legends.exe",
        "League of Legends",
        "league of legends.exe",
        "league of legends"
    };
#else
    return {"League Of Legends", "League of Legends"};
#endif
}

std::string LeagueUtils::getLeagueGameProcessName() {
#ifdef _WIN32
    return "League Of Legends.exe";
#else
    return "League Of Legends";
#endif
}

bool LeagueUtils::launchLeagueClient(const std::vector<std::string>& args) {
    std::string clientPath = getRiotClientPath();
    
    if (clientPath.empty()) {
        getLogger().error("Cannot launch client: path not found");
        return false;
    }
    
    // Default args for launching League
    std::vector<std::string> defaultArgs = {
        "--launch-product=league_of_legends",
        "--launch-patchline=live"
    };
    
    std::vector<std::string> allArgs;
    allArgs.insert(allArgs.end(), defaultArgs.begin(), defaultArgs.end());
    allArgs.insert(allArgs.end(), args.begin(), args.end());
    
    // Launch using ProcessUtils
#ifdef _WIN32
    std::ostringstream cmd;
    cmd << "\"" << clientPath << "\"";
    for (const auto& arg : allArgs) {
        cmd << " \"" << arg << "\"";
    }
    
    STARTUPINFOA si = {sizeof(si)};
    PROCESS_INFORMATION pi;
    
    if (CreateProcessA(NULL, const_cast<char*>(cmd.str().c_str()), NULL, NULL, FALSE,
                      CREATE_NO_WINDOW | DETACHED_PROCESS, NULL, NULL, &si, &pi)) {
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        getLogger().success("Launched League Client: " + clientPath);
        return true;
    }
#else
    // macOS: use open command
    std::ostringstream cmd;
    cmd << "open -a \"" << clientPath << "\" --args";
    for (const auto& arg : allArgs) {
        cmd << " \"" << arg << "\"";
    }
    
    if (system(cmd.str().c_str()) == 0) {
        getLogger().success("Launched League Client: " + clientPath);
        return true;
    }
#endif
    
    getLogger().error("Failed to launch League Client: " + clientPath);
    return false;
}

} // namespace league_monitor

