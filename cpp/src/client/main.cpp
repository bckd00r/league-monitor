#include "shared/websocket_client.h"
#include "shared/config.h"
#include "shared/logger.h"
#include "shared/process_utils.h"
#include "shared/league_utils.h"
#include <iostream>
#include <thread>
#include <chrono>

using namespace league_monitor;

int main(int argc, char* argv[]) {
    Logger logger("Follower");
    
    // Get token from command line argument (optional - will auto-join by IP if not provided)
    std::string sessionToken = (argc > 1) ? argv[1] : "";
    
    logger.info("Starting League Client Follower...");
    
#ifdef _WIN32
    logger.info("Platform: Windows");
#elif __APPLE__
    logger.info("Platform: macOS");
#else
    logger.info("Platform: Linux");
#endif
    
    if (!sessionToken.empty()) {
        logger.info("Session token: " + sessionToken);
    } else {
        logger.info("No token provided - will attempt auto-join by IP address");
        logger.info("(Make sure controller is running on the same machine/IP)");
    }
    
    // Load configuration
    Config& config = Config::getInstance();
    config.loadFromFile("config.json");
    
    FollowerConfig followerConfig = config.getFollowerConfig();
    
    // Initialize WebSocket client
    WebSocketClient sessionClient(
        followerConfig.relayServerHost,
        followerConfig.relayServerPort,
        Role::FOLLOWER
    );
    
    // Spam protection: track last start time
    auto lastStartTime = std::chrono::steady_clock::now();
    const uint32_t startCooldown = 30000; // 30 seconds
    
    // Client restart callback - triggered when controller restarts due to VGC exit code 185
    sessionClient.setClientRestartedCallback([&lastStartTime, startCooldown, &logger]() {
        auto now = std::chrono::steady_clock::now();
        auto timeSinceLastStart = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastStartTime).count();
        
        if (timeSinceLastStart < startCooldown) {
            uint32_t remainingSeconds = (startCooldown - timeSinceLastStart) / 1000;
            logger.info("CLIENT_RESTARTED command received, but in cooldown period (" + 
                       std::to_string(remainingSeconds) + "s remaining). Skipping.");
            return;
        }
        
        std::string clientProcessName = LeagueUtils::getLeagueClientProcessName();
        auto gameProcessNames = LeagueUtils::getLeagueGameProcessNames();
        
        logger.info("CLIENT_RESTARTED command received from controller (VGC exit code 185)!");
        
        // Check if game is running - if yes, skip launch
        bool isGameRunning = ProcessUtils::isAnyProcessRunning(gameProcessNames);
        if (isGameRunning) {
            logger.info("League of Legends game is running, skipping LeagueClient launch (will be handled by 30-second game check when game closes)");
            return;
        }
        
        bool isClientRunning = ProcessUtils::isProcessRunning(clientProcessName);
        
        if (isClientRunning) {
            logger.info("LeagueClient is already running, killing and restarting...");
            
            uint32_t killedCount = ProcessUtils::killProcessByName(clientProcessName);
            if (killedCount > 0) {
                logger.success("Killed existing LeagueClient");
                
                // Also kill RiotClientServices
                std::string riotClientServicesName = LeagueUtils::getRiotClientServicesProcessName();
                bool riotClientServicesRunning = ProcessUtils::isProcessRunning(riotClientServicesName);
                if (riotClientServicesRunning) {
                    logger.info("Killing RiotClientServices...");
                    ProcessUtils::killProcessByName(riotClientServicesName);
                }
                
                std::this_thread::sleep_for(std::chrono::seconds(2));
            }
        }
        
        logger.info("Launching LeagueClient due to controller restart...");
        bool success = LeagueUtils::launchLeagueClient();
        
        if (success) {
            lastStartTime = std::chrono::steady_clock::now();
            logger.success("Client launched successfully (restart due to VGC exit code 185)");
            
            if (ProcessUtils::waitForProcess(clientProcessName, 15000)) {
                logger.success("LeagueClient process detected");
            } else {
                logger.warn("LeagueClient process not detected after 15 seconds, but launch was successful");
            }
        } else {
            logger.error("Failed to launch client");
        }
    });
    
    // Immediate start callback - triggered when controller detects 8+ processes
    sessionClient.setImmediateStartCallback([&lastStartTime, startCooldown, &logger]() {
        auto now = std::chrono::steady_clock::now();
        auto timeSinceLastStart = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastStartTime).count();
        
        if (timeSinceLastStart < startCooldown) {
            uint32_t remainingSeconds = (startCooldown - timeSinceLastStart) / 1000;
            logger.info("IMMEDIATE START command received, but in cooldown period (" + 
                       std::to_string(remainingSeconds) + "s remaining). Skipping.");
            return;
        }
        
        std::string clientProcessName = LeagueUtils::getLeagueClientProcessName();
        auto gameProcessNames = LeagueUtils::getLeagueGameProcessNames();
        
        logger.info("IMMEDIATE START command received from controller!");
        
        // Check if game is running - if yes, skip launch
        bool isGameRunning = ProcessUtils::isAnyProcessRunning(gameProcessNames);
        if (isGameRunning) {
            logger.info("League of Legends game is running, skipping LeagueClient launch (will be handled by 30-second game check when game closes)");
            return;
        }
        
        bool isClientRunning = ProcessUtils::isProcessRunning(clientProcessName);
        
        if (isClientRunning) {
            logger.info("LeagueClient is already running, killing and restarting immediately...");
            
            uint32_t killedCount = ProcessUtils::killProcessByName(clientProcessName);
            if (killedCount > 0) {
                logger.success("Killed existing LeagueClient");
                
                // Also kill RiotClientServices
                std::string riotClientServicesName = LeagueUtils::getRiotClientServicesProcessName();
                bool riotClientServicesRunning = ProcessUtils::isProcessRunning(riotClientServicesName);
                if (riotClientServicesRunning) {
                    logger.info("Killing RiotClientServices...");
                    ProcessUtils::killProcessByName(riotClientServicesName);
                }
                
                std::this_thread::sleep_for(std::chrono::seconds(2));
            }
        }
        
        logger.info("Launching LeagueClient immediately (no delay)...");
        bool success = LeagueUtils::launchLeagueClient();
        
        if (success) {
            lastStartTime = std::chrono::steady_clock::now();
            logger.success("Client launched successfully");
            
            if (ProcessUtils::waitForProcess(clientProcessName, 15000)) {
                logger.success("LeagueClient process detected");
            } else {
                logger.warn("LeagueClient process not detected after 15 seconds, but launch was successful");
            }
        } else {
            logger.error("Failed to launch client");
        }
    });
    
    // Connect to relay server
    sessionClient.connect(sessionToken);
    
    logger.success("Follower started successfully. Press Ctrl+C to exit.");
    
    // Keep running
    while (true) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }
    
    return 0;
}

